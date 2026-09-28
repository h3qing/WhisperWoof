/**
 * Live typing is the default, so main fetches its streaming model in the
 * background when it's missing (ParakeetManager.ensureStreamModel). That fetch
 * must never stand in the user's way: a download they start of the same model
 * adopts it, a download of another model replaces it.
 */
import os from "os";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn(() => os.tmpdir()) }, net: {} }));

const { default: ParakeetManager } = await import("../../../helpers/parakeet").then((m) => ({
  default: (m.default ?? m) as new () => any,
}));

const PREVIEW = "x-asr-zh-en-streaming-160ms";
const OTHER = "sense-voice-zh-en";

function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("background fetch of the live typing model", () => {
  let manager: any;
  let installs: Array<{ model: string; process: any; done: ReturnType<typeof deferred> }>;

  beforeEach(() => {
    manager = new ParakeetManager();
    manager.serverManager = {
      isAvailable: () => true,
      isModelDownloaded: () => false,
      startServer: vi.fn(async () => ({ success: true })),
    };
    installs = [];
    // Stand-in for the real download + extract: settles when the test says so,
    // and an abort rejects it the way the real download does.
    manager._downloadAndInstall = (model: string, process: any, signal: any) => {
      const done = deferred();
      installs.push({ model, process, done });
      signal.onAbort = () => done.reject(Object.assign(new Error("cancelled"), { code: "DOWNLOAD_CANCELLED" }));
      return done.promise.finally(() => {
        if (manager.currentDownloadProcess === process) manager.currentDownloadProcess = null;
      });
    };
  });

  it("starts once a session, and only when nothing else is downloading", () => {
    expect(manager.ensureStreamModel(PREVIEW)).toBe(true);
    expect(manager.ensureStreamModel(PREVIEW)).toBe(false);
    expect(installs).toHaveLength(1);
    expect(manager.currentDownloadProcess.background).toBe(true);
  });

  it("skips models that don't stream", () => {
    expect(manager.ensureStreamModel(OTHER)).toBe(false);
    expect(installs).toHaveLength(0);
  });

  it("hands the running download to the user when they ask for the same model", async () => {
    manager.ensureStreamModel(PREVIEW);
    const progress = vi.fn();
    const request = manager.downloadParakeetModel(PREVIEW, progress);
    expect(installs).toHaveLength(1);
    expect(manager.currentDownloadProcess.background).toBe(false);
    expect(manager.currentDownloadProcess.listeners.has(progress)).toBe(true);
    installs[0].done.resolve({ model: PREVIEW, success: true });
    await expect(request).resolves.toEqual({ model: PREVIEW, success: true });
  });

  it("steps aside for a user download of another model, and may fetch again later", async () => {
    manager.ensureStreamModel(PREVIEW);
    const request = manager.downloadParakeetModel(OTHER);
    await vi.waitFor(() => expect(installs).toHaveLength(2));
    expect(installs[1].model).toBe(OTHER);
    installs[1].done.resolve({ model: OTHER, success: true });
    await expect(request).resolves.toMatchObject({ model: OTHER });
    expect(manager.ensureStreamModel(PREVIEW)).toBe(true);
  });

  it("still refuses a second download the user started themselves", async () => {
    void manager.downloadParakeetModel(OTHER);
    await expect(manager.downloadParakeetModel(PREVIEW)).rejects.toMatchObject({
      code: "DOWNLOAD_IN_PROGRESS",
    });
    expect(manager.ensureStreamModel(PREVIEW)).toBe(false);
  });

  it("tells a live capture the model is on its way", async () => {
    await expect(manager.createOnlineStream(PREVIEW)).rejects.toThrow(/is downloading/);
    expect(installs).toHaveLength(1);
  });
});
