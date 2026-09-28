/**
 * What counts as a usable vault password, and how long the lock screen makes
 * someone wait after wrong ones. Pure: no fs, no electron.
 *
 * vault.json (with the scrypt-wrapped master key) sits in backups, so a
 * password is only as good as the guesses it survives offline. At least 8
 * characters, and not one of the passwords every wordlist starts with
 * (common-passwords.json, shared with the renderer's check in
 * ui/vault/vault-ui-pure.ts).
 */

const COMMON_PASSWORDS = require("./common-passwords.json");

const MIN_PASSWORD_LENGTH = 8;
const COMMON = new Set(COMMON_PASSWORDS);

// Wrong passwords at the lock screen: the first three cost nothing extra,
// then each one waits twice as long as the last (1 s, 2 s, 4 s … 30 s).
const FREE_TRIES = 3;
const MAX_WAIT_MS = 30 * 1000;

/** Compared the way scrypt sees it (NFKC), ignoring case. */
const normalized = (password) => String(password).normalize("NFKC").toLowerCase();

/** Too easy to guess: a well-known password, or one character repeated. */
function isTooEasy(password) {
  const n = normalized(password);
  return COMMON.has(n) || /^(.)\1*$/u.test(n);
}

/** Why a new password can't be used, in plain words; null when it's fine. */
function passwordProblem(password) {
  if (typeof password !== "string" || [...password].length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  }
  if (isTooEasy(password)) return "That password is too easy to guess. Try a few words together.";
  return null;
}

/** How long to wait before the next try, after `failures` wrong passwords in a row. */
function unlockDelayMs(failures) {
  if (!Number.isInteger(failures) || failures < FREE_TRIES) return 0;
  return Math.min(1000 * 2 ** (failures - FREE_TRIES), MAX_WAIT_MS);
}

module.exports = { MIN_PASSWORD_LENGTH, COMMON_PASSWORDS, isTooEasy, passwordProblem, unlockDelayMs };
