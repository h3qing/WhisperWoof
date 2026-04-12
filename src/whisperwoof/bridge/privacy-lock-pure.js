/**
 * Pure logic for Privacy Lock Mode.
 *
 * No file I/O, no electron, no side effects. Shared between privacy-lock.js
 * (which layers persisted state on top) and privacy-lock.test.ts.
 *
 * IMPORTANT: the security guarantees of privacy lock depend on these checks
 * matching what the runtime actually enforces, so both sides MUST import
 * from here — keeping the logic in one place is the whole point.
 */

/**
 * Standard loopback addresses that are always allowed under privacy lock.
 * Frozen so callers can't accidentally append a cloud host at runtime.
 */
const DEFAULT_ALLOWED_LOCAL = Object.freeze(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/**
 * Settings forced by privacy lock when it is active. Freezing this stops
 * accidental mutation from leaking a "relaxed" override to the runtime.
 */
const PRIVACY_OVERRIDES = Object.freeze({
  provider: "ollama",
  useLocalWhisper: true,
  cloudSttDisabled: true,
  telegramSyncPaused: true,
  analyticsDisabled: true,
  pluginNetworkBlocked: true,
});

/**
 * Decide whether a URL is allowed *while privacy lock is enabled*. Callers
 * that already know the lock is off should short-circuit before calling.
 * Invalid URLs are blocked (fail-closed).
 */
function isUrlAllowedWhenLocked(url, allowedLocalAddresses = DEFAULT_ALLOWED_LOCAL) {
  try {
    const parsed = new URL(url);
    return allowedLocalAddresses.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Decide whether an LLM provider is allowed while privacy lock is enabled.
 * Only "ollama" (localhost Ollama) is permitted — everything else goes out
 * over the network.
 */
function isProviderAllowedWhenLocked(providerId) {
  return providerId === "ollama";
}

module.exports = {
  DEFAULT_ALLOWED_LOCAL,
  PRIVACY_OVERRIDES,
  isUrlAllowedWhenLocked,
  isProviderAllowedWhenLocked,
};
