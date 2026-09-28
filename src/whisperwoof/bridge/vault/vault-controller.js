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
const journalStore = require("./vault-journal");
const rotation = require("./vault-rotate");
const { vaultPaths } = require("./vault-paths");
const planPure = require("./migration-plan-pure");
const { unlockDelayMs } = require("./password-policy-pure");

// The phrase's entropy is held from "show the words" to "confirm them"; keep
// that short.
const SETUP_TTL_MS = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 60 * 1000;
// Which Touch ID prompt to show. The words live in the helper
// (macos-vault-helper.swift: "WhisperWoof is trying to <prompt>."), so no
// caller can put its own text in a real Touch ID prompt.
const TOUCH_ID_PURPOSE = Object.freeze({
  setup: "setup",
  enable: "enable",
  unlock: "unlock",
  confirm: "confirm",
});

let setup = null; // { entropy, words, confirmIndexes, expires, purpose: "setup" | "rotate" }
let touchIdAvailability = { available: false, reason: "unavailable" };
// Touch ID was turned off because the fingerprints on this Mac changed; it
// comes back only when someone turns it on again, with the password.
let touchIdWasReset = false;
// Wrong passwords at the lock screen, in a row (password-policy-pure unlockDelayMs).
let failedUnlocks = 0;
let nextUnlockAt = 0;
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
 * runs outside `exclusive`. A conversion that stopped part-way (its journal is
 * still there) must be finished first; `allowPending(journal)` lets through
 * what finishes or undoes it (Try again, turning off).
 */
function whenIdle(fn, { allowPending = () => false } = {}) {
  return vault.exclusive(async () => {
    if (lifecycle.getProgress()) {
      return fail("WhisperWoof is still converting your data. Try again when it's done.", "BUSY");
    }
    // Only a journal this vault signed counts (read() is null while locked).
    const pending = vault.isOn() ? journalStore.read() : null;
    if (pending && !allowPending(pending)) {
      return fail("Finish what was interrupted first: press Try again in Settings → Encryption.", "BUSY");
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
  // While locked the journal can't be verified; it only decides this status
  // line then. The unlock acts on it only if this vault signed it.
  const journal = !vault.isOn() ? null : vault.isUnlocked() ? journalStore.read() : journalStore.peek();
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
    // What the first unlock found changed while locked: "sealKey" | "prefs" | "journal".
    changedWhileLocked: vault.isOn() ? vault.getWarnings() : [],
    touchIdWasReset: vault.isOn() && touchIdWasReset,
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

function dropSession() {
  if (setup) setup.entropy.fill(0);
  setup = null;
}

function newPhraseSession(purpose) {
  dropSession();
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
    if (setup && Date.now() > setup.expires) dropSession();
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
 * other clipboard managers, kept to this Mac (no Universal Clipboard), and
 * cleared after a minute if it's still there. Only the helper can mark it
 * that way, so without it there's no copy at all.
 */
async function copyPhrase() {
  return guarded(async () => {
    if (!setup || Date.now() > setup.expires) return fail("There's no recovery phrase to copy.", "INVALID");
    const text = setup.words.join(" ");
    const { clipboard } = require("electron");
    require("../app-init").skipClipboardCapture(text);
    const marked = await touchId.copySecret(text).catch(() => false);
    if (!marked) return fail("Couldn't copy safely. Write the words down instead.");
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
 * `purpose` (which prompt), it asks for one touch and checks the enclave's
 * answer opens it.
 */
async function withTouchId(v, masterKey, purpose) {
  const availability = await refreshTouchIdAvailability();
  if (!availability.available) throw Object.assign(new Error("Touch ID isn't available on this Mac"), { code: "UNAVAILABLE" });
  const key = await touchId.createKey();
  const next = vk.setTouchIdWrap(v, masterKey, key);
  if (purpose) {
    const shared = await touchId.deriveSecret({ keyBlob: key.keyBlob, peer: vk.touchIdPeerPublic(next), purpose });
    try {
      vk.unlockWithTouchIdSecret(next, shared).fill(0); // throws if the enclave's answer doesn't open it
    } finally {
      shared.fill(0);
    }
  }
  return next;
}

/** Enroll Touch ID for the vault's current master key. `test` asks for one touch. */
async function enrollTouchId({ test }) {
  const next = await withTouchId(vault.getVault(), vault.requireMasterKey(), test ? TOUCH_ID_PURPOSE.enable : null);
  vault.saveVault(next);
  touchIdWasReset = false;
}

async function completeSetup({ password, confirmWords, useTouchId, notesReadable }) {
  return guarded(() =>
    whenIdle(async () => {
      if (vault.isOn()) return fail("Encryption is already on", "INVALID");
      if (vault.isLockBlocked()) {
        return fail("Finish recording the meeting first, then turn on encryption.", "BUSY");
      }
      const session = takeConfirmedSession("setup", confirmWords);
      let created;
      try {
        created = vk.createVault({ entropy: session.entropy, password });
      } catch (err) {
        session.entropy.fill(0);
        throw err;
      }
      const withPrefs = vk.updatePrefs(created.vault, { notesReadable: Boolean(notesReadable) });
      let ready = withPrefs;
      if (useTouchId) {
        // One touch now, before anything is encrypted: if Touch ID doesn't
        // work, nothing has changed and the phrase they wrote down still holds.
        try {
          ready = await withTouchId(withPrefs, created.masterKey, TOUCH_ID_PURPOSE.setup);
        } catch (err) {
          // Kept whole for the retry: the phrase they wrote down must still hold.
          setup = session;
          throw err;
        }
      }
      // Past the last retry point: the phrase's entropy isn't needed any more.
      session.entropy.fill(0);
      // vault.json, then the journal, then the unlock — which sees the journal
      // and runs the migration. A crash in between never leaves a journal alone.
      // The journal is signed with the new master key before its first unlock.
      await vault.adoptNewVault(ready, created.masterKey, {
        beforeUnlock: () =>
          journalStore.write(planPure.startJournal("enable"), { masterKey: created.masterKey, vaultId: ready.vaultId }),
      });
      notify();
      return ok();
    })
  );
}

// ---------- unlocking ----------

function unlocked() {
  failedUnlocks = 0;
  nextUnlockAt = 0;
}

async function unlockWithTouchId() {
  return guarded(async () => {
    const v = vault.getVault();
    if (!v || !v.touchId || !v.prefs.touchId) return fail("Touch ID isn't set up", "UNAVAILABLE");
    if (vault.isUnlocked()) return ok();
    let shared;
    try {
      shared = await touchId.deriveSecret({ keyBlob: vk.touchIdKeyBlob(v), peer: vk.touchIdPeerPublic(v), purpose: TOUCH_ID_PURPOSE.unlock });
    } catch (err) {
      if (err.code === "INVALIDATED") {
        // The fingerprints on this Mac changed (someone may have added theirs).
        // Touch ID stays off until it's turned on again with the password:
        // never re-enroll by itself.
        vault.saveVault(vk.clearTouchId(v));
        touchIdWasReset = true;
        return fail("The fingerprints on this Mac changed, so Touch ID was turned off. Use your password.", "INVALIDATED");
      }
      throw err;
    }
    try {
      await vault.unlockWithTouchIdSecret(shared);
    } finally {
      shared.fill(0);
    }
    unlocked();
    return ok();
  });
}

function secondsText(ms) {
  const seconds = Math.ceil(ms / 1000);
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

async function unlockWithPassword(password) {
  return guarded(async () => {
    if (vault.isUnlocked()) return ok();
    const wait = nextUnlockAt - Date.now();
    if (wait > 0) return fail(`Too many wrong passwords. Try again in ${secondsText(wait)}.`);
    try {
      await vault.unlockWithPassword(String(password || ""));
    } catch (err) {
      if (err.code === "WRONG_PASSWORD") {
        failedUnlocks += 1;
        nextUnlockAt = Date.now() + unlockDelayMs(failedUnlocks);
      }
      throw err;
    }
    unlocked();
    return ok();
  });
}

/**
 * Forgot the password: the 12 words set a new one. While unlocked, the words
 * are checked first and nothing locks: a wrong phrase changes nothing, and a
 * recording meeting keeps its files.
 */
async function recover({ phrase: typed, newPassword }) {
  return guarded(async () => {
    let entropy;
    try {
      entropy = phrase.parsePhrase(typed);
    } catch (err) {
      return fail(err.message, "WRONG_PHRASE");
    }
    try {
      if (vault.isUnlocked()) {
        const current = vault.getVault();
        if (!current) return fail("Encryption is off", "INVALID");
        const mk = vk.masterKeyFromEntropy(entropy, current); // WrongPhraseError if it isn't this vault's
        try {
          vault.saveVault(vk.setPassword(current, mk, String(newPassword || "")));
        } finally {
          mk.fill(0);
        }
        return ok();
      }
      await vault.unlockWithEntropy(entropy, String(newPassword || ""));
      unlocked();
      return ok();
    } finally {
      entropy.fill(0);
    }
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
    const shared = await touchId.deriveSecret({ keyBlob: vk.touchIdKeyBlob(v), peer: vk.touchIdPeerPublic(v), purpose: TOUCH_ID_PURPOSE.confirm });
    try {
      vk.unlockWithTouchIdSecret(v, shared).fill(0);
    } finally {
      shared.fill(0);
    }
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

/**
 * Turning Touch ID on enrolls whatever fingerprints the Mac has right now, so
 * it needs the password (a finger someone added can't vouch for itself).
 * Turning it off needs nothing.
 */
async function setTouchIdEnabled(enabled, reauth) {
  return guarded(() =>
    whenIdle(async () => {
      vault.requireMasterKey();
      if (!enabled) {
        vault.saveVault(vk.clearTouchId(vault.getVault()));
        return ok();
      }
      if (!reauth || typeof reauth.password !== "string") {
        return fail("Enter your password to turn on Touch ID.", "INVALID");
      }
      await reauthenticate({ password: reauth.password });
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
      // Every pref is a security setting (and gets signed): only while unlocked.
      vault.requireKeys();
      const next = vk.updatePrefs(current, prefs);
      if (next.prefs.notesReadable !== current.prefs.notesReadable) {
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
      try {
        await lifecycle.runRotation(() => rotation.rotate(session.entropy));
      } finally {
        session.entropy.fill(0);
      }
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
      journalStore.write(planPure.startJournal("disable"));
      await lifecycle.runMigration("disable");
      notify();
      return ok();
    }, { allowPending: (journal) => journal.direction !== "rotate" })
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
    }, { allowPending: () => true })
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
