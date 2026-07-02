import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useSettingsStore, initializeSettings } from "../stores/settingsStore";
import logger from "../utils/logger";
import { useLocalStorage } from "./useLocalStorage";
import { normalizeReasoningPrefsForSync } from "../whisperwoof/core/settings/startup-reasoning-prefs";
import type { LocalTranscriptionProvider } from "../types/electron";

export interface TranscriptionSettings {
  uiLanguage: string;
  useLocalWhisper: boolean;
  whisperModel: string;
  localTranscriptionProvider: LocalTranscriptionProvider;
  parakeetModel: string;
  allowOpenAIFallback: boolean;
  allowLocalFallback: boolean;
  fallbackWhisperModel: string;
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
  cloudTranscriptionMode: string;
  customDictionary: string[];
  assemblyAiStreaming: boolean;
}

export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  cloudReasoningBaseUrl?: string;
  cloudReasoningMode: string;
}

export interface HotkeySettings {
  dictationKey: string;
  activationMode: "tap" | "push";
}

export interface MicrophoneSettings {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
}

export interface ApiKeySettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  mistralApiKey: string;
  customTranscriptionApiKey: string;
  customReasoningApiKey: string;
}

export interface PrivacySettings {
  cloudBackupEnabled: boolean;
  telemetryEnabled: boolean;
  audioRetentionDays: number;
  dataRetentionEnabled: boolean;
}

export interface ThemeSettings {
  theme: "light" | "dark" | "auto";
}

export interface AgentModeSettings {
  agentModel: string;
  agentProvider: string;
  agentKey: string;
  agentSystemPrompt: string;
  agentEnabled: boolean;
  cloudAgentMode: string;
}

function useSettingsInternal() {
  const store = useSettingsStore();

  // One-time initialization: sync API keys, dictation key, activation mode,
  // UI language, and dictionary from the main process / SQLite.
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    initializeSettings().catch((err) => {
      logger.warn(
        "Failed to initialize settings store",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, []);

  // One-shot cleanup of orphan polish localStorage keys. After the polish
  // consolidation (commits a3f10398b / 8e9bf64b1 / c69f3a1d5), nothing reads
  // these keys — all polish settings now flow through ReasoningService /
  // settingsStore. Sentinel ensures this runs only once per user.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("whisperwoof-polish-cleanup-v1")) return;
    const orphanKeys = [
      "whisperwoof-polish-enabled",
      "whisperwoof-polish-preset",
      "whisperwoof-custom-prompt",
      "whisperwoof-polish-provider",
      "whisperwoof-polish-model",
      "whisperwoof-ollama-model",
      "whisperwoof-openai-api-key",
      "whisperwoof-anthropic-api-key",
      "whisperwoof-groq-api-key",
      "whisperwoof-ollama-api-key",
    ];
    orphanKeys.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("whisperwoof-polish-cleanup-v1", "done");
  }, []);

  // Listen for dictionary updates from main process (auto-learn corrections)
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onDictionaryUpdated) return;
    const unsubscribe = window.electronAPI.onDictionaryUpdated((words: string[]) => {
      if (Array.isArray(words)) {
        store.setCustomDictionary(words);
      }
    });
    return unsubscribe;
  }, [store.setCustomDictionary]);

  // Auto-learn corrections from user edits in external apps
  const [autoLearnCorrections, setAutoLearnCorrectionsRaw] = useLocalStorage(
    "autoLearnCorrections",
    true,
    {
      serialize: String,
      deserialize: (value: string) => value !== "false",
    }
  );

  const setAutoLearnCorrections = useCallback(
    (enabled: boolean) => {
      setAutoLearnCorrectionsRaw(enabled);
      window.electronAPI?.setAutoLearnEnabled?.(enabled);
    },
    [setAutoLearnCorrectionsRaw]
  );

  // Sync auto-learn state to main process on mount
  useEffect(() => {
    window.electronAPI?.setAutoLearnEnabled?.(autoLearnCorrections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync startup pre-warming preferences to main process
  const {
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    reasoningProvider,
    reasoningModel,
    useReasoningModel,
  } = store;

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.syncStartupPreferences) return;

    const model = localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel;
    // The model picker may persist a local family id ("qwen", "llama", …) as the
    // provider; main keys prewarm on exactly "local", so normalize before syncing.
    const reasoningPrefs = normalizeReasoningPrefsForSync(reasoningProvider, reasoningModel);
    window.electronAPI
      .syncStartupPreferences({
        useLocalWhisper,
        localTranscriptionProvider,
        model: model || undefined,
        reasoningProvider: reasoningPrefs.reasoningProvider,
        reasoningModel: reasoningPrefs.reasoningModel,
        useReasoningModel,
      })
      .catch((err) =>
        logger.warn(
          "Failed to sync startup preferences",
          { error: (err as Error).message },
          "settings"
        )
      );
  }, [
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    reasoningProvider,
    reasoningModel,
    useReasoningModel,
  ]);

  return {
    useLocalWhisper: store.useLocalWhisper,
    whisperModel: store.whisperModel,
    uiLanguage: store.uiLanguage,
    localTranscriptionProvider: store.localTranscriptionProvider,
    parakeetModel: store.parakeetModel,
    allowOpenAIFallback: store.allowOpenAIFallback,
    allowLocalFallback: store.allowLocalFallback,
    fallbackWhisperModel: store.fallbackWhisperModel,
    preferredLanguage: store.preferredLanguage,
    cloudTranscriptionProvider: store.cloudTranscriptionProvider,
    cloudTranscriptionModel: store.cloudTranscriptionModel,
    cloudTranscriptionBaseUrl: store.cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl: store.cloudReasoningBaseUrl,
    cloudTranscriptionMode: store.cloudTranscriptionMode,
    cloudReasoningMode: store.cloudReasoningMode,
    customDictionary: store.customDictionary,
    assemblyAiStreaming: store.assemblyAiStreaming,
    setAssemblyAiStreaming: store.setAssemblyAiStreaming,
    useReasoningModel: store.useReasoningModel,
    reasoningModel: store.reasoningModel,
    reasoningProvider: store.reasoningProvider,
    openaiApiKey: store.openaiApiKey,
    anthropicApiKey: store.anthropicApiKey,
    geminiApiKey: store.geminiApiKey,
    groqApiKey: store.groqApiKey,
    mistralApiKey: store.mistralApiKey,
    dictationKey: store.dictationKey,
    theme: store.theme,
    setUseLocalWhisper: store.setUseLocalWhisper,
    setWhisperModel: store.setWhisperModel,
    setUiLanguage: store.setUiLanguage,
    setLocalTranscriptionProvider: store.setLocalTranscriptionProvider,
    setParakeetModel: store.setParakeetModel,
    setAllowOpenAIFallback: store.setAllowOpenAIFallback,
    setAllowLocalFallback: store.setAllowLocalFallback,
    setFallbackWhisperModel: store.setFallbackWhisperModel,
    setPreferredLanguage: store.setPreferredLanguage,
    setCloudTranscriptionProvider: store.setCloudTranscriptionProvider,
    setCloudTranscriptionModel: store.setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl: store.setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl: store.setCloudReasoningBaseUrl,
    setCloudTranscriptionMode: store.setCloudTranscriptionMode,
    setCloudReasoningMode: store.setCloudReasoningMode,
    setCustomDictionary: store.setCustomDictionary,
    setUseReasoningModel: store.setUseReasoningModel,
    setReasoningModel: store.setReasoningModel,
    setReasoningProvider: store.setReasoningProvider,
    setOpenaiApiKey: store.setOpenaiApiKey,
    setAnthropicApiKey: store.setAnthropicApiKey,
    setGeminiApiKey: store.setGeminiApiKey,
    setGroqApiKey: store.setGroqApiKey,
    setMistralApiKey: store.setMistralApiKey,
    customTranscriptionApiKey: store.customTranscriptionApiKey,
    setCustomTranscriptionApiKey: store.setCustomTranscriptionApiKey,
    customReasoningApiKey: store.customReasoningApiKey,
    setCustomReasoningApiKey: store.setCustomReasoningApiKey,
    setDictationKey: store.setDictationKey,
    setTheme: store.setTheme,
    activationMode: store.activationMode,
    setActivationMode: store.setActivationMode,
    audioCuesEnabled: store.audioCuesEnabled,
    setAudioCuesEnabled: store.setAudioCuesEnabled,
    pauseMediaOnDictation: store.pauseMediaOnDictation,
    setPauseMediaOnDictation: store.setPauseMediaOnDictation,
    floatingIconAutoHide: store.floatingIconAutoHide,
    setFloatingIconAutoHide: store.setFloatingIconAutoHide,
    startMinimized: store.startMinimized,
    setStartMinimized: store.setStartMinimized,
    panelStartPosition: store.panelStartPosition,
    setPanelStartPosition: store.setPanelStartPosition,
    preferBuiltInMic: store.preferBuiltInMic,
    selectedMicDeviceId: store.selectedMicDeviceId,
    setPreferBuiltInMic: store.setPreferBuiltInMic,
    setSelectedMicDeviceId: store.setSelectedMicDeviceId,
    autoLearnCorrections,
    setAutoLearnCorrections,
    autoPasteEnabled: store.autoPasteEnabled,
    setAutoPasteEnabled: store.setAutoPasteEnabled,
    keepTranscriptionInClipboard: store.keepTranscriptionInClipboard,
    setKeepTranscriptionInClipboard: store.setKeepTranscriptionInClipboard,
    cloudBackupEnabled: store.cloudBackupEnabled,
    setCloudBackupEnabled: store.setCloudBackupEnabled,
    telemetryEnabled: store.telemetryEnabled,
    setTelemetryEnabled: store.setTelemetryEnabled,
    audioRetentionDays: store.audioRetentionDays,
    setAudioRetentionDays: store.setAudioRetentionDays,
    dataRetentionEnabled: store.dataRetentionEnabled,
    setDataRetentionEnabled: store.setDataRetentionEnabled,
    updateTranscriptionSettings: store.updateTranscriptionSettings,
    updateReasoningSettings: store.updateReasoningSettings,
    updateApiKeys: store.updateApiKeys,
  };
}

export type SettingsValue = ReturnType<typeof useSettingsInternal>;

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useSettingsInternal();
  return React.createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
