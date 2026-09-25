/**
 * Wires the vault into the app. main.js calls configure() once with what it
 * owns (database open/close, inbox handlers, windows); this module registers
 * the ordered unlock/lock steps and the automatic lock triggers.
 *
 * On unlock: finish an interrupted migration → open databases → replay inbox.
 * On lock:   close databases (keys are dropped by the vault service after).
 *
 * A running migration holds off automatic locks; a failed one doesn't — it
 * leaves an error the Encryption settings show with "Try again".
 */

const { powerMonitor } = require("electron");
const debugLogger = require("../../../helpers/debugLogger");
const vault = require("./vault-service");
const vaultInbox = require("./vault-inbox");
const migrate = require("./vault-migrate");
const rotation = require("./vault-rotate");

const IDLE_CHECK_MS = 30000;

let deps = null;
let progress = null; // { direction, phase, done, total } while something runs
let lastError = null; // { direction, message } from the last run that stopped
let idleTimer = null;
let replayChain = Promise.resolve();
const statusListeners = [];

function requireDeps() {
  if (!deps) throw new Error("Vault lifecycle isn't configured");
  return deps;
}

function notify() {
  for (const fn of statusListeners) fn();
}

function setProgress(next) {
  progress = next;
  notify();
}

function setError(direction, err) {
  lastError = err ? { direction, message: err.message } : null;
  if (err) debugLogger.error("[Vault] Stopped", { direction, error: err.message });
  notify();
}

function getProgress() {
  return progress;
}

function getError() {
  return lastError;
}

function onProgress(fn) {
  statusListeners.push(fn);
}

async function reopenDatabases() {
  try {
    await requireDeps().openDatabases();
  } catch (err) {
    debugLogger.error("[Vault] Databases didn't reopen", { error: err.message });
  }
}

/**
 * Run (or resume) a migration with the app's databases closed. Turning
 * encryption off forgets the vault only after every file is plain again.
 */
async function runMigration(direction, { sealNotes } = {}) {
  const d = requireDeps();
  setError(direction, null);
  setProgress({ direction, phase: direction === "disable" ? "files" : "db", done: 0, total: 1 });
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
  } catch (err) {
    setError(direction, err);
    throw err;
  } finally {
    setProgress(null);
    await reopenDatabases();
  }
}

/** A new recovery phrase: `start` writes the plan, rotation.finish() carries it out. */
async function runRotation(start = () => rotation.finish()) {
  setError("rotate", null);
  try {
    await start();
  } catch (err) {
    setError("rotate", err);
    throw err;
  } finally {
    setProgress(null);
    await reopenDatabases();
  }
}

/** Replays run one at a time, in the order they were asked for. */
function replayInbox() {
  const run = async () => {
    const d = requireDeps();
    if (!vault.isUnlocked() || vaultInbox.count() === 0) return;
    const { handlers, loadIdMap } = d.inbox();
    const result = await vaultInbox.replay(handlers, {
      idMap: loadIdMap(),
      log: (file, err) => debugLogger.warn("[Vault] Inbox item kept for later", { file, error: err.message }),
    });
    debugLogger.info("[Vault] Inbox replayed", result);
    notify();
  };
  replayChain = replayChain.then(run, run);
  return replayChain;
}

async function afterUnlock() {
  const journal = migrate.readJournal();
  if (journal && journal.direction === "rotate") {
    // A new recovery phrase was being rolled out; finish it (it reopens the databases).
    await runRotation().catch(() => {});
  } else if (journal) {
    // Resume what a crash or quit interrupted; runMigration reopens the databases.
    await runMigration(journal.direction).catch(() => {});
  } else {
    await reopenDatabases();
  }
  if (vault.isUnlocked()) await replayInbox();
}

/** "Try again" after a stop: resume whatever the journal says, then replay the inbox. */
async function retry() {
  const journal = migrate.readJournal();
  if (journal && journal.direction === "rotate") await runRotation();
  else if (journal) await runMigration(journal.direction);
  else {
    setError(null, null);
    await reopenDatabases();
  }
  await replayInbox();
}

/** Seal or unseal every note (the "Keep notes readable by other apps" switch). */
async function convertNotes(seal) {
  setError("notes", null);
  try {
    migrate.convertNotes(requireDeps().notesDir(), seal, (p) => setProgress(p));
  } catch (err) {
    setError("notes", err);
    throw err;
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
 *         inbox() → { handlers, loadIdMap }, afterLock?() }
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

module.exports = {
  configure,
  runMigration,
  runRotation,
  retry,
  convertNotes,
  replayInbox,
  getProgress,
  getError,
  onProgress,
};
