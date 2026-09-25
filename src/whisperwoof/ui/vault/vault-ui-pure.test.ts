import { describe, it, expect } from "vitest";
import type { VaultMigration, VaultStatus } from "../../../types/electron";
import {
  afterAuthFailure,
  callVault,
  checkConfirmWords,
  checkNewPassword,
  confirmWordsPayload,
  encryptionOfferView,
  encryptionSummary,
  initialAuthMode,
  initialTurnOnState,
  isVaultFailure,
  migrationErrorText,
  migrationLabel,
  migrationPercent,
  needsLockScreen,
  lockScreenView,
  nextTurnOnStep,
  operationFinished,
  parseRecoveryPhrase,
  previousTurnOnStep,
  recoveryPhraseProblem,
  settingsMode,
  shouldReloadOnTransition,
  touchIdOutcome,
  touchIdRowDescription,
  turnOnCanContinue,
  turnOnStepNumber,
  vaultErrorMessage,
  withoutSecrets,
  wordLabel,
} from "./vault-ui-pure";

const status = (patch: Partial<VaultStatus> = {}): VaultStatus => ({
  status: "unlocked",
  migrating: null,
  prefs: { touchId: true, lockOnSleep: true, idleMinutes: 0, notesReadable: false },
  touchId: { available: true },
  inboxCount: 0,
  lockDeferred: false,
  platformSupported: true,
  ...patch,
});

const migration = (patch: Partial<VaultMigration> = {}): VaultMigration => ({
  direction: "enable",
  phase: "files",
  done: 120,
  total: 340,
  needsUnlock: false,
  ...patch,
});

const WORDS = [
  "abandon", "ability", "able", "about", "above", "absent",
  "absorb", "abstract", "absurd", "abuse", "access", "accident",
];

describe("checkNewPassword", () => {
  it("needs at least 8 characters", () => {
    expect(checkNewPassword("short", "short")).toEqual({ ok: false, message: null });
    expect(checkNewPassword("eight ch", "eight ch").ok).toBe(true);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(checkNewPassword("🐶🐶🐶🐶", "🐶🐶🐶🐶").ok).toBe(false);
  });

  it("stays quiet while the second field is still being typed", () => {
    expect(checkNewPassword("correct horse", "correct").message).toBeNull();
  });

  it("says when the two passwords differ", () => {
    expect(checkNewPassword("correct horse", "correct house")).toEqual({
      ok: false,
      message: "The two passwords don't match.",
    });
    expect(checkNewPassword("correct horse", "x").message).toBe("The two passwords don't match.");
  });
});

describe("confirm words", () => {
  it("labels positions 1-based", () => {
    expect(wordLabel(3)).toBe("Word 4");
  });

  it("matches case-insensitively and ignores spaces", () => {
    const result = checkConfirmWords(WORDS, [3, 8, 11], { 3: " About", 8: "ABSURD", 11: "accident " });
    expect(result).toEqual({ complete: true, wrongIndexes: [], message: null });
  });

  it("is incomplete until every word is filled", () => {
    expect(checkConfirmWords(WORDS, [3, 8], { 3: "about" }).complete).toBe(false);
  });

  it("names the words that don't match", () => {
    expect(checkConfirmWords(WORDS, [3, 8, 11], { 3: "abut", 8: "absurd", 11: "x" })).toEqual({
      complete: true,
      wrongIndexes: [3, 11],
      message: "Words 4 and 12 don't match. Check what you wrote down.",
    });
    expect(checkConfirmWords(WORDS, [0, 1, 2], { 0: "a", 1: "b", 2: "c" }).message).toBe(
      "Words 1, 2 and 3 don't match. Check what you wrote down."
    );
    expect(checkConfirmWords(WORDS, [5], { 5: "absint" }).message).toBe(
      "Word 6 doesn't match. Check what you wrote down."
    );
  });

  it("sends normalized words keyed by position", () => {
    expect(confirmWordsPayload([3, 8], { 3: " About ", 8: "ABSURD" })).toEqual({ 3: "about", 8: "absurd" });
  });
});

describe("recovery phrase input", () => {
  it("splits on spaces, commas and new lines and drops numbering", () => {
    expect(parseRecoveryPhrase("1. Abandon, 2) ability\n3 able  about")).toEqual([
      "abandon", "ability", "able", "about",
    ]);
  });

  it("asks for all 12 words", () => {
    expect(recoveryPhraseProblem("")).toBeNull();
    expect(recoveryPhraseProblem("abandon ability")).toBe(
      "Enter all 12 words, in order. You've entered 2."
    );
    expect(recoveryPhraseProblem(WORDS.join(" "))).toBeNull();
  });
});

describe("turn-on steps", () => {
  it("walks the five steps in order and back", () => {
    expect(nextTurnOnStep("explain")).toBe("password");
    expect(nextTurnOnStep("password")).toBe("phrase");
    expect(nextTurnOnStep("phrase")).toBe("confirm");
    expect(nextTurnOnStep("confirm")).toBe("touchId");
    expect(nextTurnOnStep("touchId")).toBe("working");
    expect(nextTurnOnStep("working")).toBe("done");
    expect(nextTurnOnStep("done")).toBe("done");
    expect(previousTurnOnStep("touchId")).toBe("confirm");
    expect(previousTurnOnStep("password")).toBe("explain");
    expect(previousTurnOnStep("explain")).toBeNull();
    expect(previousTurnOnStep("working")).toBeNull();
    expect(previousTurnOnStep("done")).toBeNull();
  });

  it("numbers only the five input steps", () => {
    expect(turnOnStepNumber("explain")).toBe(1);
    expect(turnOnStepNumber("touchId")).toBe(5);
    expect(turnOnStepNumber("working")).toBeNull();
  });

  it("starts with Touch ID on only when the Mac has it, notes encrypted", () => {
    expect(initialTurnOnState(true)).toMatchObject({ step: "explain", useTouchId: true, notesReadable: false });
    expect(initialTurnOnState(false).useTouchId).toBe(false);
  });

  it("gates each step on its own input", () => {
    const s = initialTurnOnState(true);
    expect(turnOnCanContinue(s)).toBe(false);
    expect(turnOnCanContinue({ ...s, understood: true })).toBe(true);
    const pw = { ...s, step: "password" as const, password: "correct horse", confirmPassword: "correct horse" };
    expect(turnOnCanContinue(pw)).toBe(true);
    expect(turnOnCanContinue({ ...pw, confirmPassword: "nope" })).toBe(false);
    expect(turnOnCanContinue({ ...s, step: "phrase" })).toBe(false);
    expect(turnOnCanContinue({ ...s, step: "phrase", words: WORDS })).toBe(true);
    const confirm = { ...s, step: "confirm" as const, words: WORDS, confirmIndexes: [0, 1] };
    expect(turnOnCanContinue({ ...confirm, answers: { 0: "abandon" } })).toBe(false);
    expect(turnOnCanContinue({ ...confirm, answers: { 0: "abandon", 1: "ability" } })).toBe(true);
    expect(turnOnCanContinue({ ...s, step: "touchId" })).toBe(true);
    expect(turnOnCanContinue({ ...s, step: "working" })).toBe(false);
  });

  it("drops the password and words once they have been sent", () => {
    const s = { ...initialTurnOnState(true), password: "p", confirmPassword: "p", words: WORDS, answers: { 0: "a" } };
    const cleared = withoutSecrets(s);
    expect(cleared).toMatchObject({ password: "", confirmPassword: "", words: [], answers: {} });
    expect(s.password).toBe("p");
  });
});

describe("migration progress", () => {
  it("says what is happening, with a count", () => {
    expect(migrationLabel(migration(), false)).toBe("Encrypting your data… 120 of 340");
    expect(migrationLabel(migration({ direction: "disable" }), false)).toBe("Decrypting your data… 120 of 340");
    expect(migrationLabel(migration({ direction: "rotate", total: 0 }), false)).toBe(
      "Switching to your new recovery phrase…"
    );
    expect(migrationLabel(migration({ direction: "notes" }), true)).toBe("Decrypting your notes… 120 of 340");
    expect(migrationLabel(migration({ direction: "notes" }), false)).toBe("Encrypting your notes… 120 of 340");
  });

  it("gives a clamped percent, or none when the total is unknown", () => {
    expect(migrationPercent(migration())).toBe(35);
    expect(migrationPercent(migration({ done: 500 }))).toBe(100);
    expect(migrationPercent(migration({ total: 0 }))).toBeNull();
  });

  it("explains an error", () => {
    expect(migrationErrorText(migration())).toBeNull();
    expect(migrationErrorText(migration({ error: "Not enough free space." }))).toBe(
      "Encryption stopped: Not enough free space."
    );
    expect(migrationErrorText(migration({ direction: "disable", error: "x" }))).toBe("Decryption stopped: x");
  });

  it("knows when each operation has finished", () => {
    expect(operationFinished("enable", status({ status: "off" }))).toBe(false);
    expect(operationFinished("enable", status({ migrating: migration() }))).toBe(false);
    expect(operationFinished("enable", status())).toBe(true);
    expect(operationFinished("disable", status())).toBe(false);
    expect(operationFinished("disable", status({ status: "off" }))).toBe(true);
    expect(operationFinished("rotate", status({ migrating: migration({ direction: "rotate" }) }))).toBe(false);
    expect(operationFinished("rotate", status())).toBe(true);
    expect(operationFinished("rotate", null)).toBe(false);
  });
});

describe("lock screen", () => {
  it("shows when locked, or when a migration waits for an unlock", () => {
    expect(needsLockScreen(undefined)).toBe(false);
    expect(needsLockScreen(null)).toBe(false);
    expect(needsLockScreen(status())).toBe(false);
    expect(needsLockScreen(status({ status: "locked" }))).toBe(true);
    expect(needsLockScreen(status({ migrating: migration({ needsUnlock: true }) }))).toBe(true);
    expect(needsLockScreen(status({ status: "locked", platformSupported: false }))).toBe(false);
  });

  it("offers Touch ID only when it is on and available", () => {
    expect(lockScreenView(status({ status: "locked" })).canUseTouchId).toBe(true);
    expect(lockScreenView(status({ touchId: { available: false, reason: "lockout" } })).canUseTouchId).toBe(false);
    expect(
      lockScreenView(status({ prefs: { touchId: false, lockOnSleep: true, idleMinutes: 0, notesReadable: false } }))
        .canUseTouchId
    ).toBe(false);
  });

  it("counts waiting entries and says when encryption needs finishing", () => {
    expect(lockScreenView(status({ inboxCount: 0 })).waitingLine).toBeNull();
    expect(lockScreenView(status({ inboxCount: 1 })).waitingLine).toBe("1 entry is waiting.");
    expect(lockScreenView(status({ inboxCount: 7 })).waitingLine).toBe("7 entries are waiting.");
    expect(lockScreenView(status()).finishingLine).toBeNull();
    expect(lockScreenView(status({ migrating: migration({ needsUnlock: true }) })).finishingLine).toBe(
      "Finishing encryption — unlock to continue."
    );
    expect(
      lockScreenView(status({ migrating: migration({ direction: "disable", needsUnlock: true }) })).finishingLine
    ).toBe("Finishing decryption — unlock to continue.");
  });

  it("reloads the window only when crossing the lock", () => {
    const locked = status({ status: "locked" });
    const unlocked = status();
    const off = status({ status: "off", prefs: { ...unlocked.prefs, touchId: false } });
    expect(shouldReloadOnTransition(locked, unlocked)).toBe(true);
    expect(shouldReloadOnTransition(unlocked, locked)).toBe(true);
    expect(shouldReloadOnTransition(undefined, locked)).toBe(false);
    expect(shouldReloadOnTransition(locked, locked)).toBe(false);
    expect(shouldReloadOnTransition(off, unlocked)).toBe(false);
    expect(shouldReloadOnTransition(unlocked, off)).toBe(false);
    expect(shouldReloadOnTransition(unlocked, null)).toBe(false);
  });
});

describe("Touch ID and error handling", () => {
  it("maps Touch ID results to what the screen does next", () => {
    expect(touchIdOutcome({ success: true })).toEqual({ kind: "unlocked" });
    expect(touchIdOutcome({ success: false, error: "", code: "CANCELLED" })).toEqual({ kind: "stay" });
    expect(touchIdOutcome({ success: false, error: "", code: "FALLBACK" })).toEqual({
      kind: "usePassword",
      message: null,
    });
    expect(touchIdOutcome({ success: false, error: "", code: "INVALIDATED" })).toEqual({
      kind: "usePassword",
      message: "Touch ID needs to be set up again. Use your password.",
    });
    expect(touchIdOutcome({ success: false, error: "", code: "LOCKOUT" }).kind).toBe("usePassword");
    expect(touchIdOutcome({ success: false, error: "", code: "UNAVAILABLE" }).kind).toBe("usePassword");
    expect(touchIdOutcome({ success: false, error: "", code: "BUSY" })).toEqual({
      kind: "error",
      message: "WhisperWoof is still converting your data. Try again when it's done.",
    });
  });

  it("switches to the password after a Touch ID fallback, and explains a wrong password", () => {
    expect(afterAuthFailure("touchId", { success: false, error: "", code: "CANCELLED" })).toEqual({
      mode: "touchId",
      message: null,
    });
    expect(afterAuthFailure("touchId", { success: false, error: "", code: "FALLBACK" })).toEqual({
      mode: "password",
      message: null,
    });
    expect(afterAuthFailure("password", { success: false, error: "", code: "WRONG_PASSWORD" })).toEqual({
      mode: "password",
      message: "That password isn't right.",
    });
  });

  it("picks the starting mode from the status", () => {
    expect(initialAuthMode(status())).toBe("touchId");
    expect(initialAuthMode(status({ touchId: { available: false } }))).toBe("password");
  });

  it("uses plain messages for each code, falling back to the main-process text", () => {
    expect(vaultErrorMessage({ success: false, error: "", code: "CANCELLED" })).toBeNull();
    expect(vaultErrorMessage({ success: false, error: "", code: "WRONG_PHRASE" }, "confirm")).toBe(
      "Those words don't match your recovery phrase. Check what you wrote down."
    );
    expect(vaultErrorMessage({ success: false, error: "", code: "WRONG_PHRASE" })).toBe(
      "That recovery phrase isn't right. Check each word and their order."
    );
    expect(vaultErrorMessage({ success: false, error: "", code: "LOCKED" })).toBe(
      "WhisperWoof is locked. Unlock it and try again."
    );
    expect(vaultErrorMessage({ success: false, error: "Disk full.", code: "INVALID" })).toBe("Disk full.");
    expect(vaultErrorMessage({ success: false, error: "Disk full." })).toBe("Disk full.");
    expect(vaultErrorMessage({ success: false, error: "" })).toBe("That didn't work. Try again.");
  });
});

describe("callVault", () => {
  it("passes arguments through and returns the result", async () => {
    const method = async (p: string) => ({ success: p === "ok" });
    expect(await callVault(method, "ok")).toEqual({ success: true });
  });

  it("turns a missing method or a thrown IPC error into a failure", async () => {
    expect(await callVault(undefined)).toMatchObject({ success: false });
    const throws = async () => {
      throw new Error("Error invoking remote method");
    };
    const result = await callVault(throws);
    expect(result).toEqual({ success: false, error: "" });
    if (isVaultFailure(result)) expect(vaultErrorMessage(result)).toBe("That didn't work. Try again.");
  });
});

describe("settings copy", () => {
  it("hides the section off macOS or without a status", () => {
    expect(settingsMode(null)).toBe("hidden");
    expect(settingsMode(status({ platformSupported: false }))).toBe("hidden");
    expect(settingsMode(status({ status: "off" }))).toBe("off");
    expect(settingsMode(status())).toBe("on");
  });

  it("states how it unlocks", () => {
    expect(encryptionSummary(status({ status: "off" }))).toBe(
      "Your history, notes and recordings are stored as plain files on this Mac."
    );
    expect(encryptionSummary(status())).toBe("Encrypted. Unlocks with Touch ID or your password.");
    expect(encryptionSummary(status({ touchId: { available: false } }))).toBe(
      "Encrypted. Unlocks with your password."
    );
  });

  it("explains why Touch ID can't be used", () => {
    expect(touchIdRowDescription({ available: true })).toBe(
      "Use your fingerprint instead of typing your password."
    );
    expect(touchIdRowDescription({ available: false, reason: "notEnrolled" })).toMatch(/Add a fingerprint/);
    expect(touchIdRowDescription({ available: false, reason: "lockout" })).toMatch(/too many tries/);
    expect(touchIdRowDescription({ available: false })).toBe("This Mac doesn't have Touch ID.");
  });
});

describe("encryptionOfferView (the one-time offer on Home)", () => {
  const off = status({ status: "off", prefs: { touchId: false, lockOnSleep: true, idleMinutes: 0, notesReadable: false } });

  it("offers encryption to someone who hasn't answered yet", () => {
    expect(encryptionOfferView(off, null, false)).toBe("offer");
  });

  it("answers a decline with where to find it later, once", () => {
    expect(encryptionOfferView(off, "declined", true)).toBe("declined");
    expect(encryptionOfferView(off, "declined", false)).toBe("hidden");
  });

  it("stays out of the way when encryption is on, unsupported, or status isn't known yet", () => {
    expect(encryptionOfferView(status({ status: "unlocked" }), null, false)).toBe("hidden");
    expect(encryptionOfferView(status({ status: "locked" }), null, false)).toBe("hidden");
    expect(encryptionOfferView({ ...off, platformSupported: false }, null, false)).toBe("hidden");
    expect(encryptionOfferView(undefined, null, false)).toBe("hidden");
    expect(encryptionOfferView(null, null, false)).toBe("hidden");
  });

  it("doesn't come back after someone turned it on and later off", () => {
    expect(encryptionOfferView(off, "accepted", false)).toBe("hidden");
  });
});
