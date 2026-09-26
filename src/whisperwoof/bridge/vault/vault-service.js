/**
 * Vault service — the one place that knows whether encryption is on, whether
 * WhisperWoof is locked, and holds the keys while it's unlocked. Main process
 * only; keys never reach a renderer.
 *
 * Lifecycle hooks run in registration order:
 *   onUnlocked(fn) — after the keys are available (open databases, replay inbox…)
 *   onLocking(fn)  — before the keys are dropped (close databases…)
 * A lock blocker (e.g. a meeting that is recording) defers a lock until it clears.
 */

const fs = require("fs");
const debugLogger = require("../../../helpers/debugLogger");
const vk = require("./vault-keys-pure");
const vc = require("./vault-crypto-pure");
const ww = require("./wwenc-pure");
const path = require("path");
const { sqliteState } = require("./migration-plan-pure");
const { vaultPaths, ensurePrivateDir, writeFileAtomic, removeIfExists } = require("./vault-paths");

class VaultLockedError extends Error {
  constructor(message = "WhisperWoof is locked") {
    super(message);
    this.name = "VaultLockedError";
    this.code = "LOCKED";
  }
}

const unlockedHooks = [];
const lockingHooks = [];
const stateListeners = [];
const lockBlockers = [];

let vault = null; // parsed vault.json, or null when encryption is off
let damaged = false; // vault files exist but can't be read: only the phrase can open it
let masterKey = null;
let keys = null; // { dbKeyHex, sealPrivateKey, sealPublicRaw }
let pendingLock = false;
let busy = false;
// While a new recovery phrase is being rolled out: new files are sealed to the
// new key, and files still sealed to the old key keep opening.
let sealOverride = null;
let extraOpenKeys = [];
let extraDbKeyHexes = [];

function readVaultFile(file) {
  try {
    return vk.parseVault(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function readHead(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(16);
      return head.subarray(0, fs.readSync(fd, head, 0, 16, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Sealed files WhisperWoof itself keeps (not the notes folder): the inbox, stores, media. */
function sealedFilesOnDisk() {
  const userData = path.dirname(vaultPaths.dir());
  const dirs = [vaultPaths.inboxDir(), userData, path.join(userData, "audio"), path.join(userData, "whisperwoof-images")];
  return dirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir).filter((n) => n.endsWith(".wwenc")).map((n) => path.join(dir, n));
    } catch {
      return [];
    }
  });
}

function databaseIsEncrypted() {
  return sqliteState(readHead(vaultPaths.dbFile())) === "encrypted";
}

/**
 * Read vault.json (falling back to its backup). Call once at startup. If it's
 * missing or unreadable while encrypted data is still on disk, WhisperWoof
 * stays locked (damaged) — never "off", which would write plaintext over it.
 */
function load() {
  const exists = fs.existsSync(vaultPaths.vaultFile()) || fs.existsSync(vaultPaths.vaultBackup());
  vault = readVaultFile(vaultPaths.vaultFile()) || readVaultFile(vaultPaths.vaultBackup());
  damaged = !vault && (exists || databaseIsEncrypted() || sealedFilesOnDisk().length > 0);
  removeStaleLeftovers();
  return status();
}

/**
 * vault.next.json holds the new master key sealed under the old one; it must
 * not outlive its rotation. A journal without a vault never started.
 */
function removeStaleLeftovers() {
  let journal = null;
  try {
    journal = require("./migration-plan-pure").parseJournal(JSON.parse(fs.readFileSync(vaultPaths.journal(), "utf8")));
  } catch {
    journal = null;
  }
  if (!journal || journal.direction !== "rotate") removeIfExists(vaultPaths.nextVaultFile());
  if (journal && !isOn()) removeIfExists(vaultPaths.journal());
  emptyTmp();
}

/** Plaintext handed out for a moment (a kept file pasted back) lives only here. */
function emptyTmp() {
  fs.rmSync(vaultPaths.tmpDir(), { recursive: true, force: true });
}

/** Do these keys open the encrypted data on disk? No data at all counts as yes. */
function keysOpenData(keys) {
  if (databaseIsEncrypted()) {
    try {
      const Database = require("better-sqlite3-multiple-ciphers");
      require("./vault-db").applyKey(new Database(vaultPaths.dbFile(), { readonly: true }), keys.dbKeyHex).close();
      return true;
    } catch {
      return false;
    }
  }
  const sample = sealedFilesOnDisk()[0];
  return !sample || ww.opensWith(fs.readFileSync(sample), keys.sealPrivateKey);
}

/** Keep an unreadable vault file for later inspection instead of overwriting it. */
function moveDamagedVaultAside() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const file of [vaultPaths.vaultFile(), vaultPaths.vaultBackup()]) {
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.damaged-${stamp}`);
  }
}

function isOn() {
  return Boolean(vault) || damaged;
}

function isUnlocked() {
  return Boolean(keys);
}

function status() {
  if (!isOn()) return "off";
  return isUnlocked() ? "unlocked" : "locked";
}

function getVault() {
  return vault;
}

function isDamaged() {
  return damaged;
}

function getPrefs() {
  return vault ? vault.prefs : { ...vk.DEFAULT_PREFS };
}

/** Whether notes are written sealed (encryption on, "keep notes readable" off). */
function sealsNotes() {
  return isOn() && !getPrefs().notesReadable;
}

function saveVault(next, { notify = true } = {}) {
  ensurePrivateDir(vaultPaths.dir());
  const json = JSON.stringify(next, null, 2);
  writeFileAtomic(vaultPaths.vaultFile(), json);
  writeFileAtomic(vaultPaths.vaultBackup(), json);
  vault = next;
  damaged = false;
  if (notify) notifyState();
  return next;
}

function deleteVaultFiles() {
  removeIfExists(vaultPaths.vaultFile());
  removeIfExists(vaultPaths.vaultBackup());
  removeIfExists(vaultPaths.nextVaultFile());
  vault = null;
  damaged = false;
}

/** The public sealing key — available while locked, so writes never need an unlock. */
function sealPublicRaw() {
  if (sealOverride) return sealOverride;
  if (!vault) throw new VaultLockedError("Encryption is off");
  return vk.sealPublicKey(vault);
}

/** Decrypt a sealed file with the vault's key (or, mid-rotation, the previous one). */
function openSealed(bytes, opts) {
  const primary = requireKeys().sealPrivateKey;
  const key = [primary, ...extraOpenKeys].find((k) => ww.opensWith(bytes, k)) || primary;
  return ww.decrypt(bytes, key, opts);
}

/**
 * While a new recovery phrase rolls out: seal new files to the new key, and
 * accept the new keys for reading files and opening the database next to the
 * current ones. Left in place if the rollout stops, so the session keeps working.
 */
function setRotation({ sealPublic, extraPrivateKeys, extraDbKeys }) {
  sealOverride = sealPublic;
  extraOpenKeys = extraPrivateKeys;
  extraDbKeyHexes = extraDbKeys;
}

function clearRotation() {
  sealOverride = null;
  extraOpenKeys = [];
  extraDbKeyHexes = [];
}

function extraDbKeys() {
  return keys ? [...extraDbKeyHexes] : [];
}

function requireKeys() {
  if (!keys) throw new VaultLockedError();
  return keys;
}

function requireMasterKey() {
  if (!masterKey) throw new VaultLockedError();
  return masterKey;
}

async function runHooks(hooks, label) {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (err) {
      debugLogger.error(`[Vault] ${label} step failed`, { error: err.message });
    }
  }
}

/** Accept a master key (already verified against the vault) and open everything. */
async function becomeUnlocked(nextMasterKey) {
  if (!vk.verifySealKey(vault, nextMasterKey)) {
    // vault.json's public key was changed on disk. Put the real one back.
    debugLogger.error("[Vault] Sealing key in vault.json didn't match; restored it");
    saveVault({ ...vault, sealPublicKey: vk.deriveKeys(nextMasterKey).sealPublicRaw.toString("base64") });
  }
  vc.wipe(masterKey);
  masterKey = nextMasterKey;
  keys = vk.deriveKeys(masterKey);
  pendingLock = false;
  await runHooks(unlockedHooks, "unlock");
  notifyState();
}

async function unlockWithPassword(password) {
  if (!vault) throw new Error("Encryption is off");
  return becomeUnlocked(vk.unlockWithPassword(vault, password));
}

/** The phrase opens the vault even if vault.json is damaged; it then needs a new password. */
async function unlockWithEntropy(entropy, newPassword) {
  if (vault) {
    const mk = vk.masterKeyFromEntropy(entropy, vault);
    saveVault(vk.setPassword(vault, mk, newPassword));
    return becomeUnlocked(mk);
  }
  if (!damaged) throw new Error("Encryption is off");
  const rebuilt = vk.createVault({ entropy, password: newPassword });
  // Without vault.json there's no check value: prove the phrase on the data itself.
  if (!keysOpenData(vk.deriveKeys(rebuilt.masterKey))) {
    vc.wipe(rebuilt.masterKey);
    throw new vk.WrongPhraseError();
  }
  moveDamagedVaultAside();
  saveVault(rebuilt.vault);
  return becomeUnlocked(rebuilt.masterKey);
}

async function unlockWithTouchIdSecret(shared) {
  if (!vault) throw new Error("Encryption is off");
  return becomeUnlocked(vk.unlockWithTouchIdSecret(vault, shared));
}

/** Lock now, unless something (a recording meeting) needs the keys — then lock when it ends. */
async function lock({ force = false } = {}) {
  if (!isUnlocked()) return { locked: true };
  if (!force && lockBlockers.some((blocked) => blocked())) {
    pendingLock = true;
    notifyState();
    return { locked: false, deferred: true };
  }
  await runHooks(lockingHooks, "lock");
  emptyTmp();
  vc.wipe(masterKey);
  masterKey = null;
  keys = null;
  pendingLock = false;
  notifyState();
  return { locked: true };
}

/** Call when a lock blocker clears (e.g. the meeting ended). */
async function releaseDeferredLock() {
  if (pendingLock && !lockBlockers.some((blocked) => blocked())) await lock();
}

function isLockDeferred() {
  return pendingLock;
}

/** Something (a recording meeting) needs its files left alone right now. */
function isLockBlocked() {
  return lockBlockers.some((blocked) => blocked());
}

/** Only one sensitive operation (setup, migration, rotation) at a time. */
async function exclusive(fn) {
  if (busy) {
    const err = new Error("Another encryption task is running");
    err.code = "BUSY";
    throw err;
  }
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

/**
 * Turning encryption on: the vault exists from here on, already unlocked.
 * vault.json is written first; `beforeUnlock` (e.g. writing the migration
 * journal) runs between, so a crash never leaves a journal without a vault.
 * Nobody sees a "locked" state in between.
 */
async function adoptNewVault(nextVault, nextMasterKey, { beforeUnlock } = {}) {
  saveVault(nextVault, { notify: false });
  if (beforeUnlock) beforeUnlock();
  return becomeUnlocked(nextMasterKey);
}

/** A new recovery phrase is in place: switch to its vault and keys, no unlock steps. */
function replaceVault(nextVault, nextMasterKey) {
  if (!vk.verifyMasterKey(nextVault, nextMasterKey)) throw new Error("Master key doesn't belong to the new vault");
  saveVault(nextVault, { notify: false });
  vc.wipe(masterKey);
  masterKey = nextMasterKey;
  keys = vk.deriveKeys(masterKey);
  clearRotation();
  notifyState();
}

/** Turning encryption off finished: forget the vault. */
async function forgetVault() {
  vc.wipe(masterKey);
  masterKey = null;
  keys = null;
  deleteVaultFiles();
  notifyState();
}

function onUnlocked(fn) {
  unlockedHooks.push(fn);
}

function onLocking(fn) {
  lockingHooks.push(fn);
}

function onStateChange(fn) {
  stateListeners.push(fn);
}

function addLockBlocker(fn) {
  lockBlockers.push(fn);
}

function notifyState() {
  for (const fn of stateListeners) {
    try {
      fn(status());
    } catch {
      // A listener's failure must not affect the vault.
    }
  }
}

module.exports = {
  VaultLockedError,
  load,
  isOn,
  isUnlocked,
  isDamaged,
  status,
  getVault,
  getPrefs,
  sealsNotes,
  saveVault,
  sealPublicRaw,
  openSealed,
  setRotation,
  clearRotation,
  extraDbKeys,
  replaceVault,
  requireKeys,
  requireMasterKey,
  unlockWithPassword,
  unlockWithEntropy,
  unlockWithTouchIdSecret,
  adoptNewVault,
  forgetVault,
  lock,
  releaseDeferredLock,
  isLockDeferred,
  isLockBlocked,
  exclusive,
  onUnlocked,
  onLocking,
  onStateChange,
  addLockBlocker,
  notifyState,
};
