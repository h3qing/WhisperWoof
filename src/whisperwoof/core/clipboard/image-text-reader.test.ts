/**
 * The background reader (bridge/clipboard-image-text.js) end to end: a real
 * SQLite database (node:sqlite), real image files in a temp userData folder,
 * and a fake macos-ocr-helper that speaks the helper's wire format (length-
 * prefixed frames in, one JSON line out). Timers are fake; file I/O is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { PassThrough, Writable } from "stream";
import fs from "fs";
import os from "os";
import path from "path";
import childProcess from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const imageDb = require("../../bridge/clipboard-image-text-db.js");

type Db = InstanceType<typeof DatabaseSync>;
type Answer = Record<string, unknown> | "crash" | "flood";

let base = "";
let userData = "";
let db: Db | null = null;
let settingsFile: Record<string, unknown> = {};
let onBattery = false;
let received: string[] = [];
let answer: (bytes: string) => Answer = (bytes) => ({ text: `words of ${bytes}` });
let helperStarts = true;
const sent: unknown[] = [];
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
let spawn: ReturnType<typeof vi.fn>;

function fakeHelper() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdout = new PassThrough();
  let buffer = Buffer.alloc(0);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    setImmediate(() => child.emit("close", 0));
  };
  child.pid = helperStarts ? 4242 : undefined; // spawn failures have no pid
  child.stdout = stdout;
  child.stdin = new Writable({
    write(chunk: Buffer, _encoding, done) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
        const length = buffer.readUInt32BE(0);
        const bytes = buffer.subarray(4, 4 + length).toString();
        buffer = buffer.subarray(4 + length);
        received.push(bytes);
        const reply = answer(bytes);
        if (reply === "crash") close();
        else if (reply === "flood") setImmediate(() => stdout.write("x".repeat(1_100_000))); // no newline, ever
        else setImmediate(() => stdout.write(`${JSON.stringify(reply)}\n`));
      }
      done();
    },
    final(done) {
      close();
      done();
    },
  });
  child.kill = vi.fn(() => {
    close();
    return true;
  });
  if (helperStarts) setImmediate(() => stdout.write(`${JSON.stringify({ ready: true, languages: ["zh-Hans", "en-US"] })}\n`));
  else close();
  return child;
}

function makeDb(): Db {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE bf_entries (
    id TEXT PRIMARY KEY, created_at TEXT, source TEXT, raw_text TEXT, polished TEXT,
    audio_path TEXT, metadata TEXT, favorite INTEGER NOT NULL DEFAULT 0
  )`);
  imageDb.createImageTextTable(d);
  return d;
}

/** A clipboard image entry whose file (in the app's image folder unless `at` says otherwise) holds `content`. */
function addImage(id: string, createdAt: string, content: string, at?: string) {
  const file = at ?? path.join(userData, "whisperwoof-images", `${id}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  db!.prepare(
    "INSERT INTO bf_entries (id, created_at, source, raw_text, audio_path, metadata) VALUES (?, ?, 'clipboard', '[Image 1×1]', ?, ?)"
  ).run(id, createdAt, file, JSON.stringify({ type: "image", width: 1, height: 1 }));
}

function loadReader() {
  const inject = (request: string, exports: unknown) => {
    const resolved = require.resolve(request);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
  };
  inject("electron", {
    app: { getPath: () => userData, getPreferredSystemLanguages: () => ["en-US", "zh-Hans-CN"] },
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_c: string, s: unknown) => sent.push(s) } }],
    },
    powerMonitor: {
      isOnBatteryPower: () => onBattery,
      getCurrentThermalState: () => "nominal",
      getSystemIdleTime: () => 600,
    },
  });
  inject("../../../helpers/debugLogger.js", { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() });
  inject("../../bridge/app-init.js", { getWhisperWoofDb: () => db });
  inject("../../bridge/clipboard-store.js", { notifyChanged: vi.fn() });
  inject("../../bridge/markdown-route.js", {
    readSettings: () => settingsFile,
    updateSettings: (patch: Record<string, unknown>) => Object.assign(settingsFile, patch),
  });
  for (const mod of [
    "../../bridge/clipboard-image-text.js",
    "../../bridge/app-files.js",
    "../../bridge/vault/vault-files.js",
    "../../bridge/vault/vault-service.js",
    "../../bridge/vault/vault-paths.js",
  ]) {
    delete require.cache[require.resolve(mod)];
  }
  return require("../../bridge/clipboard-image-text.js");
}

const read = () => imageDb.countImageText(db).read;
const realSetTimeout = setTimeout;

/** Move fake time a second at a time, letting real file I/O finish in between, until `done()`. */
async function runUntil(done: () => boolean, maxSeconds = 400) {
  for (let i = 0; i < maxSeconds && !done(); i++) {
    await vi.advanceTimersByTimeAsync(1000);
    await new Promise((resolve) => realSetTimeout(resolve, 2));
  }
  expect(done()).toBe(true);
}

let reader: ReturnType<typeof loadReader>;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "ww-image-text-"));
  userData = path.join(base, "userData");
  const binDir = path.join(base, "Resources");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "macos-ocr-helper"), "#!/bin/sh\n", { mode: 0o755 });
  (process as unknown as { resourcesPath?: string }).resourcesPath = binDir;
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  db = makeDb();
  settingsFile = {};
  onBattery = false;
  received = [];
  sent.length = 0;
  answer = (bytes) => ({ text: `words of ${bytes}` });
  helperStarts = true;
  spawn = vi.fn(fakeHelper);
  vi.spyOn(childProcess, "spawn").mockImplementation(spawn as unknown as typeof childProcess.spawn);
  vi.spyOn(os, "loadavg").mockReturnValue([0.1, 0.1, 0.1]);
  vi.spyOn(os, "setPriority").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  addImage("old", "2026-09-25T10:00:00Z", "OLD");
  addImage("new", "2026-09-26T10:00:00Z", "NEW");
  reader = loadReader();
  reader.start();
});

afterEach(() => {
  reader.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", platform);
  delete (process as unknown as { resourcesPath?: string }).resourcesPath;
  fs.rmSync(base, { recursive: true, force: true });
});

describe("the image text reader", () => {
  it("does nothing until it's turned on", async () => {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).not.toHaveBeenCalled();
    expect(reader.getStatus()).toMatchObject({ enabled: false, available: true, state: "off", total: 2, read: 0 });
  });

  it("reads new copies first, then older images newest first, in one helper", async () => {
    reader.setEnabled({ enabled: true });
    addImage("fresh", "2026-09-27T10:00:00Z", "FRESH");
    reader.noteNewImage("fresh");
    await runUntil(() => read() === 3);
    expect(received).toEqual(["FRESH", "NEW", "OLD"]);
    expect(imageDb.imageTextFor(db, "new")).toEqual({ status: "done", text: "words of NEW" });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][1]).toEqual(["--languages", "zh-Hans,en-US"]);
    expect(reader.getStatus()).toMatchObject({ enabled: true, state: "done", total: 3, read: 3, withText: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent.at(-1)).toMatchObject({ state: "done", read: 3 });
  });

  it("reads only files in its own image folder", async () => {
    addImage("outside", "2026-09-27T10:00:00Z", "PRIVATE", path.join(base, "Documents", "secret.png"));
    reader.setEnabled({ enabled: true });
    await runUntil(() => read() === 3);
    expect(received).not.toContain("PRIVATE");
    expect(imageDb.imageTextFor(db, "outside")).toEqual({ status: "failed", text: "" });
  });

  it("stores an image without words as read, and one macOS can't open as failed", async () => {
    answer = (bytes) => (bytes === "NEW" ? { text: "  \n " } : { error: "unreadable", message: "no" });
    reader.setEnabled({ enabled: true });
    await runUntil(() => read() === 2);
    expect(imageDb.imageTextFor(db, "new")).toEqual({ status: "done", text: "" });
    expect(imageDb.imageTextFor(db, "old")).toEqual({ status: "failed", text: "" });
    expect(reader.getStatus()).toMatchObject({ read: 2, withText: 0 });
  });

  it("turning it off stops reading and deletes the words", async () => {
    reader.setEnabled({ enabled: true });
    await runUntil(() => read() === 1);
    const result = reader.setEnabled({ enabled: false });
    expect(result.deleted).toBe(1);
    expect(result.imageText).toMatchObject({ enabled: false, state: "off", read: 0 });
    expect(settingsFile.clipboardImageText).toEqual({ enabled: false });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(read()).toBe(0);
    expect(received).toEqual(["NEW"]);
  });

  it("waits while the user dictates, and a little after", async () => {
    reader.setEnabled({ enabled: true });
    reader.setDictating(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(received).toEqual([]);
    expect(reader.getStatus()).toMatchObject({ state: "paused", reason: "dictating" });
    reader.setDictating(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(received).toEqual([]);
    await runUntil(() => read() === 2);
  });

  it("waits while a meeting records", async () => {
    let meeting = true;
    reader.setMeetingCheck(() => meeting);
    reader.setEnabled({ enabled: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(received).toEqual([]);
    expect(reader.getStatus()).toMatchObject({ state: "paused", reason: "meeting" });
    meeting = false;
    await runUntil(() => read() === 2);
  });

  it("waits while the Mac is busy", async () => {
    vi.mocked(os.loadavg).mockReturnValue([os.availableParallelism() * 2, 1, 1]);
    reader.setEnabled({ enabled: true });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(received).toEqual([]);
    expect(reader.getStatus()).toMatchObject({ state: "paused", reason: "busy" });
  });

  it("on battery reads new copies only", async () => {
    onBattery = true;
    reader.setEnabled({ enabled: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(received).toEqual([]);
    expect(reader.getStatus()).toMatchObject({ state: "paused", reason: "battery" });
    addImage("fresh", "2026-09-27T10:00:00Z", "FRESH");
    reader.noteNewImage("fresh");
    await runUntil(() => read() === 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(received).toEqual(["FRESH"]);
    expect(reader.getStatus()).toMatchObject({ state: "paused", reason: "battery" });
  });

  it("waits while locked and carries on when the database opens again", async () => {
    const open = db;
    db = null;
    reader.setEnabled({ enabled: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(received).toEqual([]);
    expect(reader.getStatus()).toMatchObject({ state: "paused", reason: "locked" });
    db = open;
    reader.onDatabaseAttached(db);
    await runUntil(() => read() === 2);
  });

  it("gives up on an image that keeps crashing the helper, and reads the rest", async () => {
    answer = (bytes) => (bytes === "NEW" ? "crash" : { text: "fine" });
    reader.setEnabled({ enabled: true });
    await runUntil(() => read() === 2);
    expect(received.filter((b) => b === "NEW")).toHaveLength(3);
    expect(imageDb.imageTextFor(db, "new").status).toBe("failed");
    expect(imageDb.imageTextFor(db, "old")).toEqual({ status: "done", text: "fine" });
  });

  it("a helper that won't start turns reading off for the session, without blaming the images", async () => {
    helperStarts = false;
    reader.setEnabled({ enabled: true });
    await runUntil(() => reader.getStatus().state === "unavailable");
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(read()).toBe(0);
    expect(imageDb.unreadImages(db, 10)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(spawn).toHaveBeenCalledTimes(3);
    // Never os.setPriority(undefined, …): that would lower WhisperWoof's own priority.
    expect(os.setPriority).not.toHaveBeenCalled();
  });

  it("gives the helper no API keys", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-for-the-helper";
    try {
      reader.setEnabled({ enabled: true });
      await runUntil(() => read() === 2);
      const env = spawn.mock.calls[0][2].env as Record<string, string>;
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("stores a secret in a screenshot as •••••", async () => {
    answer = (bytes) => ({ text: bytes === "NEW" ? "Your key\nsk-proj-abcdefghijklmnopqrstuvwxyz0123" : "fine" });
    reader.setEnabled({ enabled: true });
    await runUntil(() => read() === 2);
    expect(imageDb.imageTextFor(db, "new")).toEqual({ status: "done", text: "Your key\n•••••" });
  });

  it("stops a helper that sends endless output instead of an answer", async () => {
    answer = (bytes) => (bytes === "NEW" ? "flood" : { text: "fine" });
    reader.setEnabled({ enabled: true });
    await runUntil(() => received.includes("NEW"));
    // Stopped at once, not after the 60 s read timeout with a growing buffer.
    await runUntil(() => spawn.mock.results[0].value.kill.mock.calls.length > 0, 3);
    await runUntil(() => read() === 2);
    expect(received.filter((b) => b === "NEW")).toHaveLength(3);
    expect(imageDb.imageTextFor(db, "new").status).toBe("failed");
    expect(imageDb.imageTextFor(db, "old")).toEqual({ status: "done", text: "fine" });
  });

  it("redacts words stored by v2.4.0 when the database opens", () => {
    settingsFile.clipboardImageText = { enabled: true };
    db!.prepare("INSERT INTO bf_image_text (entry_id, status, text, read_at, redacted) VALUES ('old', 'done', ?, 'then', 0)").run(
      "Visa 4242 4242 4242 4242"
    );
    reader.onDatabaseAttached(db);
    expect(imageDb.imageTextFor(db, "old")).toEqual({ status: "done", text: "Visa •••••" });
  });

  it("deletes words left from a time it was off when the database opens", () => {
    imageDb.recordImageText(db, "old", { text: "stale" });
    reader.onDatabaseAttached(db);
    expect(read()).toBe(0);
  });
});
