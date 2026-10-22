/**
 * Cardputer inbox (opt-in, off by default): transcribes the recordings that
 * cardputer-assistant's daemon (cpad) lands in ~/CardputerNotes/recordings,
 * and writes the transcript back next to them (recording file contract v1;
 * docs/design/cardputer-inbox.md).
 *
 * This is the Electron shell around core/cardputer/inbox-runner.js: the
 * setting, when to look (at start, on file changes, every 30 s), SenseVoice
 * in a sherpa-onnx server of its own ("parakeet-cardputer", so dictation and
 * meetings keep theirs), the IPC for Settings and a notification without
 * any text. Transcripts never reach the debug log.
 */

const os = require("os");
const path = require("path");
const debugLogger = require("../../helpers/debugLogger");
const pure = require("./cardputer-inbox-pure");
const { createInboxRunner } = require("../core/cardputer/inbox-runner");
const { createSummaryStage } = require("../core/cardputer/summarize-session");

const MODEL = "sense-voice-zh-en";
const POLL_MS = 30_000;
const DEBOUNCE_MS = 2_000;
const PIECE_TIMEOUT_MS = 60_000;
const SETTINGS_KEY = "cardputerInbox";

function createCardputerServer() {
  const ParakeetWsServer = require("../../helpers/parakeetWsServer");
  return new ParakeetWsServer({
    pidKey: "parakeet-cardputer",
    portRange: ParakeetWsServer.MEETING_PORT_RANGE,
    logTranscripts: false, // Cardputer text stays out of the plaintext debug log
  });
}

/** Memory swaps, simplified Chinese, broken punctuation: what dictation's text gets in main. */
function postProcess(text) {
  let out = text;
  try {
    out = require("./vocabulary").applyMemoryReplacements(out)?.text ?? out;
  } catch {
    // Memory unavailable (locked, unreadable): keep the words as heard
  }
  out = require("./chinese-script").normalizeChineseScript(out, "simplified");
  return require("../core/language/lost-punctuation").repairLostPunctuation(out);
}

/**
 * The model chosen in Intelligence, when it is a local one (main learns it
 * from sync-startup-preferences). Summaries never use a cloud provider.
 */
function localModelFrom(environment) {
  return environment.REASONING_PROVIDER === "local" && environment.LOCAL_REASONING_MODEL
    ? environment.LOCAL_REASONING_MODEL
    : null;
}

function realEnv() {
  const electron = require("electron");
  const markdownRoute = require("./markdown-route");
  const ParakeetServerManager = require("../../helpers/parakeetServer");
  let models = null;
  return {
    homeDir: os.homedir(),
    readSettings: () => markdownRoute.readSettings()[SETTINGS_KEY],
    writeSettings: (value) => markdownRoute.updateSettings({ [SETTINGS_KEY]: value }),
    models: () => (models ??= new ParakeetServerManager()),
    createServer: createCardputerServer,
    appVersion: () => electron.app?.getVersion?.() ?? "unknown",
    showOpenDialog: (options) => electron.dialog.showOpenDialog(options),
    notify: () => {
      const { Notification } = electron;
      if (!Notification?.isSupported?.()) return;
      new Notification({
        title: "Cardputer",
        body: "A recording is ready in CardputerNotes.",
      }).show();
    },
    watch: (dir, onChange) => require("fs").watch(dir, { recursive: true }, onChange),
    localModel: () => localModelFrom(process.env),
    reasoning: () => require("../../services/localReasoningBridge").default,
    runnerOptions: {},
  };
}

/** Summaries through the background queue: no text logged, dictation first. */
function summaryOptions(env) {
  const reasoning = env.reasoning?.();
  if (!reasoning) return {};
  return {
    gateDelayMs: () => reasoning.backgroundDelayMs(),
    complete: createSummaryStage({
      model: () => env.localModel?.() ?? null,
      llm: (text, { systemPrompt, purpose, maxTokens, model, signal }) =>
        reasoning.processBackground(text, model, { systemPrompt, purpose, maxTokens, signal }),
    }),
  };
}

function codedError(cardputerCode, message) {
  return Object.assign(new Error(message), { cardputerCode });
}

function logOutcomes(outcomes) {
  for (const o of outcomes) {
    // Kinds and codes only: never a session's text or a transcript.
    debugLogger.debug("[WhisperWoof] Cardputer inbox", {
      kind: o.kind,
      code: o.code,
      level: o.level,
    });
  }
}

/** The inbox with its environment passed in (tests) or real (createCardputerInbox()). */
class CardputerInbox {
  constructor(env) {
    this._env = env;
    this._runner = null;
    this._server = null;
    this._watcher = null;
    this._pollTimer = null;
    this._debounceTimer = null;
    this._pass = null;
    this._again = false;
  }

  _settings() {
    return pure.normalizeInboxSettings(this._env.readSettings(), this._env.homeDir);
  }

  async _ensureModel() {
    const models = this._env.models();
    if (!models.isAvailable("offline") || !models.isModelDownloaded(MODEL)) return false;
    this._server ??= this._env.createServer();
    try {
      await this._server.start(MODEL, path.join(models.getModelsDir(), MODEL), "offline");
    } catch (error) {
      throw codedError("E_STT", `SenseVoice did not start: ${error.message}`);
    }
    return true;
  }

  async _transcribe(samples, sampleRate) {
    if (!this._server) throw codedError("E_STT", "SenseVoice is not running");
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    const { text, detail } = await this._server.transcribe(bytes, sampleRate, {
      signal: AbortSignal.timeout(PIECE_TIMEOUT_MS),
    });
    return detail ?? { text };
  }

  async _stopServer() {
    const running = this._server;
    this._server = null;
    await running?.stop().catch(() => {});
  }

  _makeRunner(root) {
    return createInboxRunner({
      root,
      transcribe: (samples, sampleRate) => this._transcribe(samples, sampleRate),
      ensureModel: () => this._ensureModel(),
      postProcess,
      app: `WhisperWoof/${this._env.appVersion()}`,
      onDone: () => this._env.notify(),
      ...summaryOptions(this._env),
      ...this._env.runnerOptions,
    });
  }

  /** One pass now, or right after the one running. Resolves when no pass runs. */
  runPass() {
    if (!this._runner) return Promise.resolve();
    if (this._pass) {
      this._again = true;
      return this._pass;
    }
    this._pass = (async () => {
      do {
        this._again = false;
        logOutcomes(await this._runner.runOnce().catch(() => []));
      } while (this._again && this._runner);
      await this._stopServer();
    })().finally(() => {
      this._pass = null;
    });
    return this._pass;
  }

  _armWatch(root) {
    if (this._watcher) return;
    try {
      this._watcher = this._env.watch(root, () => {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.runPass(), DEBOUNCE_MS);
      });
      this._watcher.on?.("error", () => {
        this._watcher?.close();
        this._watcher = null;
      });
    } catch {
      this._watcher = null; // the folder doesn't exist yet: the poll covers it and re-arms
    }
  }

  start() {
    const { enabled, root } = this._settings();
    if (!enabled || this._runner) return false;
    this._runner = this._makeRunner(root);
    this._armWatch(root);
    this._pollTimer = setInterval(() => {
      this._armWatch(root);
      this.runPass();
    }, POLL_MS);
    this._pollTimer.unref?.();
    this.runPass();
    return true;
  }

  async stop() {
    clearInterval(this._pollTimer);
    clearTimeout(this._debounceTimer);
    this._pollTimer = null;
    this._watcher?.close();
    this._watcher = null;
    this._runner?.abort();
    this._runner = null;
    await this._pass;
    await this._stopServer();
  }

  isRunning() {
    return Boolean(this._runner);
  }

  getState() {
    const { enabled, root } = this._settings();
    return {
      enabled,
      root,
      defaultRoot: pure.normalizeInboxSettings(null, this._env.homeDir).root,
    };
  }

  async setEnabled(enabled) {
    this._env.writeSettings({ ...this._settings(), enabled: enabled === true });
    if (enabled === true) this.start();
    else await this.stop();
    return this.getState();
  }

  /** The folder is chosen only in the native dialog: the page never sends a path. */
  async pickRoot() {
    const picked = await this._env.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose the Cardputer recordings folder",
      defaultPath: this._settings().root,
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { success: false, canceled: true };
    const wasRunning = this.isRunning();
    await this.stop();
    this._env.writeSettings({ ...this._settings(), root: picked.filePaths[0] });
    if (wasRunning) this.start();
    return { success: true, ...this.getState() };
  }

  registerIpc(ipcMain) {
    ipcMain.handle("whisperwoof-cardputer-get", () => this.getState());
    ipcMain.handle("whisperwoof-cardputer-set-enabled", (_event, enabled) =>
      this.setEnabled(enabled === true)
    );
    ipcMain.handle("whisperwoof-cardputer-pick-root", () => this.pickRoot());
  }
}

function createCardputerInbox(env = realEnv()) {
  return new CardputerInbox(env);
}

let instance = null;
const inbox = () => (instance ??= createCardputerInbox());

module.exports = {
  createCardputerInbox,
  createCardputerServer,
  postProcess,
  localModelFrom,
  start: () => inbox().start(),
  stop: () => (instance ? instance.stop() : Promise.resolve()),
  registerIpc: (ipcMain) => inbox().registerIpc(ipcMain),
};
