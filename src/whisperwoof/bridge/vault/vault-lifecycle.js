/**
 * Wires the vault into the app. main.js calls configure() once with what it
 * owns (database open/close, inbox handlers, windows); this module registers
 * the ordered unlock/lock steps and the automatic lock triggers.
 *
 * On unlock: finish an interrupted migration → open databases → replay inbox.
 * On lock:   close databases (keys are dropped by the vault service after).
 */

const { powerMonitor } = require("electron");
const debugLogger = require("../../../helpers/debugLogger");
const vault = require("./vault-service");
const vaultInbox = require("./vault-inbox");
const migrate = require("./vault-migrate");
const rotation = require("./vault-rotate");

const IDLE_CHECK_MS = 30000;

let deps = null;
let progress = null; // { direction, phase, done, total, error? } while a migration runs
let idleTimer = null;
const statusListeners = [];

function requireDeps() {
  if (!deps) throw new Error("Vault lifecycle isn't configured");
  return deps;
}

function setProgress(next) {
  progress = next;
  for (const fn of statusListeners) fn();
}

function getProgress() {
  return progress;
}

function onProgress(fn) {
  statusListeners.push(fn);
}

/**
 * Run (or resume) a migration with the app's databases closed. Turning
 * encryption off forgets the vault only after every file is plain again.
 */
async function runMigration(direction, { sealNotes } = {}) {
  const d = requireDeps();
  setProgress({ direction, phase: "db", done: 0, total: 1 });
  await d.closeDatabases();
  try {
    await migrate.run(direction, {
      Database: d.Database,
      userData: d.userData(),
      notesDir: d.notesDir(),
      sealNotes: sealNotes ?? !vault.getPrefs().notesReadable,
      onProgress: (p) => setProgress(p),
    });
    if (direction === "disable") await vault.forgetVault();
    setProgress(null);
  } catch (err) {
    debugLogger.error("[Vault] Migration stopped", { direction, error: err.message });
    setProgress({ direction, phase: "error", done: 0, total: 0, error: err.message });
    throw err;
  } finally {
    await d.openDatabases();
  }
}

async function replayInbox() {
  const d = requireDeps();
  if (vaultInbox.count() === 0) return;
  const result = await vaultInbox.replay(d.inboxHandlers(), (file, err) =>
    debugLogger.warn("[Vault] Inbox item kept for later", { file, error: err.message })
  );
  debugLogger.info("[Vault] Inbox replayed", result);
  d.afterInboxReplay?.(result);
}

async function afterUnlock() {
  const journal = migrate.readJournal();
  if (journal && journal.direction === "rotate") {
    // A new recovery phrase was being rolled out; finishing it reopens the databases.
    await rotation.finish().catch((err) => {
      debugLogger.error("[Vault] New recovery phrase didn't finish", { error: err.message });
      setProgress({ direction: "rotate", phase: "error", done: 0, total: 0, error: err.message });
    });
    if (!getProgress()) return;
    await requireDeps().openDatabases();
  } else if (journal) {
    // Resume what a crash or quit interrupted; runMigration reopens the databases.
    await runMigration(journal.direction).catch(() => {});
  } else {
    await requireDeps().openDatabases();
  }
  if (vault.isUnlocked()) await replayInbox();
}

/** Seal or unseal every note (the "Keep notes readable by other apps" switch). */
async function convertNotes(seal) {
  try {
    migrate.convertNotes(requireDeps().notesDir(), seal, (p) => setProgress(p));
  } finally {
    setProgress(null);
  }
}

async function beforeLock() {
  await requireDeps().closeDatabases();
  requireDeps().afterLock?.();
}

function checkIdle() {
  const minutes = vault.getPrefs().idleMinutes;
  if (!minutes || !vault.isUnlocked() || progress) return;
  if (powerMonitor.getSystemIdleTime() >= minutes * 60) {
    vault.lock().catch(() => {});
  }
}

function lockOnSleep() {
  if (vault.isUnlocked() && vault.getPrefs().lockOnSleep && !progress) vault.lock().catch(() => {});
}

/**
 * deps: { Database, userData(), notesDir(), openDatabases(), closeDatabases(),
 *         inboxHandlers(), afterInboxReplay?(result), afterLock?() }
 */
function configure(nextDeps) {
  deps = nextDeps;
  rotation.configure({ ...nextDeps, onProgress: (p) => setProgress(p) });
  vault.onUnlocked(afterUnlock);
  vault.onLocking(beforeLock);
  powerMonitor.on("lock-screen", lockOnSleep);
  powerMonitor.on("suspend", lockOnSleep);
  clearInterval(idleTimer);
  idleTimer = setInterval(checkIdle, IDLE_CHECK_MS);
  idleTimer.unref?.();
}

module.exports = { configure, runMigration, convertNotes, replayInbox, getProgress, onProgress };
