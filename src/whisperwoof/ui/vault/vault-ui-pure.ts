// Pure logic behind the encryption UI: the turn-on step machine, password and
// recovery-word checks, and what the lock screen and settings show for a given
// VaultStatus. The components stay thin; everything decidable lives here.
// Copy follows docs/design/at-rest-encryption.md sections 4.6, 4.7 and 5.

import type {
  VaultFailure,
  VaultMigration,
  VaultMigrationDirection,
  VaultResult,
  VaultStatus,
  VaultTouchIdState,
} from "../../../types/electron";

export const MIN_PASSWORD_LENGTH = 8;
export const RECOVERY_WORD_COUNT = 12;
export const PASSWORD_HINT = "Use at least 8 characters. A few words work well.";
export const NO_BACK_DOOR_WARNING =
  "If you forget your password and lose your recovery phrase, your data is gone. Nobody can recover it, including us.";
export const NOTES_READABLE_WARNING =
  "Notes stay plain Markdown so Obsidian and iCloud can read them. They aren't encrypted.";

export const IDLE_LOCK_OPTIONS: ReadonlyArray<{ value: 0 | 15 | 60; label: string }> = [
  { value: 0, label: "Never" },
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
];

// ── Passwords ────────────────────────────────────────────────────────────────

export interface PasswordCheck {
  readonly ok: boolean;
  readonly message: string | null;
}

/** Characters as people count them (code points, so an emoji is one). */
const charCount = (s: string): number => Array.from(s).length;

/**
 * A new password typed twice. The length rule is always on screen as a hint,
 * so it isn't repeated as an error; a mismatch is only called out once the
 * second field can no longer be a prefix of the first.
 */
export function checkNewPassword(password: string, confirm: string): PasswordCheck {
  const ok = charCount(password) >= MIN_PASSWORD_LENGTH && password === confirm;
  const mismatch =
    confirm.length > 0 &&
    confirm !== password &&
    (confirm.length >= password.length || !password.startsWith(confirm));
  return { ok, message: mismatch ? "The two passwords don't match." : null };
}

// ── Recovery words ───────────────────────────────────────────────────────────

export const normalizeWord = (word: string): string => word.trim().toLowerCase();

/** Positions arrive 0-based; people count from 1. */
export const wordLabel = (index: number): string => `Word ${index + 1}`;

export interface ConfirmWordsCheck {
  readonly complete: boolean;
  readonly wrongIndexes: readonly number[];
  readonly message: string | null;
}

function joinNumbers(numbers: readonly number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** First check is here; the main process checks the words again. */
export function checkConfirmWords(
  words: readonly string[],
  indexes: readonly number[],
  answers: Readonly<Record<number, string>>
): ConfirmWordsCheck {
  const typed = (i: number) => normalizeWord(answers[i] ?? "");
  const complete = indexes.length > 0 && indexes.every((i) => typed(i).length > 0);
  const wrongIndexes = indexes.filter((i) => typed(i).length > 0 && typed(i) !== normalizeWord(words[i] ?? ""));
  if (wrongIndexes.length === 0) return { complete, wrongIndexes, message: null };
  const numbers = joinNumbers(wrongIndexes.map((i) => i + 1));
  const message =
    wrongIndexes.length === 1
      ? `Word ${numbers} doesn't match. Check what you wrote down.`
      : `Words ${numbers} don't match. Check what you wrote down.`;
  return { complete, wrongIndexes, message };
}

export function confirmWordsPayload(
  indexes: readonly number[],
  answers: Readonly<Record<number, string>>
): Record<number, string> {
  return Object.fromEntries(indexes.map((i) => [i, normalizeWord(answers[i] ?? "")]));
}

/** Accepts the phrase however it was written down: "1. word, 2) word…". */
export function parseRecoveryPhrase(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((token) => token.replace(/^\d+[.)]?/, ""))
    .filter((token) => token.length > 0);
}

export function recoveryPhraseProblem(text: string): string | null {
  const count = parseRecoveryPhrase(text).length;
  if (count === 0 || count === RECOVERY_WORD_COUNT) return null;
  return `Enter all ${RECOVERY_WORD_COUNT} words, in order. You've entered ${count}.`;
}

// ── Turn-on dialog: five steps, then the migration ─────────────────────────────

export type TurnOnStep = "explain" | "password" | "phrase" | "confirm" | "touchId" | "working" | "done";

const TURN_ON_ORDER: readonly TurnOnStep[] = [
  "explain", "password", "phrase", "confirm", "touchId", "working", "done",
];
export const TURN_ON_INPUT_STEPS = 5;

export interface TurnOnState {
  readonly step: TurnOnStep;
  readonly understood: boolean;
  readonly notesReadable: boolean;
  readonly password: string;
  readonly confirmPassword: string;
  readonly words: readonly string[];
  readonly confirmIndexes: readonly number[];
  readonly answers: Readonly<Record<number, string>>;
  readonly useTouchId: boolean;
}

export function initialTurnOnState(touchIdAvailable: boolean): TurnOnState {
  return {
    step: "explain",
    understood: false,
    notesReadable: false,
    password: "",
    confirmPassword: "",
    words: [],
    confirmIndexes: [],
    answers: {},
    useTouchId: touchIdAvailable,
  };
}

export function nextTurnOnStep(step: TurnOnStep): TurnOnStep {
  const i = TURN_ON_ORDER.indexOf(step);
  return TURN_ON_ORDER[Math.min(i + 1, TURN_ON_ORDER.length - 1)];
}

export function previousTurnOnStep(step: TurnOnStep): TurnOnStep | null {
  const i = TURN_ON_ORDER.indexOf(step);
  if (i <= 0 || i >= TURN_ON_INPUT_STEPS) return null;
  return TURN_ON_ORDER[i - 1];
}

export function turnOnStepNumber(step: TurnOnStep): number | null {
  const i = TURN_ON_ORDER.indexOf(step);
  return i < TURN_ON_INPUT_STEPS ? i + 1 : null;
}

export function turnOnCanContinue(state: TurnOnState): boolean {
  switch (state.step) {
    case "explain":
      return state.understood;
    case "password":
      return checkNewPassword(state.password, state.confirmPassword).ok;
    case "phrase":
      return state.words.length === RECOVERY_WORD_COUNT;
    case "confirm": {
      const check = checkConfirmWords(state.words, state.confirmIndexes, state.answers);
      return check.complete && check.wrongIndexes.length === 0;
    }
    case "touchId":
      return true;
    default:
      return false;
  }
}

/** Once the setup call is made, the password and words leave React state. */
export function withoutSecrets(state: TurnOnState): TurnOnState {
  return { ...state, password: "", confirmPassword: "", words: [], answers: {} };
}

// ── Migration progress ─────────────────────────────────────────────────────────

function migrationVerb(direction: VaultMigrationDirection, notesReadable: boolean): string {
  switch (direction) {
    case "disable":
      return "Decrypting your data…";
    case "rotate":
      return "Switching to your new recovery phrase…";
    case "notes":
      return notesReadable ? "Decrypting your notes…" : "Encrypting your notes…";
    default:
      return "Encrypting your data…";
  }
}

export function migrationLabel(m: VaultMigration, notesReadable: boolean): string {
  const verb = migrationVerb(m.direction, notesReadable);
  return m.total > 0 ? `${verb} ${Math.min(m.done, m.total)} of ${m.total}` : verb;
}

export function migrationPercent(m: VaultMigration): number | null {
  if (m.total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((m.done / m.total) * 100)));
}

export function migrationErrorText(m: VaultMigration): string | null {
  if (!m.error) return null;
  const noun = m.direction === "disable" ? "Decryption" : "Encryption";
  return `${noun} stopped: ${m.error}`;
}

/** Whether the operation a dialog started has landed, judged from the pushed status. */
export function operationFinished(
  direction: VaultMigrationDirection,
  status: VaultStatus | null | undefined
): boolean {
  if (!status || status.migrating) return false;
  if (direction === "disable") return status.status === "off";
  return status.status === "unlocked";
}

// ── Lock screen ───────────────────────────────────────────────────────────────

export type AuthMode = "touchId" | "password";

export function canUseTouchId(status: VaultStatus): boolean {
  return status.prefs.touchId && status.touchId.available;
}

export const initialAuthMode = (status: VaultStatus): AuthMode =>
  canUseTouchId(status) ? "touchId" : "password";

export function needsLockScreen(status: VaultStatus | null | undefined): boolean {
  if (!status || !status.platformSupported) return false;
  return status.status === "locked" || Boolean(status.migrating?.needsUnlock);
}

export interface LockScreenView {
  readonly canUseTouchId: boolean;
  readonly waitingLine: string | null;
  readonly finishingLine: string | null;
}

const FINISHING: Record<VaultMigrationDirection, string> = {
  enable: "Finishing encryption — unlock to continue.",
  disable: "Finishing decryption — unlock to continue.",
  rotate: "Finishing your new recovery phrase — unlock to continue.",
  notes: "Finishing your notes — unlock to continue.",
};

export function lockScreenView(status: VaultStatus): LockScreenView {
  const n = status.inboxCount;
  const waitingLine = n <= 0 ? null : n === 1 ? "1 entry is waiting." : `${n} entries are waiting.`;
  const finishingLine = status.migrating?.needsUnlock ? FINISHING[status.migrating.direction] : null;
  return { canUseTouchId: canUseTouchId(status), waitingLine, finishingLine };
}

/**
 * Crossing the lock in either direction reloads the window: locking drops any
 * decrypted history from memory, unlocking reloads the stores that failed
 * while the database was closed. Turning encryption on or off never reloads.
 */
export function shouldReloadOnTransition(
  prev: VaultStatus | null | undefined,
  next: VaultStatus | null | undefined
): boolean {
  if (!prev || !next) return false;
  if (prev.status === "off" || next.status === "off") return false;
  return needsLockScreen(prev) !== needsLockScreen(next);
}

// ── Results and errors ─────────────────────────────────────────────────────────

/** Narrows a vault result (the renderer's tsconfig isn't strict, so `success` alone doesn't). */
export const isVaultFailure = (result: { success: boolean }): result is VaultFailure => result.success === false;

export type ErrorContext = "general" | "confirm";

const TOUCH_ID_MESSAGES: Partial<Record<string, string>> = {
  INVALIDATED: "Touch ID needs to be set up again. Use your password.",
  LOCKOUT: "Touch ID is locked after too many tries. Use your password.",
  UNAVAILABLE: "Touch ID isn't available right now. Use your password.",
};

export function vaultErrorMessage(result: VaultFailure, context: ErrorContext = "general"): string | null {
  switch (result.code) {
    case "CANCELLED":
    case "FALLBACK":
      return null;
    case "WRONG_PASSWORD":
      return "That password isn't right.";
    case "WRONG_PHRASE":
      return context === "confirm"
        ? "Those words don't match your recovery phrase. Check what you wrote down."
        : "That recovery phrase isn't right. Check each word and their order.";
    case "LOCKED":
      return "WhisperWoof is locked. Unlock it and try again.";
    case "BUSY":
      return "WhisperWoof is still converting your data. Try again when it's done.";
    case "INVALIDATED":
    case "LOCKOUT":
    case "UNAVAILABLE":
      return TOUCH_ID_MESSAGES[result.code] ?? null;
    default:
      return result.error || "That didn't work. Try again.";
  }
}

export type TouchIdOutcome =
  | { kind: "unlocked" }
  | { kind: "stay" }
  | { kind: "usePassword"; message: string | null }
  | { kind: "error"; message: string | null };

export function touchIdOutcome(result: VaultResult): TouchIdOutcome {
  if (!isVaultFailure(result)) return { kind: "unlocked" };
  switch (result.code) {
    case "CANCELLED":
      return { kind: "stay" };
    case "FALLBACK":
    case "INVALIDATED":
    case "LOCKOUT":
    case "UNAVAILABLE":
      return { kind: "usePassword", message: vaultErrorMessage(result) };
    default:
      return { kind: "error", message: vaultErrorMessage(result) };
  }
}

/** Where a Touch ID or password attempt leaves the form after it fails. */
export function afterAuthFailure(
  mode: AuthMode,
  result: VaultFailure
): { mode: AuthMode; message: string | null } {
  if (mode === "password") return { mode, message: vaultErrorMessage(result) };
  const outcome = touchIdOutcome(result);
  if (outcome.kind === "usePassword") return { mode: "password", message: outcome.message };
  if (outcome.kind === "error") return { mode, message: outcome.message };
  return { mode, message: null };
}

/**
 * Calls a preload method. A method this build doesn't expose, or an IPC call
 * that throws, becomes an ordinary failure the form can show.
 */
export async function callVault<A extends unknown[], R extends { success: boolean }>(
  method: ((...args: A) => Promise<R>) | undefined,
  ...args: A
): Promise<R | VaultFailure> {
  if (!method) return { success: false, error: "This version of WhisperWoof can't do that yet." };
  try {
    return await method(...args);
  } catch {
    return { success: false, error: "" };
  }
}

// ── Settings copy ──────────────────────────────────────────────────────────────

export function settingsMode(status: VaultStatus | null | undefined): "hidden" | "off" | "on" {
  if (!status || !status.platformSupported) return "hidden";
  return status.status === "off" ? "off" : "on";
}

export function encryptionSummary(status: VaultStatus): string {
  if (status.status === "off") return "Your history, notes and recordings are stored as plain files on this Mac.";
  return canUseTouchId(status)
    ? "Encrypted. Unlocks with Touch ID or your password."
    : "Encrypted. Unlocks with your password.";
}

export function touchIdRowDescription(touchId: VaultTouchIdState): string {
  if (touchId.available) return "Use your fingerprint instead of typing your password.";
  switch (touchId.reason) {
    case "notEnrolled":
      return "Add a fingerprint in System Settings → Touch ID & Password to use it here.";
    case "lockout":
      return "Touch ID is locked after too many tries. Unlock your Mac with its password, then try again.";
    default:
      return "This Mac doesn't have Touch ID.";
  }
}

export function lockNowDescription(status: VaultStatus): string {
  return status.lockDeferred
    ? "A meeting is recording. WhisperWoof locks when it ends."
    : "Dictation keeps working. History and notes need an unlock.";
}
