/**
 * Words in clipboard images — reads the text in captured images in the
 * background so Clipboard search finds them. Opt-in, macOS only.
 *
 * Reading: resources/macos-ocr-helper (Apple's Vision text recognition, on
 * this Mac; nothing is uploaded or downloaded). Image bytes go to it over
 * stdin, one image at a time; a sealed image is decrypted in memory, never
 * written out. Only files inside WhisperWoof's own image folder are read.
 * The words go to bf_image_text in the history database (encrypted with it);
 * turning the feature off deletes them.
 *
 * Staying out of the way: the helper runs at background priority, one image
 * at a time. New copies are read a few seconds after they're captured; older
 * images newest first, resting after each. Nothing is read while the user
 * dictates or records a meeting, while the Mac is busy or hot, or while
 * WhisperWoof is locked; on battery only new copies are read.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, powerMonitor } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const pure = require("./clipboard-image-text-pure");
const store = require("./clipboard-image-text-db");
const vault = require("./vault/vault-service");
const vaultFiles = require("./vault/vault-files");
const { resolveAppFile } = require("./app-files");
const { buildSidecarEnv } = require("./sidecar-env-pure");
const { checkpoint } = require("./db-erase");

const BINARY = "macos-ocr-helper";
const STARTUP_DELAY_MS = 20000;
const RETRY_MS = 60000;
const READ_TIMEOUT_MS = 60000;
const HELPER_IDLE_MS = 30000;
const BACKLOG_BATCH = 50;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
/** Longer than any answer the helper sends (its text is capped at 20,000 characters). */
const MAX_ANSWER_CHARS = 1024 * 1024;
/** A crash or timeout on the same image this often marks it unreadable. */
const MAX_ATTEMPTS = 3;
/** The helper failing to start this often in a row turns reading off for this session. */
const MAX_START_FAILURES = 3;
/** Holding off for a dictation that never reported its end gives up after this. */
const DICTATION_MAX_MS = 10 * 60 * 1000;
/** After a dictation stops, its words are still being transcribed and polished. */
const AFTER_DICTATION_MS = 20000;
const USER_ACTIVE_IDLE_S = 60;
const COUNTS_MAX_AGE_MS = 30000;
const STATUS_THROTTLE_MS = 1000;
const SETTINGS_MAX_AGE_MS = 30000;

// Lazy: app-init requires this module too.
const database = () => require("./app-init").getWhisperWoofDb();

let started = false;
let hooked = false;
let timer = null;
let timerAt = 0;
let ticking = false;
let holdUntil = 0;
let meetingCheck = () => false;
let helper = null;
let helperIdleTimer = null;
let counts = null; // { total, read, withText, at }
let status = { state: "reading", reason: null };
let lastStatusSent = "";
let statusTimer = null;
let startFailures = 0;
let helperBroken = false;
const fresh = []; // ids captured since, oldest first
const backlog = []; // a batch of older unread images, newest first
const attempts = new Map();

let cachedSettings = null; // { value, at }

function settings() {
  if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_MAX_AGE_MS) return cachedSettings.value;
  let value;
  try {
    value = pure.normalizeImageText(require("./markdown-route").readSettings().clipboardImageText);
  } catch {
    value = { ...pure.DEFAULT_IMAGE_TEXT };
  }
  cachedSettings = { value, at: Date.now() };
  return value;
}

let cachedBinary;

function resolveBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const candidates = [
    path.join(__dirname, "..", "..", "..", "resources", "bin", BINARY),
    ...(process.resourcesPath
      ? [
          path.join(process.resourcesPath, BINARY),
          path.join(process.resourcesPath, "bin", BINARY),
          path.join(process.resourcesPath, "resources", "bin", BINARY),
          path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", BINARY),
        ]
      : []),
  ];
  cachedBinary =
    candidates.find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null;
  return cachedBinary;
}

function isAvailable() {
  return process.platform === "darwin" && resolveBinary() !== null && !helperBroken;
}

// ── The helper process ────────────────────────────────────────────────────

function settle(h, answer) {
  const waiting = h.waiting;
  if (!waiting) return;
  h.waiting = null;
  clearTimeout(waiting.timer);
  waiting.resolve(answer);
}

function startHelper() {
  let languages = ["en-US"];
  try {
    languages = pure.ocrLanguages(app.getPreferredSystemLanguages());
  } catch {
    // keep English
  }
  // No API keys or loader-injection variables: it only needs to read images.
  const child = spawn(resolveBinary(), ["--languages", languages.join(",")], {
    stdio: ["pipe", "pipe", "ignore"],
    env: buildSidecarEnv(process.env),
  });
  // Without a pid (it didn't start) setPriority would lower WhisperWoof itself.
  if (child.pid) {
    try {
      os.setPriority(child.pid, 19); // the helper also puts itself in the background band
    } catch {
      // not permitted or already gone
    }
  }
  const h = { child, waiting: null, buffer: "", ready: false };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    h.buffer += chunk;
    if (h.buffer.length > MAX_ANSWER_CHARS && !h.buffer.includes("\n")) {
      // Not the helper's wire format: stop it rather than buffer without end.
      h.buffer = "";
      settle(h, { error: "failed", crashed: true });
      if (helper === h) helper = null;
      h.child.kill("SIGKILL");
      return;
    }
    let newline;
    while ((newline = h.buffer.indexOf("\n")) >= 0) {
      const answer = pure.parseHelperAnswer(h.buffer.slice(0, newline));
      h.buffer = h.buffer.slice(newline + 1);
      if (answer.ready) {
        h.ready = true;
        startFailures = 0;
      } else {
        settle(h, answer);
      }
    }
  });
  // Gone before saying it's ready: the helper is broken, not the image.
  const gone = () => {
    settle(h, h.ready ? { error: "failed", crashed: true } : { error: "failed", startFailed: true });
    if (helper === h) helper = null;
  };
  child.on("error", gone);
  child.on("close", gone);
  child.stdin.on("error", () => {}); // EPIPE when it has exited; "close" answers
  return h;
}

/** Stop the helper now. An image it was reading is answered `{ retry: true }` (lock, off, quit). */
function killHelper() {
  clearTimeout(helperIdleTimer);
  if (!helper) return;
  const h = helper;
  helper = null;
  settle(h, { retry: true });
  try {
    h.child.kill("SIGKILL");
  } catch {
    // already gone
  }
}

/** Let the helper exit once there's been nothing to read for a while. */
function closeHelperSoon() {
  clearTimeout(helperIdleTimer);
  if (!helper) return;
  helperIdleTimer = setTimeout(() => {
    if (!helper || helper.waiting) return;
    const h = helper;
    helper = null;
    try {
      h.child.stdin.end(); // it exits at the end of its input
    } catch {
      h.child.kill();
    }
  }, HELPER_IDLE_MS);
  helperIdleTimer.unref?.();
}

function recognize(bytes) {
  clearTimeout(helperIdleTimer);
  if (!helper) helper = startHelper();
  const h = helper;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      settle(h, h.ready ? { error: "failed", crashed: true } : { error: "failed", startFailed: true });
      if (helper === h) {
        helper = null;
        h.child.kill("SIGKILL");
      }
    }, READ_TIMEOUT_MS);
    h.waiting = { resolve, timer: timeout };
    h.child.stdin.write(pure.frameHeader(bytes.length));
    h.child.stdin.write(bytes);
  });
}

// ── Reading one image ─────────────────────────────────────────────────────

function imagesDir() {
  return path.join(app.getPath("userData"), "whisperwoof-images");
}

/** The image's bytes (decrypted in memory when sealed), or a code: missing | locked. */
async function readImageBytes(storedPath) {
  const logical = resolveAppFile(storedPath, [imagesDir()]);
  if (!logical) return { missing: true };
  const physical = vaultFiles.physicalPath(logical);
  if (!physical) return { missing: true };
  const raw = await fs.promises.readFile(physical);
  if (physical === logical) return { bytes: raw, sealed: false };
  if (!vault.isUnlocked()) return { locked: true };
  return { bytes: vault.openSealed(raw).plaintext, sealed: true };
}

/** → { text } | { failed: true } (never readable) | { retry: true } (try again later) */
async function readImage(storedPath, id) {
  let file;
  try {
    file = await readImageBytes(storedPath);
  } catch (err) {
    if (err.code === "ENOENT") return { failed: true };
    debugLogger.debug("[WhisperWoof] Image text: couldn't open an image", { error: err.message });
    return countAttempt(id);
  }
  if (file.missing) return { failed: true };
  if (file.locked) return { retry: true };
  const { bytes } = file;
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { failed: true };
  try {
    const answer = await recognize(bytes);
    if (answer.retry) return { retry: true };
    if (answer.startFailed) {
      startFailures += 1;
      if (startFailures >= MAX_START_FAILURES) {
        helperBroken = true;
        debugLogger.log("[WhisperWoof] Image text helper doesn't start; reading words in images is off until restart");
      }
      return { retry: true };
    }
    if (answer.crashed) return countAttempt(id);
    if (answer.error) return { failed: true };
    return { text: answer.text };
  } finally {
    if (file.sealed) bytes.fill(0); // the helper has answered (or is gone): drop the plaintext
  }
}

function countAttempt(id) {
  const n = (attempts.get(id) ?? 0) + 1;
  attempts.set(id, n);
  return n >= MAX_ATTEMPTS ? { failed: true } : { retry: true };
}

// ── What to read next ─────────────────────────────────────────────────────

function nextImage(db, freshOnly) {
  while (fresh.length > 0) {
    const id = fresh.shift();
    const row = store.unreadImage(db, id);
    if (row) return { id: row.id, storedPath: row.audio_path, fresh: true };
  }
  if (freshOnly) return null;
  if (backlog.length === 0) backlog.push(...store.unreadImages(db, BACKLOG_BATCH));
  while (backlog.length > 0) {
    // Still there and still unread (it may have been removed, or read as a new copy).
    const row = store.unreadImage(db, backlog.shift().id);
    if (row) return { id: row.id, storedPath: row.audio_path, fresh: false };
  }
  return null;
}

function currentCounts(db, { refresh = false } = {}) {
  if (!db) return counts;
  if (refresh || !counts || Date.now() - counts.at > COUNTS_MAX_AGE_MS) {
    counts = { ...store.countImageText(db), at: Date.now() };
  }
  return counts;
}

function thermalState() {
  try {
    return typeof powerMonitor.getCurrentThermalState === "function" ? powerMonitor.getCurrentThermalState() : "unknown";
  } catch {
    return "unknown";
  }
}

function onBattery() {
  try {
    return typeof powerMonitor.isOnBatteryPower === "function"
      ? powerMonitor.isOnBatteryPower()
      : Boolean(powerMonitor.onBatteryPower);
  } catch {
    return false;
  }
}

function userActive() {
  try {
    return powerMonitor.getSystemIdleTime() < USER_ACTIVE_IDLE_S;
  } catch {
    return true;
  }
}

const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length || 1;

function meetingRecording() {
  try {
    return Boolean(meetingCheck());
  } catch {
    return false;
  }
}

// ── The loop ──────────────────────────────────────────────────────────────

/** Run the next step in `ms` (sooner wins over later). */
function schedule(ms) {
  const at = Date.now() + ms;
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, ms);
  timer.unref?.();
}

function cancelSchedule() {
  clearTimeout(timer);
  timer = null;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const db = database();
    const c = currentCounts(db);
    const decision = pure.decidePace({
      enabled: settings().enabled,
      available: isAvailable(),
      dbOpen: Boolean(db),
      hasFresh: fresh.length > 0,
      hasBacklog: Boolean(c && c.read < c.total),
      now: Date.now(),
      holdUntil,
      meetingRecording: meetingRecording(),
      thermal: thermalState(),
      onBattery: onBattery(),
      loadRatio: os.loadavg()[0] / cores,
    });
    if (!decision.run) {
      setStatus(decision.state, decision.reason);
      if (decision.state === "off" || decision.state === "unavailable") killHelper();
      else closeHelperSoon();
      if (decision.retryMs) schedule(decision.retryMs);
      return;
    }
    const next = nextImage(db, decision.freshOnly);
    if (!next) {
      // The counts were behind (images removed meanwhile): recount.
      const now = currentCounts(db, { refresh: true });
      const unread = now.read < now.total;
      closeHelperSoon();
      if (!unread) setStatus("done", null);
      else if (decision.freshOnly) setStatus("paused", "battery");
      if (unread) schedule(RETRY_MS);
      return;
    }
    setStatus("reading", null);
    const startedAt = Date.now();
    const result = await readImage(next.storedPath, next.id);
    if (result.retry) {
      if (next.fresh) fresh.unshift(next.id);
      else backlog.unshift({ id: next.id, audio_path: next.storedPath });
      schedule(RETRY_MS);
      return;
    }
    attempts.delete(next.id);
    const dbNow = database(); // it may have closed (lock) while the image was read
    if (dbNow && settings().enabled && store.recordImageText(dbNow, next.id, result.failed ? { failed: true } : { text: result.text })) {
      if (counts) {
        counts.read += 1;
        if (result.text) counts.withText += 1;
      }
      if (next.fresh && result.text) require("./clipboard-store").notifyChanged();
    }
    sendStatus();
    schedule(pure.restAfter(Date.now() - startedAt, { fresh: next.fresh, userActive: userActive() }));
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Image text step failed", { error: err.message });
    schedule(RETRY_MS);
  } finally {
    ticking = false;
  }
}

// ── Status for the Clipboard view ─────────────────────────────────────────

function getStatus() {
  const { enabled } = settings();
  const available = isAvailable();
  const c = currentCounts(database());
  let { state, reason } = status;
  if (!enabled) state = "off";
  else if (!available) state = "unavailable";
  else if (c && c.read >= c.total && fresh.length === 0) state = "done";
  else if (state === "off" || state === "unavailable" || state === "done") state = "reading"; // starts soon
  return {
    enabled,
    available,
    encrypted: vault.isOn(),
    state,
    reason: state === "paused" ? (reason ?? null) : null,
    total: c?.total ?? 0,
    read: c?.read ?? 0,
    withText: c?.withText ?? 0,
  };
}

function setStatus(state, reason = null) {
  if (status.state === state && status.reason === reason) return;
  status = { state, reason: reason ?? null };
  sendStatus();
}

/** Tell open windows how reading is going (at most once a second). */
function sendStatus() {
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    let next;
    try {
      next = getStatus();
    } catch {
      return;
    }
    const key = JSON.stringify(next);
    if (key === lastStatusSent) return;
    lastStatusSent = key;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("whisperwoof-clipboard-image-text-status", next);
    }
  }, STATUS_THROTTLE_MS);
  statusTimer.unref?.();
}

// ── Public ────────────────────────────────────────────────────────────────

/** Start with the app. Waits a little so launch isn't slowed down. */
function start() {
  if (started) return;
  started = true;
  if (!hooked) {
    hooked = true;
    // Keys go away on lock: stop reading first, so no decrypted image is in flight.
    vault.onLocking(async () => {
      killHelper();
      backlog.length = 0;
      setStatus("paused", "locked");
    });
  }
  if (settings().enabled) schedule(STARTUP_DELAY_MS);
}

function stop() {
  cancelSchedule();
  killHelper();
  started = false;
}

/**
 * The database opened (startup, unlock, after an encryption change): carry
 * on reading, or delete words left from a time the feature was turned off.
 * Words read before secrets were redacted are redacted first.
 */
function onDatabaseAttached(db) {
  counts = null;
  cachedSettings = null;
  if (settings().enabled) {
    try {
      const changed = store.redactStoredImageText(db);
      if (changed > 0) {
        checkpoint(db);
        debugLogger.log(`[WhisperWoof] Image text: hid secrets in the words of ${changed} image(s)`);
      }
    } catch (err) {
      debugLogger.debug("[WhisperWoof] Image text redaction skipped", { error: err.message });
    }
    if (started) schedule(5000);
    return;
  }
  try {
    if (store.deleteAllImageText(db) > 0) checkpoint(db);
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Image text cleanup skipped", { error: err.message });
  }
}

/** A new image was captured: read it in a moment. */
function noteNewImage(id) {
  if (!id || !settings().enabled) return;
  fresh.push(id);
  if (counts) counts.total += 1;
  schedule(pure.FRESH_DELAY_MS);
}

/** Dictation started or stopped: step aside while it runs and while its words are processed. */
function setDictating(active) {
  holdUntil = Date.now() + (active ? DICTATION_MAX_MS : AFTER_DICTATION_MS);
  if (!active && settings().enabled) schedule(AFTER_DICTATION_MS + 250);
}

/** `fn()` → true while a meeting is recording (reading waits). */
function setMeetingCheck(fn) {
  meetingCheck = typeof fn === "function" ? fn : () => false;
}

/**
 * Turn reading on or off. Off stops it and deletes every word read so far.
 * → { imageText: status, deleted }
 */
function setEnabled(raw) {
  const next = pure.normalizeImageText(raw);
  require("./markdown-route").updateSettings({ clipboardImageText: next });
  cachedSettings = { value: next, at: Date.now() };
  let deleted = 0;
  if (next.enabled) {
    counts = null;
    setStatus("reading", null);
    schedule(1000);
  } else {
    cancelSchedule();
    killHelper();
    fresh.length = 0;
    backlog.length = 0;
    attempts.clear();
    const db = database();
    if (db) {
      deleted = store.deleteAllImageText(db);
      if (deleted > 0) checkpoint(db); // and out of the WAL
    }
    counts = null;
    setStatus("off", null);
    debugLogger.log(`[WhisperWoof] Image text turned off; removed text of ${deleted} image(s)`);
  }
  return { imageText: getStatus(), deleted };
}

module.exports = {
  start,
  stop,
  onDatabaseAttached,
  noteNewImage,
  setDictating,
  setMeetingCheck,
  setEnabled,
  getStatus,
  isAvailable,
};
