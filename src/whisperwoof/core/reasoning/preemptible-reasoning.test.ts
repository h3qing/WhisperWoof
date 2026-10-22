/**
 * Background reasoning (Cardputer summaries) shares llama-server with
 * dictation's cleanup. The real chain — LocalReasoningService.processText /
 * processBackground → ModelManager.runInference → LlamaServerManager.inference
 * — runs against a stand-in llama-server over HTTP:
 * - an interactive request sent while a background call runs reaches the
 *   server within 200 ms, because the background request is aborted
 *   (req.destroy()) rather than waited for;
 * - the aborted background chunk is sent again later and completes;
 * - background work waits until dictation has been idle;
 * - background calls never log what the model said.
 */
import { createRequire } from "module";
import http from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

const require = createRequire(import.meta.url);
const LlamaServerManager = require("../../../helpers/llamaServer.js");
const { ModelManager } = require("../../../helpers/modelManagerBridge.js");
const { LocalReasoningService } = require("../../../services/localReasoningBridge.js");
const debugLogger = require("../../../helpers/debugLogger.js");

const KEY = "a".repeat(64); // the format newServerApiKey makes

type Arrival = { at: number; text: string; closedEarly: boolean; endedAt?: number };

/** A llama-server stand-in: background prompts ("BG…") take `bgDelayMs` the first time. */
function startFakeLlama() {
  const arrivals: Arrival[] = [];
  const seen = new Map<string, number>();
  let bgDelayMs = 3000;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401);
        res.end("{}");
        return;
      }
      const parsed = JSON.parse(body);
      const text: string = parsed.messages[1].content;
      const arrival: Arrival = { at: Date.now(), text, closedEarly: false };
      arrivals.push(arrival);
      const times = (seen.get(text) ?? 0) + 1;
      seen.set(text, times);
      const delay = text.startsWith("BG") && times === 1 ? bgDelayMs : 20;
      const timer = setTimeout(() => {
        arrival.endedAt = Date.now();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: `answer to ${text}` } }],
            max_tokens: parsed.max_tokens,
          })
        );
      }, delay);
      res.on("close", () => {
        if (!res.writableEnded) {
          arrival.closedEarly = true;
          clearTimeout(timer);
        }
      });
    });
  });
  return {
    arrivals,
    setBgDelay: (ms: number) => (bgDelayMs = ms),
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
      ),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

class TestLlama extends LlamaServerManager {
  isAvailable() {
    return true;
  }
}

class TestModels extends ModelManager {
  ensureInitialized() {}
  findModelById() {
    return { model: { fileName: "m.gguf", name: "m" }, provider: { id: "qwen" } };
  }
  async checkModelValid() {
    return true;
  }
}

const fake = startFakeLlama();
let port = 0;

beforeAll(async () => {
  port = await fake.listen();
});
afterAll(() => fake.close());

function makeService(options: Record<string, unknown> = {}) {
  const llama = new TestLlama();
  llama.ready = true;
  llama.process = {};
  llama.port = port;
  llama.apiKey = KEY;
  const models = new TestModels();
  models.serverManager = llama;
  models.currentServerModelId = "m";
  models.modelsDir = "/nonexistent-models";
  return new LocalReasoningService({ models, idleMs: 100, ...options });
}

async function until(check: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** true once `promise` settles, false if it is still pending after `ms`. */
function settledWithin(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * The service's next model check waits until `release()`, like a cold
 * llama-server start: that call ignores its abort signal until then.
 */
function holdNextModelCheck(service: { models: { checkModelValid: () => Promise<boolean> } }) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const check = vi
    .spyOn(service.models, "checkModelValid")
    .mockImplementationOnce(() => held.then(() => true));
  return { started: () => check.mock.calls.length > 0, release };
}

describe("preemptible local reasoning", () => {
  beforeEach(() => {
    fake.arrivals.length = 0;
    fake.setBgDelay(3000);
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts an interactive request within 200 ms while a background call runs, then finishes the background chunk", async () => {
    const service = makeService();
    const background = service.processBackground("BG chunk 1", "m", {
      maxTokens: 512,
      purpose: "map",
    });
    await until(() => fake.arrivals.some((a) => a.text === "BG chunk 1"));

    const sentAt = Date.now();
    const answer = await service.processText("hello", "m");
    const interactive = fake.arrivals.find((a) => a.text === "hello")!;
    expect(interactive.at - sentAt).toBeLessThan(200);
    expect(answer).toBe("answer to hello");

    await until(() => fake.arrivals[0].closedEarly);
    await expect(background).resolves.toBe("answer to BG chunk 1");
    const bgArrivals = fake.arrivals.filter((a) => a.text === "BG chunk 1");
    expect(bgArrivals).toHaveLength(2); // aborted once, then retried
    expect(bgArrivals[1].at).toBeGreaterThanOrEqual(interactive.at + 100); // after the idle gap
  });

  it("waits for dictation to be idle before starting background work", async () => {
    fake.setBgDelay(20);
    const service = makeService({ idleMs: 300 });
    await service.processText("dictation", "m");
    const doneAt = Date.now();
    await service.processBackground("BG later", "m");
    const bgArrival = fake.arrivals.find((a) => a.text === "BG later")!;
    expect(bgArrival.at - doneAt).toBeGreaterThanOrEqual(280);
  });

  it("holds background work while the app is busy (a meeting being transcribed)", async () => {
    fake.setBgDelay(10);
    const busyUntil = Date.now() + 250;
    const service = makeService({ idleMs: 50 });
    service.setBusyCheck(() => Date.now() < busyUntil);
    expect(service.backgroundDelayMs()).toBeGreaterThan(0);
    await service.processBackground("BG after the meeting", "m");
    expect(fake.arrivals[0].at).toBeGreaterThanOrEqual(busyUntil);
    service.setBusyCheck(null);
    expect(service.backgroundDelayMs()).toBe(0);
  });

  it("runs background chunks one at a time, in order", async () => {
    fake.setBgDelay(30);
    const service = makeService();
    const results = await Promise.all([
      service.processBackground("BG a", "m"),
      service.processBackground("BG b", "m"),
      service.processBackground("BG c", "m"),
    ]);
    expect(results).toEqual(["answer to BG a", "answer to BG b", "answer to BG c"]);
    expect(fake.arrivals.map((a) => a.text)).toEqual(["BG a", "BG b", "BG c"]);
  });

  it("caps background max_tokens (map 512, reduce 1024)", async () => {
    fake.setBgDelay(10);
    const bodies: number[] = [];
    const original = LlamaServerManager.prototype.inference;
    vi.spyOn(LlamaServerManager.prototype, "inference").mockImplementation(function (
      this: unknown,
      messages: unknown,
      options: { max_tokens: number }
    ) {
      bodies.push(options.max_tokens);
      return original.call(this, messages, options);
    });
    const service = makeService();
    await service.processBackground("BG map", "m", { maxTokens: 4000, purpose: "map" });
    await service.processBackground("BG reduce", "m", { maxTokens: 4000, purpose: "reduce" });
    expect(bodies).toEqual([512, 1024]);
  });

  it("keeps the interactive path as it was when there is no background work", async () => {
    const service = makeService();
    const logs: Array<[string, Record<string, unknown>]> = [];
    vi.spyOn(debugLogger, "logReasoning").mockImplementation(
      (stage: string, details: Record<string, unknown>) => {
        logs.push([stage, details]);
      }
    );
    await expect(service.processText("plain", "m")).resolves.toBe("answer to plain");
    expect(
      logs.some(([stage, d]) => stage === "LOCAL_BRIDGE_SUCCESS" && "resultPreview" in d)
    ).toBe(true);
    expect(logs.some(([stage, d]) => stage === "INFERENCE_SUCCESS" && "resultPreview" in d)).toBe(
      true
    );

    // A second interactive request while one runs is still refused, as before.
    const first = service.processText("one", "m");
    await expect(service.processText("two", "m")).rejects.toThrow("Already processing a request");
    await first;
  });

  it("never logs what the model said for background calls (logContent: false)", async () => {
    fake.setBgDelay(10);
    const service = makeService();
    const logs: Array<[string, Record<string, unknown>]> = [];
    vi.spyOn(debugLogger, "logReasoning").mockImplementation(
      (stage: string, details: Record<string, unknown>) => {
        logs.push([stage, details]);
      }
    );
    await service.processBackground("BG secret words", "m");
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("secret");
    expect(logs.some(([, d]) => "resultPreview" in d)).toBe(false);
  });

  it("rejects a background call that fails for another reason, and keeps going", async () => {
    fake.setBgDelay(10);
    const service = makeService();
    const broken = makeService();
    broken.models.serverManager.apiKey = "b".repeat(64);
    await expect(broken.processBackground("BG nope", "m")).rejects.toThrow(/401/);
    await expect(service.processBackground("BG fine", "m")).resolves.toBe("answer to BG fine");
  });

  it("drops background work that was cancelled before it ran", async () => {
    fake.setBgDelay(10);
    const service = makeService({ idleMs: 200 });
    await service.processText("dictation", "m"); // closes the gate for 200 ms
    const controller = new AbortController();
    const cancelled = service.processBackground("BG cancelled", "m", { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await service.processBackground("BG kept", "m");
    expect(fake.arrivals.map((a) => a.text)).toEqual(["dictation", "BG kept"]);
  });
});

describe("background calls that end late", () => {
  beforeEach(() => {
    fake.arrivals.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps going when a starting call is cancelled and dictation arrives before it returns", async () => {
    fake.setBgDelay(10);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const service = makeService({ idleMs: 50 });
      const coldStart = holdNextModelCheck(service);
      const controller = new AbortController();
      const cancelled = service.processBackground("BG cold", "m", { signal: controller.signal });
      await until(() => coldStart.started());
      controller.abort(); // the inbox is turned off while llama-server starts
      await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
      await expect(service.processText("hello", "m")).resolves.toBe("answer to hello");
      coldStart.release(); // the cancelled call returns only now

      const next = service.processBackground("BG next", "m");
      expect(await settledWithin(next, 2000)).toBe(true);
      await expect(next).resolves.toBe("answer to BG next");
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      expect(fake.arrivals.map((a) => a.text)).toEqual(["hello", "BG next"]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("keeps one background call at a time when a preempted call returns after its retry started", async () => {
    fake.setBgDelay(300);
    const service = makeService({ idleMs: 50 });
    const coldStart = holdNextModelCheck(service);
    const first = service.processBackground("BG cold", "m");
    await until(() => coldStart.started());
    await service.processText("hello", "m"); // preempts BG cold while it starts
    await until(() => fake.arrivals.some((a) => a.text === "BG cold")); // its retry is at the server
    coldStart.release(); // the preempted attempt returns only now
    const second = service.processBackground("BG second", "m");

    await expect(first).resolves.toBe("answer to BG cold");
    await expect(second).resolves.toBe("answer to BG second");
    const cold = fake.arrivals.find((a) => a.text === "BG cold")!;
    const after = fake.arrivals.find((a) => a.text === "BG second")!;
    expect(after.at).toBeGreaterThanOrEqual(cold.endedAt!);
  });

  it("skips a job in line that is no longer known, and keeps the line going", async () => {
    fake.setBgDelay(10);
    const queue = require("../../bridge/reasoning-queue-pure.js");
    const service = makeService();
    service._queue = queue.enqueue(service._queue, { id: "b-gone", kind: "background" }).state;
    await expect(service.processBackground("BG after", "m")).resolves.toBe("answer to BG after");
    expect(service._queue).toEqual({ waiting: [], running: null });
  });
});

describe("LlamaServerManager.inference with a signal", () => {
  it("destroys the request when aborted and rejects with AbortError", async () => {
    fake.arrivals.length = 0;
    fake.setBgDelay(3000);
    const llama = new TestLlama();
    llama.ready = true;
    llama.process = {};
    llama.port = port;
    llama.apiKey = KEY;
    const controller = new AbortController();
    const pending = llama.inference(
      [
        { role: "system", content: "" },
        { role: "user", content: "BG abort me" },
      ],
      {
        signal: controller.signal,
      }
    );
    await until(() => fake.arrivals.length === 1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await until(() => fake.arrivals[0].closedEarly);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const llama = new TestLlama();
    llama.ready = true;
    llama.process = {};
    llama.port = port;
    llama.apiKey = KEY;
    await expect(llama.inference([], { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
