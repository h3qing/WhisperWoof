/**
 * What the Encryption settings and the lock screen can ask for. Every call
 * returns { success: true } or { success: false, error, code }; keys never
 * leave the main process. The recovery phrase is the one secret shown to the
 * renderer, once, at setup — it has to be, so the user can write it down.
 */

const crypto = require("crypto");
const vk = require("./vault-keys-pure");
const phrase = require("./recovery-phrase-pure");
const vault = require("./vault-service");
const vaultInbox = require("./vault-inbox");
const touchId = require("./vault-touchid");
const lifecycle = require("./vault-lifecycle");
const migrate = require("./vault-migrate");
const rotation = require("./vault-rotate");
const { vaultPaths, ensurePrivateDir, writeFileAtomic } = require("./vault-paths");
const planPure = require("./migration-plan-pure");

const SETUP_TTL_MS = 30 * 60 * 1000;
const TOUCH_ID_REASON = "unlock your WhisperWoof history and notes";

let setup = null; // { entropy, words, confirmIndexes, expires, purpose: "setup" | "rotate" }
let touchIdAvailability = { available: false, reason: "unavailable" };
let reenrollTouchId = false;
const statusListeners = [];

const ok = (extra = {}) => ({ success: true, ...extra });
const fail = (error, code) => ({ success: false, error, code });

function errorResult(err) {
  const known = ["WRONG_PASSWORD", "WRONG_PHRASE", "LOCKED", "CANCELLED", "FALLBACK", "INVALIDATED", "LOCKOUT", "UNAVAILABLE", "BUSY"];
  return fail(err.message, known.includes(err.code) ? err.code : undefined);
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err);
  }
}

async function refreshTouchIdAvailability() {
  touchIdAvailability = await touchId.getAvailability().catch(() => ({ available: false, reason: "unavailable" }));
  notify();
  return touchIdAvailability;
}

function migrationStatus() {
  const progress = lifecycle.getProgress();
  if (progress) return { ...progress, needsUnlock: false };
  const journal = migrate.readJournal();
  if (!journal) return null;
  return { direction: journal.direction, phase: journal.phase, done: 0, total: 0, needsUnlock: !vault.isUnlocked() };
}

function getStatus() {
  return {
    status: vault.status(),
    migrating: migrationStatus(),
    prefs: vault.getPrefs(),
    touchId: touchIdAvailability,
    inboxCount: vault.isOn() ? vaultInbox.count() : 0,
    lockDeferred: vault.isLockDeferred(),
    platformSupported: process.platform === "darwin",
  };
}

function onStatus(fn) {
  statusListeners.push(fn);
}

function notify() {
  const status = getStatus();
  for (const fn of statusListeners) fn(status);
}

vault.onStateChange(notify);
lifecycle.onProgress(notify);

// ---------- setup (turning encryption on) ----------

function newPhraseSession(purpose) {
  const entropy = crypto.randomBytes(phrase.ENTROPY_BYTES);
  setup = {
    purpose,
    entropy,
    words: phrase.entropyToWords(entropy),
    confirmIndexes: phrase.pickConfirmIndexes(3),
    expires: Date.now() + SETUP_TTL_MS,
  };
  return { words: setup.words, confirmIndexes: setup.confirmIndexes };
}

function takeConfirmedSession(purpose, confirmWords) {
  if (!setup || setup.purpose !== purpose || Date.now() > setup.expires) {
    throw Object.assign(new Error("That took too long. Start again."), { code: "INVALID" });
  }
  const typed = confirmWords || {};
  const allMatch = setup.confirmIndexes.every(
    (i) => String(typed[i] ?? "").trim().toLowerCase() === setup.words[i]
  );
  if (!allMatch) throw Object.assign(new Error("Those words don't match your recovery phrase."), { code: "INVALID" });
  const session = setup;
  setup = null;
  return session;
}

function beginSetup() {
  if (vault.isOn()) return fail("Encryption is already on", "INVALID");
  return ok(newPhraseSession("setup"));
}

/** Enroll a Secure Enclave key for the vault's current master key. `test` asks for one touch. */
async function enrollTouchId({ test }) {
  const availability = await refreshTouchIdAvailability();
  if (!availability.available) throw Object.assign(new Error("Touch ID isn't available on this Mac"), { code: "UNAVAILABLE" });
  const key = await touchId.createKey();
  const next = vk.setTouchIdWrap(vault.getVault(), vault.requireMasterKey(), key);
  if (test) {
    const shared = await touchId.deriveSecret({ keyBlob: key.keyBlob, peer: vk.touchIdPeerPublic(next), reason: "turn on Touch ID for WhisperWoof" });
    vk.unlockWithTouchIdSecret(next, shared); // throws if the enclave's answer doesn't open it
  }
  vault.saveVault(next);
}

async function completeSetup({ password, confirmWords, useTouchId, notesReadable }) {
  return guarded(() =>
    vault.exclusive(async () => {
      if (vault.isOn()) return fail("Encryption is already on", "INVALID");
      const session = takeConfirmedSession("setup", confirmWords);
      const created = vk.createVault({ entropy: session.entropy, password });
      const withPrefs = vk.updatePrefs(created.vault, { notesReadable: Boolean(notesReadable) });
      // Journal first: the unlock that follows sees it and runs the migration.
      ensurePrivateDir(vaultPaths.dir());
      writeFileAtomic(vaultPaths.journal(), JSON.stringify(planPure.startJournal("enable")));
      await vault.adoptNewVault(withPrefs, created.masterKey);
      let touchIdNote;
      if (useTouchId) {
        await enrollTouchId({ test: true }).catch((err) => {
          touchIdNote = err.message;
        });
      }
      notify();
      return ok(touchIdNote ? { touchIdError: touchIdNote } : {});
    })
  );
}

// ---------- unlocking ----------

async function unlockWithTouchId() {
  return guarded(async () => {
    const v = vault.getVault();
    if (!v || !v.touchId || !v.prefs.touchId) return fail("Touch ID isn't set up", "UNAVAILABLE");
    if (vault.isUnlocked()) return ok();
    let shared;
    try {
      shared = await touchId.deriveSecret({ keyBlob: vk.touchIdKeyBlob(v), peer: vk.touchIdPeerPublic(v), reason: TOUCH_ID_REASON });
    } catch (err) {
      if (err.code === "INVALIDATED") {
        vault.saveVault(vk.clearTouchId(v));
        reenrollTouchId = true;
        return fail("Your fingerprints changed, so Touch ID needs to be set up again. Use your password.", "INVALIDATED");
      }
      throw err;
    }
    await vault.unlockWithTouchIdSecret(shared);
    return ok();
  });
}

async function afterPasswordUnlock() {
  if (!reenrollTouchId) return;
  reenrollTouchId = false;
  await enrollTouchId({ test: false }).catch(() => {});
}

async function unlockWithPassword(password) {
  return guarded(async () => {
    if (vault.isUnlocked()) return ok();
    await vault.unlockWithPassword(String(password || ""));
    await afterPasswordUnlock();
    return ok();
  });
}

async function recover({ phrase: typed, newPassword }) {
  return guarded(async () => {
    let entropy;
    try {
      entropy = phrase.parsePhrase(typed);
    } catch (err) {
      return fail(err.message, "WRONG_PHRASE");
    }
    if (vault.isUnlocked()) await vault.lock({ force: true });
    await vault.unlockWithEntropy(entropy, String(newPassword || ""));
    await afterPasswordUnlock();
    return ok();
  });
}

async function lockNow() {
  return guarded(async () => {
    const result = await vault.lock();
    return ok({ deferred: Boolean(result.deferred) });
  });
}

// ---------- changing things (unlocked) ----------

/** Password or a fresh Touch ID — for the steps that can't be undone. */
async function reauthenticate(reauth) {
  const v = vault.getVault();
  if (reauth && typeof reauth.password === "string") {
    const mk = vk.unlockWithPassword(v, reauth.password);
    const same = mk.equals(vault.requireMasterKey());
    mk.fill(0);
    if (!same) throw Object.assign(new Error("That password isn't right."), { code: "WRONG_PASSWORD" });
    return;
  }
  if (reauth && reauth.touchId && v.touchId) {
    const shared = await touchId.deriveSecret({ keyBlob: vk.touchIdKeyBlob(v), peer: vk.touchIdPeerPublic(v), reason: "confirm it's you" });
    const mk = vk.unlockWithTouchIdSecret(v, shared);
    mk.fill(0);
    return;
  }
  throw Object.assign(new Error("Confirm with your password or Touch ID."), { code: "INVALID" });
}

async function changePassword({ currentPassword, newPassword }) {
  return guarded(async () => {
    vault.requireMasterKey();
    await reauthenticate({ password: currentPassword });
    vault.saveVault(vk.setPassword(vault.getVault(), vault.requireMasterKey(), String(newPassword || "")));
    return ok();
  });
}

async function setTouchIdEnabled(enabled) {
  return guarded(async () => {
    vault.requireMasterKey();
    if (!enabled) {
      vault.saveVault(vk.clearTouchId(vault.getVault()));
      return ok();
    }
    await enrollTouchId({ test: true });
    return ok();
  });
}

async function setPrefs(prefs) {
  return guarded(() =>
    vault.exclusive(async () => {
      const current = vault.getVault();
      if (!current) return fail("Encryption is off", "INVALID");
      const next = vk.updatePrefs(current, prefs);
      if (next.prefs.notesReadable !== current.prefs.notesReadable) {
        vault.requireKeys();
        await lifecycle.convertNotes(!next.prefs.notesReadable);
      }
      vault.saveVault(next);
      return ok();
    })
  );
}

async function beginNewPhrase(reauth) {
  return guarded(async () => {
    vault.requireMasterKey();
    if (!reauth || typeof reauth.password !== "string") {
      // The new master key must be wrapped with your password, so Touch ID alone isn't enough here.
      return fail("Enter your password to make a new recovery phrase.", "INVALID");
    }
    await reauthenticate(reauth);
    rotation.rememberPassword(reauth.password);
    return ok(newPhraseSession("rotate"));
  });
}

async function completeNewPhrase({ confirmWords }) {
  return guarded(() =>
    vault.exclusive(async () => {
      const session = takeConfirmedSession("rotate", confirmWords);
      await rotation.rotate(session.entropy);
      return ok();
    })
  );
}

async function disable(reauth) {
  return guarded(() =>
    vault.exclusive(async () => {
      vault.requireMasterKey();
      await reauthenticate(reauth);
      await lifecycle.replayInbox();
      if (vaultInbox.count() > 0) {
        return fail("Some entries saved while locked couldn't be imported yet. Try again in a moment.", "BUSY");
      }
      ensurePrivateDir(vaultPaths.dir());
      writeFileAtomic(vaultPaths.journal(), JSON.stringify(planPure.startJournal("disable")));
      await lifecycle.runMigration("disable");
      notify();
      return ok();
    })
  );
}

module.exports = {
  getStatus,
  onStatus,
  refreshTouchIdAvailability,
  beginSetup,
  completeSetup,
  unlockWithTouchId,
  unlockWithPassword,
  recover,
  lockNow,
  changePassword,
  setTouchIdEnabled,
  setPrefs,
  beginNewPhrase,
  completeNewPhrase,
  disable,
};
