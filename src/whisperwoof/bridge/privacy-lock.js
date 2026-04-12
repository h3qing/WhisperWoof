/**
 * Privacy Lock Mode — Zero network, fully local operation
 *
 * When enabled:
 * 1. All cloud LLM providers blocked (OpenAI, Anthropic, Groq)
 * 2. Only Ollama (localhost) allowed for polish
 * 3. Cloud STT disabled — local Whisper only
 * 4. Telegram sync paused
 * 5. No analytics/telemetry sent anywhere
 * 6. Visual indicator shows lock icon
 *
 * Storage: ~/.config/WhisperWoof/whisperwoof-privacy.json
 * Also respects in-memory toggle for per-session privacy.
 *
 * Competitor: DictaFlow local/cloud toggle, SuperWhisper privacy mode,
 * Voice Gecko offline-only. WhisperWoof goes further — explicit lock
 * that blocks ALL network access, not just STT.
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
const {
  DEFAULT_ALLOWED_LOCAL,
  PRIVACY_OVERRIDES,
  isUrlAllowedWhenLocked,
  isProviderAllowedWhenLocked,
} = require("./privacy-lock-pure");

const PRIVACY_FILE = path.join(app.getPath("userData"), "whisperwoof-privacy.json");

// --- State ---

let privacyState = null; // Loaded on first access

function loadState() {
  if (privacyState !== null) return privacyState;

  try {
    if (fs.existsSync(PRIVACY_FILE)) {
      privacyState = JSON.parse(fs.readFileSync(PRIVACY_FILE, "utf-8"));
      return privacyState;
    }
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to load privacy state", { error: err.message });
  }

  privacyState = {
    locked: false,
    lockedAt: null,
    lockedBy: null, // "user" or "schedule"
    autoLockOnBattery: false,
    autoLockOnVpn: false,
    networkBlockList: [], // Additional domains to always block
    allowedLocalAddresses: [...DEFAULT_ALLOWED_LOCAL],
  };

  return privacyState;
}

function saveState() {
  try {
    const dir = path.dirname(PRIVACY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PRIVACY_FILE, JSON.stringify(privacyState, null, 2), "utf-8");
  } catch (err) {
    debugLogger.warn("[WhisperWoof] Failed to save privacy state", { error: err.message });
  }
}

// --- Lock/Unlock ---

/**
 * Enable privacy lock. Blocks all network access except localhost.
 */
function enablePrivacyLock(options = {}) {
  const state = loadState();
  if (state.locked) return { success: true, alreadyLocked: true };

  privacyState = {
    ...state,
    locked: true,
    lockedAt: new Date().toISOString(),
    lockedBy: options.lockedBy || "user",
  };

  saveState();

  debugLogger.info("[WhisperWoof] Privacy lock ENABLED", {
    lockedBy: privacyState.lockedBy,
  });

  return { success: true, alreadyLocked: false };
}

/**
 * Disable privacy lock. Restores normal network access.
 */
function disablePrivacyLock() {
  const state = loadState();
  if (!state.locked) return { success: true, alreadyUnlocked: true };

  const lockedDuration = state.lockedAt
    ? Math.round((Date.now() - new Date(state.lockedAt).getTime()) / 60000)
    : 0;

  privacyState = {
    ...state,
    locked: false,
    lockedAt: null,
    lockedBy: null,
  };

  saveState();

  debugLogger.info("[WhisperWoof] Privacy lock DISABLED", {
    durationMin: lockedDuration,
  });

  return { success: true, alreadyUnlocked: false, durationMin: lockedDuration };
}

/**
 * Check if privacy lock is active.
 */
function isPrivacyLocked() {
  return loadState().locked;
}

/**
 * Get full privacy state (for settings UI).
 */
function getPrivacyState() {
  const state = loadState();
  return {
    locked: state.locked,
    lockedAt: state.lockedAt,
    lockedBy: state.lockedBy,
    autoLockOnBattery: state.autoLockOnBattery,
    autoLockOnVpn: state.autoLockOnVpn,
    durationMin: state.lockedAt
      ? Math.round((Date.now() - new Date(state.lockedAt).getTime()) / 60000)
      : 0,
  };
}

// --- Network validation ---

/**
 * Check if a URL is allowed under privacy lock. Pure allowlist check lives
 * in privacy-lock-pure.js; this wrapper just layers on the persisted state.
 */
function isUrlAllowed(url) {
  const state = loadState();
  if (!state.locked) return true;
  return isUrlAllowedWhenLocked(url, state.allowedLocalAddresses);
}

/**
 * Check if a provider is allowed under privacy lock.
 */
function isProviderAllowed(providerId) {
  const state = loadState();
  if (!state.locked) return true;
  return isProviderAllowedWhenLocked(providerId);
}

/**
 * Get the enforced settings when privacy lock is active.
 * These override user preferences.
 */
function getPrivacyOverrides() {
  const state = loadState();
  if (!state.locked) return null;
  return PRIVACY_OVERRIDES;
}

// --- Settings ---

function updatePrivacySettings(updates) {
  const state = loadState();

  if (updates.autoLockOnBattery !== undefined) {
    state.autoLockOnBattery = !!updates.autoLockOnBattery;
  }
  if (updates.autoLockOnVpn !== undefined) {
    state.autoLockOnVpn = !!updates.autoLockOnVpn;
  }
  if (Array.isArray(updates.networkBlockList)) {
    state.networkBlockList = updates.networkBlockList.filter((d) => typeof d === "string" && d.trim());
  }

  privacyState = state;
  saveState();

  return { success: true };
}

module.exports = {
  enablePrivacyLock,
  disablePrivacyLock,
  isPrivacyLocked,
  getPrivacyState,
  isUrlAllowed,
  isProviderAllowed,
  getPrivacyOverrides,
  updatePrivacySettings,
};
