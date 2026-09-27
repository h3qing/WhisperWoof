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
const CLIPBOARD_CLEAR_MS = 60 * 1000;
// macOS shows these as "WhisperWoof is trying to <reason>." (the Touch ID
// helper is named WhisperWoof), so each says what the touch is for.
const TOUCH_ID_REASONS = Object.freeze({
  setup: "check that Touch ID works before encrypting your data",
  enable: "turn on Touch ID for unlocking your data",
  unlock: "unlock your history and notes",
  confirm: "confirm it's you",
});

let setup = null; // { entropy, words, confirmIndexes, expires, purpose: "setup" | "rotate" }
let touchIdAvailability = { available: false, reason: "unavailable" };
let reenrollTouchId = false;
const statusListeners = [];

const ok = (extra = {}) => ({ success: true, ...extra });
const fail = (error, code) => ({ success: false, error, code });

function errorResult(err) {
  const known = ["WRONG_PASSWORD", "WRONG_PHRASE", "LOCKED", "CANCELLED", "FALLBACK", "FAILED", "INVALIDATED", "LOCKOUT", "UNAVAILABLE", "BUSY", "INVALID"];
  return fail(err.message, known.includes(err.code) ? err.code : undefined);
}

/**
 * Settings changes and conversions run one at a time, and never while files
 * are being converted: that can also be a migration resumed on unlock, which
 * runs outside `exclusive`.
 */
function whenIdle(fn) {
  return vault.exclusive(async () => {
    if (lifecycle.getProgress()) {
      return fail("WhisperWoof is still converting your data. Try again when it's done.", "BUSY");
    }
    return fn();
  });
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
  const error = lifecycle.getError();
  const journal = vault.isOn() ? migrate.readJournal() : null;
  if (journal) {
    return {
      direction: journal.direction,
      phase: error ? "error" : journal.phase,
      done: 0,
      total: 0,
      needsUnlock: !vault.isUnlocked(),
      ...(error ? { error: error.message } : {}),
    };
  }
  if (error) return { direction: error.direction, phase: "error", done: 0, total: 0, needsUnlock: false, error: error.message };
  return null;
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

/**
 * Copy the recovery phrase being shown (setup or a new phrase) in one click.
 * Kept out of WhisperWoof's clipboard history, marked concealed/transient for
 * other clipboard managers, and cleared after a minute if it's still there.
 */
async function copyPhrase() {
  return guarded(async () => {
    if (!setup || Date.now() > setup.expires) return fail("There's no recovery phrase to copy.", "INVALID");
    const text = setup.words.join(" ");
    const { clipboard } = require("electron");
    require("../app-init").skipClipboardCapture(text);
    const marked = await touchId.copySecret(text).catch(() => false);
    if (!marked) clipboard.writeText(text);
    setTimeout(() => {
      if (clipboard.readText() === text) clipboard.clear();
    }, CLIPBOARD_CLEAR_MS).unref?.();
    return ok({ clearsInSeconds: CLIPBOARD_CLEAR_MS / 1000 });
  });
}

function beginSetup() {
  if (vault.isOn()) return fail("Encryption is already on", "INVALID");
  return ok(newPhraseSession("setup"));
}

/**
 * `v` with a new Secure Enclave key wrapped around `masterKey`. With a
 * `reason`, it asks for one touch and checks the enclave's answer opens it.
 */
async function withTouchId(v, masterKey, reason) {
  const availability = await refreshTouchIdAvailability();
  if (!availability.available) throw Object.assign(new Error("Touch ID isn't available on this Mac"), { code: "UNAVAILABLE" });
  const key = await touchId.createKey();
  const next = vk.setTouchIdWrap(v, masterKey, key);
  if (reason) {
    const shared = await touchId.deriveSecret({ keyBlob: key.keyBlob, peer: vk.touchIdPeerPublic(next), reason });
    vk.unlockWithTouchIdSecret(next, shared); // throws if the enclave's answer doesn't open it
  }
  return next;
}

/** Enroll Touch ID for the vault's current master key. `test` asks for one touch. */
async function enrollTouchId({ test }) {
  const next = await withTouchId(vault.getVault(), vault.requireMasterKey(), test ? TOUCH_ID_REASONS.enable : null);
  vault.saveVault(next);
}

async function completeSetup({ password, confirmWords, useTouchId, notesReadable }) {
  return guarded(() =>
    whenIdle(async () => {
      if (vault.isOn()) return fail("Encryption is already on", "INVALID");
      if (vault.isLockBlocked()) {
        return fail("Finish recording the meeting first, then turn on encryption.", "BUSY");
      }
      const session = takeConfirmedSession("setup", confirmWords);
      const created = vk.createVault({ entropy: session.entropy, password });
      const withPrefs = vk.updatePrefs(created.vault, { notesReadable: Boolean(notesReadable) });
      let ready = withPrefs;
      if (useTouchId) {
        // One touch now, before anything is encrypted: if Touch ID doesn't
        // work, nothing has changed and the phrase they wrote down still holds.
        try {
          ready = await withTouchId(withPrefs, created.masterKey, TOUCH_ID_REASONS.setup);
        } catch (err) {
          setup = session;
          throw err;
        }
      }
      // vault.json, then the journal, then the unlock — which sees the journal
      // and runs the migration. A crash in between never leaves a journal alone.
      await vault.adoptNewVault(ready, created.masterKey, {
        beforeUnlock: () => {
          ensurePrivateDir(vaultPaths.dir());
          writeFileAtomic(vaultPaths.journal(), JSON.stringify(planPure.startJournal("enable")));
        },
      });
      notify();
      return ok();
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
      shared = await touchId.deriveSecret({ keyBlob: vk.touchIdKeyBlob(v), peer: vk.touchIdPeerPublic(v), reason: TOUCH_ID_REASONS.unlock });
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
  if (!reenrollTouchId || !vault.isUnlocked()) return;
  // Cleared only once it worked: a lock right after unlocking must not lose it.
  await enrollTouchId({ test: false })
    .then(() => {
      reenrollTouchId = false;
    })
    .catch(() => {});
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
    const shared = await touchId.deriveSecret({ keyBlob: vk.touchIdKeyBlob(v), peer: vk.touchIdPeerPublic(v), reason: TOUCH_ID_REASONS.confirm });
    const mk = vk.unlockWithTouchIdSecret(v, shared);
    mk.fill(0);
    return;
  }
  throw Object.assign(new Error("Confirm with your password or Touch ID."), { code: "INVALID" });
}

async function changePassword({ currentPassword, newPassword }) {
  return guarded(() =>
    whenIdle(async () => {
      vault.requireMasterKey();
      await reauthenticate({ password: currentPassword });
      vault.saveVault(vk.setPassword(vault.getVault(), vault.requireMasterKey(), String(newPassword || "")));
      return ok();
    })
  );
}

async function setTouchIdEnabled(enabled) {
  return guarded(() =>
    whenIdle(async () => {
      vault.requireMasterKey();
      if (!enabled) {
        vault.saveVault(vk.clearTouchId(vault.getVault()));
        return ok();
      }
      await enrollTouchId({ test: true });
      return ok();
    })
  );
}

async function setPrefs(prefs, reauth) {
  return guarded(() =>
    whenIdle(async () => {
      const current = vault.getVault();
      if (!current) return fail("Encryption is off", "INVALID");
      const next = vk.updatePrefs(current, prefs);
      if (next.prefs.notesReadable !== current.prefs.notesReadable) {
        vault.requireKeys();
        // Making every note plain on disk is as serious as turning encryption off.
        if (next.prefs.notesReadable) await reauthenticate(reauth);
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
    whenIdle(async () => {
      const session = takeConfirmedSession("rotate", confirmWords);
      await lifecycle.runRotation(() => rotation.rotate(session.entropy));
      return ok();
    })
  );
}

async function disable(reauth) {
  return guarded(() =>
    whenIdle(async () => {
      vault.requireMasterKey();
      await reauthenticate(reauth);
      await lifecycle.replayInbox();
      // Anything that still won't import is written out as plain JSON (it's all
      // going plain now) instead of being lost with the vault.
      vaultInbox.exportRemaining(require("path").join(vaultPaths.dir(), "..", "unimported-while-locked"));
      ensurePrivateDir(vaultPaths.dir());
      writeFileAtomic(vaultPaths.journal(), JSON.stringify(planPure.startJournal("disable")));
      await lifecycle.runMigration("disable");
      notify();
      return ok();
    })
  );
}

/** "Try again" after a migration or new phrase stopped. */
async function retry() {
  return guarded(() =>
    whenIdle(async () => {
      vault.requireKeys();
      await lifecycle.retry();
      notify();
      return ok();
    })
  );
}

module.exports = {
  retry,
  getStatus,
  onStatus,
  refreshTouchIdAvailability,
  beginSetup,
  copyPhrase,
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
