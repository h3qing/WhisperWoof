/**
 * The Electron shell of the Cardputer inbox (bridge/cardputer-inbox.js) with
 * a fake environment: off by default, the setting turns it on and off, the
 * folder comes only from the native dialog, SenseVoice runs in its own
 * server that is stopped after each pass, and the "parakeet-cardputer"
 * sidecar is known to the startup reaper.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { tempRoot, writeSession, readJson } from "./test-sessions";

const require = createRequire(import.meta.url);
const shell = require("../../bridge/cardputer-inbox");
const { EXPECTED_BINARY_FRAGMENTS } = require("../../../helpers/sidecarReaper");

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function fakeEnv(overrides: Record<string, unknown> = {}) {
  const root = tempRoot();
  roots.push(root);
  let stored: unknown = undefined;
  const server = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ({
      text: "好。",
      detail: { text: "好。", tokens: ["好", "。"], timestamps: [0.1, 0.2] },
    })),
  };
  const watcher = { close: vi.fn(), on: vi.fn() };
  const env = {
    homeDir: "/Users/me",
    readSettings: () => stored,
    writeSettings: vi.fn((value: unknown) => {
      stored = value;
    }),
    models: () => ({
      isAvailable: () => true,
      isModelDownloaded: () => true,
      getModelsDir: () => "/models",
    }),
    createServer: vi.fn(() => server),
    appVersion: () => "2.8.1",
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    notify: vi.fn(),
    watch: vi.fn((_dir: string, _onChange: () => void) => watcher),
    runnerOptions: {},
    ...overrides,
  };
  return {
    env,
    root,
    server,
    watcher,
    stored: () => stored,
    setStored: (v: unknown) => (stored = v),
  };
}

describe("Cardputer inbox shell", () => {
  it("is off by default and does nothing until turned on", () => {
    const { env } = fakeEnv();
    const inbox = shell.createCardputerInbox(env);
    expect(inbox.getState()).toEqual({
      enabled: false,
      root: "/Users/me/CardputerNotes/recordings",
      defaultRoot: "/Users/me/CardputerNotes/recordings",
    });
    expect(inbox.start()).toBe(false);
    expect(env.watch).not.toHaveBeenCalled();
  });

  it("turned on, transcribes what is waiting, notifies without text, then stops SenseVoice", async () => {
    const { env, root, server, watcher, setStored } = fakeEnv();
    setStored({ enabled: false, root });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const inbox = shell.createCardputerInbox(env);

    await inbox.setEnabled(true);
    await inbox.runPass();

    expect(env.writeSettings).toHaveBeenCalledWith({ enabled: true, root });
    expect(readJson(dir, "result.json")).toMatchObject({ state: "done", level: "transcript" });
    expect(readJson(dir, "result.json").pipeline.app).toBe("WhisperWoof/2.8.1");
    expect(readJson(dir, "transcript.json").sentences[0].text).toBe("好。");
    expect(server.start).toHaveBeenCalledWith(
      "sense-voice-zh-en",
      path.join("/models", "sense-voice-zh-en"),
      "offline"
    );
    expect(server.stop).toHaveBeenCalled();
    expect(env.notify).toHaveBeenCalledTimes(1);
    expect(env.notify).toHaveBeenCalledWith(); // no text, no session details
    expect(env.watch).toHaveBeenCalledWith(root, expect.any(Function));

    await inbox.setEnabled(false);
    expect(inbox.isRunning()).toBe(false);
    expect(watcher.close).toHaveBeenCalled();
    expect(inbox.getState().enabled).toBe(false);
  });

  it("writes blocked/model_missing and starts no server when SenseVoice isn't downloaded", async () => {
    const { env, root, setStored } = fakeEnv({
      models: () => ({
        isAvailable: () => true,
        isModelDownloaded: () => false,
        getModelsDir: () => "/m",
      }),
    });
    setStored({ enabled: true, root });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const inbox = shell.createCardputerInbox(env);
    inbox.start();
    await inbox.runPass();
    expect(readJson(dir, "status.json")).toMatchObject({
      state: "blocked",
      reason: "model_missing",
    });
    expect(env.createServer).not.toHaveBeenCalled();
    await inbox.stop();
  });

  it("looks again 2 s after the folder changes, once for a burst of changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const { env, root, setStored } = fakeEnv();
      setStored({ enabled: true, root });
      const inbox = shell.createCardputerInbox(env);
      inbox.start();
      await inbox.runPass(); // the pass at start finds nothing
      const { dir } = writeSession(root, {
        mode: "memo",
        segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
      });
      const onChange = env.watch.mock.calls[0]![1];
      onChange();
      onChange();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fs.existsSync(path.join(dir, "status.json"))).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await inbox.runPass();
      expect(readJson(dir, "result.json").state).toBe("done");
      await inbox.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps going when the folder can't be watched yet, and re-arms the watch on the poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const watcher = { close: vi.fn(), on: vi.fn() };
      const watch = vi
        .fn()
        .mockImplementationOnce(() => {
          throw Object.assign(new Error("no such folder"), { code: "ENOENT" });
        })
        .mockImplementation(() => watcher);
      const { env, root, setStored } = fakeEnv({ watch });
      setStored({ enabled: true, root });
      const inbox = shell.createCardputerInbox(env);
      expect(inbox.start()).toBe(true);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(watch).toHaveBeenCalledTimes(2);
      const onError = watcher.on.mock.calls.find(([event]) => event === "error")![1] as () => void;
      onError(); // a watch that breaks is dropped and re-armed by the next poll
      expect(watcher.close).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(watch).toHaveBeenCalledTimes(3);
      await inbox.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries later when SenseVoice fails to start (E_STT), leaving the session queued", async () => {
    const failing = {
      start: vi.fn(async () => Promise.reject(new Error("port busy"))),
      stop: vi.fn(async () => {}),
      transcribe: vi.fn(),
    };
    const { env, root, setStored } = fakeEnv({ createServer: vi.fn(() => failing) });
    setStored({ enabled: true, root });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const inbox = shell.createCardputerInbox(env);
    inbox.start();
    await inbox.runPass();
    expect(readJson(dir, "status.json").state).toBe("queued");
    expect(fs.existsSync(path.join(dir, "result.json"))).toBe(false);
    expect(failing.transcribe).not.toHaveBeenCalled();
    await inbox.stop();
  });

  it("summarises with the selected local model through the background queue, gated by dictation", async () => {
    const processBackground = vi.fn(
      async (_text: string, _model: string, o: { systemPrompt: string }) =>
        o.systemPrompt.includes("exactly one word") ? "no" : "标题：短句"
    );
    const backgroundDelayMs = vi.fn(() => 0);
    const { env, root, setStored } = fakeEnv({
      localModel: () => "qwen3.5-2b-q4_k_m",
      reasoning: () => ({ processBackground, backgroundDelayMs }),
    });
    setStored({ enabled: true, root });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const inbox = shell.createCardputerInbox(env);
    inbox.start();
    await inbox.runPass();
    expect(readJson(dir, "result.json")).toMatchObject({
      level: "summary",
      pipeline: { llm: "qwen3.5-2b-q4_k_m" },
    });
    expect(processBackground).toHaveBeenCalledWith(
      expect.stringContaining("<transcript>"),
      "qwen3.5-2b-q4_k_m",
      expect.objectContaining({
        purpose: "map",
        maxTokens: expect.any(Number),
        signal: expect.any(AbortSignal),
      })
    );
    expect(backgroundDelayMs).toHaveBeenCalled(); // asked before each SenseVoice piece and model call
    await inbox.stop();
  });

  it("keeps the transcript only when the reasoning provider isn't local", async () => {
    const processBackground = vi.fn();
    const { env, root, setStored } = fakeEnv({
      localModel: () => null,
      reasoning: () => ({ processBackground, backgroundDelayMs: () => 0 }),
    });
    setStored({ enabled: true, root });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    const inbox = shell.createCardputerInbox(env);
    inbox.start();
    await inbox.runPass();
    expect(readJson(dir, "result.json")).toMatchObject({ level: "transcript" });
    expect(processBackground).not.toHaveBeenCalled();
    await inbox.stop();
  });

  it("uses a local model only when Intelligence is set to a local one", () => {
    expect(
      shell.localModelFrom({
        REASONING_PROVIDER: "local",
        LOCAL_REASONING_MODEL: "qwen3.5-2b-q4_k_m",
      })
    ).toBe("qwen3.5-2b-q4_k_m");
    expect(
      shell.localModelFrom({
        REASONING_PROVIDER: "openai",
        LOCAL_REASONING_MODEL: "qwen3.5-2b-q4_k_m",
      })
    ).toBeNull();
    expect(shell.localModelFrom({ REASONING_PROVIDER: "local" })).toBeNull();
  });

  it("takes the folder only from the native dialog", async () => {
    const { env, root } = fakeEnv();
    const inbox = shell.createCardputerInbox(env);
    expect(await inbox.pickRoot()).toEqual({ success: false, canceled: true });
    env.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] });
    expect(await inbox.pickRoot()).toMatchObject({ success: true, root, enabled: false });
    expect(env.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.arrayContaining(["openDirectory"]) })
    );
  });

  it("answers Settings over IPC, taking only a real true to turn it on", async () => {
    const { env } = fakeEnv();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const inbox = shell.createCardputerInbox(env);
    inbox.registerIpc({
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    });
    expect([...handlers.keys()].sort()).toEqual([
      "whisperwoof-cardputer-get",
      "whisperwoof-cardputer-pick-root",
      "whisperwoof-cardputer-set-enabled",
    ]);
    expect(await handlers.get("whisperwoof-cardputer-set-enabled")!({}, "yes")).toMatchObject({
      enabled: false,
    });
    expect(await handlers.get("whisperwoof-cardputer-get")!({})).toMatchObject({ enabled: false });
    await inbox.stop();
  });

  it("is reachable from the page through three preload calls, none of which sends a path", () => {
    const preload = fs.readFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), "../../../../preload.js"),
      "utf8"
    );
    const invokes = preload.match(/ipcRenderer\.invoke\("whisperwoof-cardputer-[^)]*\)/g);
    expect(invokes).toEqual([
      'ipcRenderer.invoke("whisperwoof-cardputer-get")',
      'ipcRenderer.invoke("whisperwoof-cardputer-set-enabled", enabled === true)',
      'ipcRenderer.invoke("whisperwoof-cardputer-pick-root")',
    ]);
  });

  it("cleans each sentence like dictation: simplified Chinese, no broken characters", () => {
    expect(shell.postProcess("會議開始�我們看一下")).toBe("会议开始，我们看一下");
  });

  it("runs SenseVoice under its own sidecar name, known to the startup reaper", () => {
    const server = shell.createCardputerServer();
    expect(server.pidKey).toBe("parakeet-cardputer");
    expect(server.logTranscripts).toBe(false);
    expect(EXPECTED_BINARY_FRAGMENTS["parakeet-cardputer"]).toEqual(["sherpa-onnx-ws-"]);
    expect(EXPECTED_BINARY_FRAGMENTS["parakeet-meeting"]).toEqual(["sherpa-onnx-ws-"]); // unchanged
  });
});
