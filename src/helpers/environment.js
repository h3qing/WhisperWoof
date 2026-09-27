const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");
const { app } = require("electron");
const { normalizeUiLanguage } = require("./i18nMain");

const PERSISTED_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CUSTOM_TRANSCRIPTION_API_KEY",
  "CUSTOM_REASONING_API_KEY",
  "LOCAL_TRANSCRIPTION_PROVIDER",
  "PARAKEET_MODEL",
  "LIVE_PREVIEW_MODEL",
  "LOCAL_WHISPER_MODEL",
  "REASONING_PROVIDER",
  "LOCAL_REASONING_MODEL",
  "LLAMA_GPU_BACKEND",
  "LLAMA_VULKAN_ENABLED",
  "DICTATION_KEY",
  "AGENT_KEY",
  "MEETING_KEY",
  "ACTIVATION_MODE",
  "FLOATING_ICON_AUTO_HIDE",
  "START_MINIMIZED",
  "UI_LANGUAGE",
  "WHISPER_CUDA_ENABLED",
  "SKIPPED_UPDATE_VERSION",
];

// The only names read back from userData/.env. Every child process (servers,
// ffmpeg, MCP plugins) inherits process.env, so a planted line or a value
// smuggling a newline must never set NODE_OPTIONS, PATH, DYLD_* and friends.
const LOADABLE_KEYS = new Set([...PERSISTED_KEYS, "PANEL_START_POSITION", "OPENWHISPR_LOG_LEVEL"]);

/** One line per value: a newline would start a new `NAME=value` line. */
function envValue(value) {
  return String(value ?? "").replace(/[\r\n]/g, "");
}

function loadAppEnvFile(envPath, { override }) {
  const parsed = require("dotenv").parse(fs.readFileSync(envPath));
  for (const [name, value] of Object.entries(parsed)) {
    if (!LOADABLE_KEYS.has(name)) continue;
    if (override || process.env[name] === undefined) process.env[name] = value;
  }
}

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables() {
    // App config (.env in userData) takes precedence over system env vars,
    // so keys saved by the user in Settings always win.
    const userDataEnv = path.join(app.getPath("userData"), ".env");
    try {
      if (fs.existsSync(userDataEnv)) {
        loadAppEnvFile(userDataEnv, { override: true });
      }
    } catch {}

    const fallbackPaths = [
      path.join(__dirname, "..", "..", ".env"), // Development
      path.join(process.resourcesPath, ".env"),
      path.join(process.resourcesPath, "app.asar.unpacked", ".env"),
      path.join(process.resourcesPath, "app", ".env"), // Legacy
    ];

    for (const envPath of fallbackPaths) {
      try {
        if (fs.existsSync(envPath)) {
          require("dotenv").config({ path: envPath });
        }
      } catch {}
    }
  }

  _getKey(envVarName) {
    return process.env[envVarName] || "";
  }

  _saveKey(envVarName, key) {
    process.env[envVarName] = envValue(key);
    return { success: true };
  }

  getOpenAIKey() {
    return this._getKey("OPENAI_API_KEY");
  }

  saveOpenAIKey(key) {
    return this._saveKey("OPENAI_API_KEY", key);
  }

  getAnthropicKey() {
    return this._getKey("ANTHROPIC_API_KEY");
  }

  saveAnthropicKey(key) {
    return this._saveKey("ANTHROPIC_API_KEY", key);
  }

  getGeminiKey() {
    return this._getKey("GEMINI_API_KEY");
  }

  saveGeminiKey(key) {
    return this._saveKey("GEMINI_API_KEY", key);
  }

  getGroqKey() {
    return this._getKey("GROQ_API_KEY");
  }

  saveGroqKey(key) {
    return this._saveKey("GROQ_API_KEY", key);
  }

  getMistralKey() {
    return this._getKey("MISTRAL_API_KEY");
  }

  saveMistralKey(key) {
    return this._saveKey("MISTRAL_API_KEY", key);
  }

  getCustomTranscriptionKey() {
    return this._getKey("CUSTOM_TRANSCRIPTION_API_KEY");
  }

  saveCustomTranscriptionKey(key) {
    return this._saveKey("CUSTOM_TRANSCRIPTION_API_KEY", key);
  }

  getCustomReasoningKey() {
    return this._getKey("CUSTOM_REASONING_API_KEY");
  }

  saveCustomReasoningKey(key) {
    return this._saveKey("CUSTOM_REASONING_API_KEY", key);
  }

  getDictationKey() {
    return this._getKey("DICTATION_KEY");
  }

  saveDictationKey(key) {
    const result = this._saveKey("DICTATION_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getAgentKey() {
    return this._getKey("AGENT_KEY");
  }

  saveAgentKey(key) {
    const result = this._saveKey("AGENT_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getMeetingKey() {
    return this._getKey("MEETING_KEY");
  }

  saveMeetingKey(key) {
    const result = this._saveKey("MEETING_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getActivationMode() {
    const mode = this._getKey("ACTIVATION_MODE");
    return mode === "push" ? "push" : "tap";
  }

  saveActivationMode(mode) {
    const validMode = mode === "push" ? "push" : "tap";
    const result = this._saveKey("ACTIVATION_MODE", validMode);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getSkippedUpdateVersion() {
    return this._getKey("SKIPPED_UPDATE_VERSION");
  }

  saveSkippedUpdateVersion(version) {
    const result = this._saveKey("SKIPPED_UPDATE_VERSION", String(version || "").trim());
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getFloatingIconAutoHide() {
    return this._getKey("FLOATING_ICON_AUTO_HIDE") === "true";
  }

  saveFloatingIconAutoHide(enabled) {
    const result = this._saveKey("FLOATING_ICON_AUTO_HIDE", String(enabled));
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getStartMinimized() {
    return this._getKey("START_MINIMIZED") === "true";
  }

  saveStartMinimized(enabled) {
    const result = this._saveKey("START_MINIMIZED", String(enabled));
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getPanelStartPosition() {
    const v = this._getKey("PANEL_START_POSITION");
    if (v === "bottom-right" || v === "center" || v === "bottom-left") return v;
    return "center"; // WhisperWoof: center by default
  }

  savePanelStartPosition(position) {
    const result = this._saveKey("PANEL_START_POSITION", position);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getUiLanguage() {
    return normalizeUiLanguage(this._getKey("UI_LANGUAGE"));
  }

  saveUiLanguage(language) {
    const normalized = normalizeUiLanguage(language);
    const result = this._saveKey("UI_LANGUAGE", normalized);
    this.saveAllKeysToEnvFile().catch(() => {});
    return { ...result, language: normalized };
  }

  async createProductionEnvFile(apiKey) {
    const envPath = path.join(app.getPath("userData"), ".env");

    const envContent = `# OpenWhispr Environment Variables
# This file was created automatically for production use
OPENAI_API_KEY=${envValue(apiKey)}
`;

    await fsPromises.writeFile(envPath, envContent, { encoding: "utf8", mode: 0o600 });
    await fsPromises.chmod(envPath, 0o600).catch(() => {});
    loadAppEnvFile(envPath, { override: false });

    return { success: true, path: envPath };
  }

  async saveAllKeysToEnvFile() {
    const envPath = path.join(app.getPath("userData"), ".env");

    let envContent = "# OpenWhispr Environment Variables\n";

    for (const key of PERSISTED_KEYS) {
      if (process.env[key]) {
        envContent += `${key}=${envValue(process.env[key])}\n`;
      }
    }

    // API keys: readable by this user only (the file predates encryption and
    // stays outside it; see docs/design/at-rest-encryption.md §8).
    await fsPromises.writeFile(envPath, envContent, { encoding: "utf8", mode: 0o600 });
    await fsPromises.chmod(envPath, 0o600).catch(() => {});

    return { success: true, path: envPath };
  }
}

module.exports = EnvironmentManager;
