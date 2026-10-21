const modelManager = require("../helpers/modelManagerBridge").default;
const debugLogger = require("../helpers/debugLogger");
const reasoningQueue = require("../whisperwoof/bridge/reasoning-queue-pure");
const {
  BACKGROUND_IDLE_MS,
  backgroundDelayMs,
} = require("../whisperwoof/bridge/background-gate-pure");

const { KINDS } = reasoningQueue;

function abortError() {
  const error = new Error("Background reasoning cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * The bundled llama-server, for dictation cleanup (interactive, processText)
 * and for background work such as Cardputer summaries (processBackground).
 * One request reaches the server at a time. Interactive requests go first:
 * one that arrives while a background call runs aborts that call, and the
 * background chunk is sent again once dictation has been idle for a while.
 * Background answers never reach the debug log.
 */
class LocalReasoningService {
  /**
   * @param {Object} [deps]
   * @param {Object} [deps.models] - ModelManager (runInference)
   * @param {() => number} [deps.now]
   * @param {number} [deps.idleMs] - dictation idle time before background work
   * @param {() => boolean} [deps.isBusy] - true while background work must wait (e.g. a meeting)
   */
  constructor({ models = modelManager, now = Date.now, idleMs = BACKGROUND_IDLE_MS, isBusy } = {}) {
    this.models = models;
    this.isProcessing = false; // an interactive request is in flight
    this._now = now;
    this._idleMs = idleMs;
    this._isBusy = isBusy || (() => false);
    this._queue = reasoningQueue.createQueue();
    this._jobs = new Map(); // background job id -> { text, modelId, config, resolve, reject, release }
    this._running = null; // { id, controller } of the background call in flight
    this._lastInteractiveAt = null;
    this._timer = null;
    this._nextId = 1;
  }

  async isAvailable() {
    try {
      await modelManager.ensureLlamaCpp();
      const models = await modelManager.getAllModels();
      return models.some((model) => model.isDownloaded);
    } catch {
      return false;
    }
  }

  /** `fn()` → true while background work must wait (a meeting is being transcribed). */
  setBusyCheck(fn) {
    this._isBusy = typeof fn === "function" ? fn : () => false;
  }

  /** Milliseconds until background work may run (0 = now): for other background workers. */
  backgroundDelayMs() {
    return backgroundDelayMs({
      now: this._now(),
      lastInteractiveAt: this._lastInteractiveAt,
      interactiveRunning: this.isProcessing,
      busy: this._isBusy(),
      idleMs: this._idleMs,
    });
  }

  /** Dictation cleanup and other interactive requests: unchanged for callers. */
  async processText(text, modelId, config = {}) {
    debugLogger.logReasoning("LOCAL_BRIDGE_START", {
      modelId,
      textLength: text.length,
      hasConfig: Object.keys(config).length > 0,
    });

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    this.isProcessing = true;
    this._lastInteractiveAt = this._now();
    const id = `i${this._nextId++}`;
    this._admitInteractive(id);
    try {
      return await this._infer(text, modelId, config, { logContent: true });
    } finally {
      this._queue = reasoningQueue.finish(this._queue, id);
      this.isProcessing = false;
      this._lastInteractiveAt = this._now();
      this._schedule(0);
    }
  }

  /**
   * Background work (its text and answers are never logged). Waits for
   * dictation to be idle, may be preempted and sent again, and resolves with
   * the model's answer. `config.purpose` "map" (default) caps the answer at
   * 512 tokens, "reduce" at 1024; `config.signal` cancels it.
   */
  processBackground(text, modelId, config = {}) {
    const { signal, ...rest } = config;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const id = `b${this._nextId++}`;
      const onAbort = () => this._cancel(id);
      signal?.addEventListener("abort", onAbort, { once: true });
      const release = () => signal?.removeEventListener("abort", onAbort);
      this._jobs.set(id, { text, modelId, config: rest, resolve, reject, release });
      this._queue = reasoningQueue.enqueue(this._queue, { id, kind: KINDS.BACKGROUND }).state;
      this._schedule(0);
    });
  }

  _admitInteractive(id) {
    const { state, preempt } = reasoningQueue.enqueue(this._queue, {
      id,
      kind: KINDS.INTERACTIVE,
    });
    // A cancelled call that has not returned yet is not put back in line.
    const kept =
      preempt && !this._jobs.has(preempt.id) ? reasoningQueue.remove(state, preempt.id) : state;
    this._queue = reasoningQueue.takeNext(kept).state;
    if (preempt && this._running?.id === preempt.id) {
      debugLogger.logReasoning("LOCAL_BRIDGE_PREEMPT", { job: preempt.id });
      this._running.controller.abort();
    }
  }

  _cancel(id) {
    const job = this._jobs.get(id);
    if (!job) return;
    this._queue = reasoningQueue.remove(this._queue, id);
    if (this._running?.id === id) this._running.controller.abort();
    this._settle(id, () => job.reject(abortError()));
  }

  _schedule(delayMs) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._pump();
    }, delayMs);
    this._timer.unref?.();
  }

  _pump() {
    if (this._queue.running || this._jobs.size === 0) return;
    const delay = this.backgroundDelayMs();
    if (delay > 0) {
      this._schedule(delay);
      return;
    }
    const { state, job } = reasoningQueue.takeNext(this._queue, { backgroundAllowed: true });
    if (!job) return;
    this._queue = state;
    this._runBackground(job.id);
  }

  async _runBackground(id) {
    const job = this._jobs.get(id);
    if (!job) {
      // Cancelled before it could run again: nothing to send.
      this._queue = reasoningQueue.finish(this._queue, id);
      this._schedule(0);
      return;
    }
    const controller = new AbortController();
    const run = { id, controller };
    this._running = run;
    try {
      const maxTokens = reasoningQueue.capBackgroundTokens(
        job.config.maxTokens,
        job.config.purpose
      );
      const result = await this._infer(
        job.text,
        job.modelId,
        { ...job.config, maxTokens },
        { logContent: false, signal: controller.signal }
      );
      this._settle(id, () => job.resolve(result));
    } catch (error) {
      // Aborted: preempted (the job is back at the head of the line) or cancelled (settled).
      if (!controller.signal.aborted) this._settle(id, () => job.reject(error));
    } finally {
      // A preempted call that returns after its retry started must not end that retry.
      if (this._running === run) {
        this._running = null;
        this._queue = reasoningQueue.finish(this._queue, id);
      }
      this._schedule(0);
    }
  }

  _settle(id, settle) {
    const job = this._jobs.get(id);
    if (!job) return;
    this._jobs.delete(id);
    job.release();
    settle();
  }

  async _infer(text, modelId, config, { logContent, signal }) {
    const startTime = Date.now();

    try {
      // Dictation cleanup is a deterministic rewrite, not a chat: sample cold.
      // This path (the one dictation actually takes) used to default to 0.7,
      // which is where the random translations and "*punch*" replies came
      // from; 0.3 also matches what eval/run-polish-eval.js measures. Not
      // greedy: Qwen warns that greedy decoding loops. No repeat penalty —
      // reduplication (看看, 谢谢, 慢慢) is grammar in Chinese, not a loop.
      const inferenceConfig = {
        maxTokens: config.maxTokens || this.calculateMaxTokens(text.length),
        temperature: config.temperature ?? 0.3,
        topK: config.topK ?? 40,
        topP: config.topP ?? 0.9,
        contextSize: config.contextSize || 4096,
        threads: config.threads || 4,
        systemPrompt: config.systemPrompt || "",
      };

      debugLogger.logReasoning("LOCAL_BRIDGE_INFERENCE", {
        modelId,
        config: logContent ? inferenceConfig : { ...inferenceConfig, systemPrompt: "[set]" },
      });

      const options = logContent ? inferenceConfig : { ...inferenceConfig, signal, logContent };
      const result = await this.models.runInference(modelId, text, options);
      const cleanResult = result
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/<think>[\s\S]*$/, "")
        .trim();

      const processingTime = Date.now() - startTime;

      debugLogger.logReasoning("LOCAL_BRIDGE_SUCCESS", {
        modelId,
        processingTimeMs: processingTime,
        resultLength: cleanResult.length,
        ...(logContent
          ? {
              resultPreview:
                cleanResult.substring(0, 100) + (cleanResult.length > 100 ? "..." : ""),
            }
          : {}),
      });

      return cleanResult;
    } catch (error) {
      const processingTime = Date.now() - startTime;

      debugLogger.logReasoning("LOCAL_BRIDGE_ERROR", {
        modelId,
        processingTimeMs: processingTime,
        error: error.message,
        ...(logContent ? { stack: error.stack } : {}),
      });

      throw error;
    }
  }

  calculateMaxTokens(textLength, minTokens = 512, maxTokens = 2048, multiplier = 2) {
    return Math.max(minTokens, Math.min(textLength * multiplier, maxTokens));
  }
}

module.exports = {
  default: new LocalReasoningService(),
  LocalReasoningService,
};
