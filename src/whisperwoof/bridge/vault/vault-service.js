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

function readVaultFile(file) {
  try {
    return vk.parseVault(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Read vault.json (falling back to its backup). Call once at startup. */
function load() {
  const exists = fs.existsSync(vaultPaths.vaultFile()) || fs.existsSync(vaultPaths.vaultBackup());
  vault = readVaultFile(vaultPaths.vaultFile()) || readVaultFile(vaultPaths.vaultBackup());
  damaged = exists && !vault;
  return status();
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

function saveVault(next) {
  ensurePrivateDir(vaultPaths.dir());
  const json = JSON.stringify(next, null, 2);
  writeFileAtomic(vaultPaths.vaultFile(), json);
  writeFileAtomic(vaultPaths.vaultBackup(), json);
  vault = next;
  damaged = false;
  notifyState();
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

function setRotation({ sealPublic, oldPrivateKeys }) {
  sealOverride = sealPublic;
  extraOpenKeys = oldPrivateKeys;
}

function clearRotation() {
  sealOverride = null;
  extraOpenKeys = [];
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

/** Turning encryption on: the vault exists from here on, already unlocked. */
async function adoptNewVault(nextVault, nextMasterKey) {
  saveVault(nextVault);
  return becomeUnlocked(nextMasterKey);
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
  saveVault,
  sealPublicRaw,
  openSealed,
  setRotation,
  clearRotation,
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
  exclusive,
  onUnlocked,
  onLocking,
  onStateChange,
  addLockBlocker,
  notifyState,
};
