const { contextBridge, ipcRenderer, webUtils } = require("electron");

/**
 * Helper to register an IPC listener and return a cleanup function.
 * Ensures renderer code can easily remove listeners to avoid leaks.
 */
const registerListener = (channel, handlerFactory) => {
  return (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener =
      typeof handlerFactory === "function"
        ? handlerFactory(callback)
        : (event, ...args) => callback(event, ...args);

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
};

contextBridge.exposeInMainWorld("electronAPI", {
  pasteText: (text, options) => ipcRenderer.invoke("paste-text", text, options),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showDictationPanel: () => ipcRenderer.invoke("show-dictation-panel"),
  onToggleDictation: registerListener("toggle-dictation", (callback) => () => callback()),
  onStartDictation: registerListener("start-dictation", (callback) => () => callback()),
  onStopDictation: registerListener("stop-dictation", (callback) => (_event, hotkeyUsed) => callback(hotkeyUsed)),

  // Database functions
  saveTranscription: (text, rawText, options) =>
    ipcRenderer.invoke("db-save-transcription", text, rawText, options),
  getTranscriptions: (limit) => ipcRenderer.invoke("db-get-transcriptions", limit),
  clearTranscriptions: () => ipcRenderer.invoke("db-clear-transcriptions"),
  deleteTranscription: (id) => ipcRenderer.invoke("db-delete-transcription", id),

  // Audio storage functions
  saveTranscriptionAudio: (id, audioBuffer, metadata) =>
    ipcRenderer.invoke("save-transcription-audio", id, audioBuffer, metadata),
  getAudioPath: (id) => ipcRenderer.invoke("get-audio-path", id),
  showAudioInFolder: (id) => ipcRenderer.invoke("show-audio-in-folder", id),
  getAudioBuffer: (id) => ipcRenderer.invoke("get-audio-buffer", id),
  deleteTranscriptionAudio: (id) => ipcRenderer.invoke("delete-transcription-audio", id),
  getAudioStorageUsage: () => ipcRenderer.invoke("get-audio-storage-usage"),
  deleteAllAudio: () => ipcRenderer.invoke("delete-all-audio"),
  retryTranscription: (id, options) => ipcRenderer.invoke("retry-transcription", id, options),
  updateTranscriptionText: (id, text, rawText) =>
    ipcRenderer.invoke("update-transcription-text", id, text, rawText),
  getTranscriptionById: (id) => ipcRenderer.invoke("get-transcription-by-id", id),

  // Dictionary functions
  getDictionary: () => ipcRenderer.invoke("db-get-dictionary"),
  setDictionary: (words) => ipcRenderer.invoke("db-set-dictionary", words),
  onDictionaryUpdated: (callback) => {
    const listener = (_event, words) => callback?.(words);
    ipcRenderer.on("dictionary-updated", listener);
    return () => ipcRenderer.removeListener("dictionary-updated", listener);
  },
  setAutoLearnEnabled: (enabled) => ipcRenderer.send("auto-learn-changed", enabled),
  onCorrectionsLearned: (callback) => {
    const listener = (_event, words) => callback?.(words);
    ipcRenderer.on("corrections-learned", listener);
    return () => ipcRenderer.removeListener("corrections-learned", listener);
  },
  undoLearnedCorrections: (words) => ipcRenderer.invoke("undo-learned-corrections", words),

  // Note functions
  saveNote: (title, content, noteType, sourceFile, audioDuration, folderId) =>
    ipcRenderer.invoke(
      "db-save-note",
      title,
      content,
      noteType,
      sourceFile,
      audioDuration,
      folderId
    ),
  getNote: (id) => ipcRenderer.invoke("db-get-note", id),
  getNotes: (noteType, limit, folderId) =>
    ipcRenderer.invoke("db-get-notes", noteType, limit, folderId),
  updateNote: (id, updates) => ipcRenderer.invoke("db-update-note", id, updates),
  deleteNote: (id) => ipcRenderer.invoke("db-delete-note", id),
  exportNote: (noteId, format) => ipcRenderer.invoke("export-note", noteId, format),
  searchNotes: (query, limit) => ipcRenderer.invoke("db-search-notes", query, limit),
  updateNoteCloudId: (id, cloudId) => ipcRenderer.invoke("db-update-note-cloud-id", id, cloudId),

  // Folder functions
  getFolders: () => ipcRenderer.invoke("db-get-folders"),
  createFolder: (name) => ipcRenderer.invoke("db-create-folder", name),
  deleteFolder: (id) => ipcRenderer.invoke("db-delete-folder", id),
  renameFolder: (id, name) => ipcRenderer.invoke("db-rename-folder", id, name),
  getFolderNoteCounts: () => ipcRenderer.invoke("db-get-folder-note-counts"),

  // Action functions
  getActions: () => ipcRenderer.invoke("db-get-actions"),
  getAction: (id) => ipcRenderer.invoke("db-get-action", id),
  createAction: (name, description, prompt, icon) =>
    ipcRenderer.invoke("db-create-action", name, description, prompt, icon),
  updateAction: (id, updates) => ipcRenderer.invoke("db-update-action", id, updates),
  deleteAction: (id) => ipcRenderer.invoke("db-delete-action", id),

  // Audio file operations
  selectAudioFile: () => ipcRenderer.invoke("select-audio-file"),
  getFileSize: (filePath) => ipcRenderer.invoke("get-file-size", filePath),
  transcribeAudioFile: (filePath, options) =>
    ipcRenderer.invoke("transcribe-audio-file", filePath, options),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onNoteAdded: (callback) => {
    const listener = (_event, note) => callback?.(note);
    ipcRenderer.on("note-added", listener);
    return () => ipcRenderer.removeListener("note-added", listener);
  },
  onNoteUpdated: (callback) => {
    const listener = (_event, note) => callback?.(note);
    ipcRenderer.on("note-updated", listener);
    return () => ipcRenderer.removeListener("note-updated", listener);
  },
  onNoteDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("note-deleted", listener);
    return () => ipcRenderer.removeListener("note-deleted", listener);
  },

  onActionCreated: (callback) => {
    const listener = (_event, action) => callback?.(action);
    ipcRenderer.on("action-created", listener);
    return () => ipcRenderer.removeListener("action-created", listener);
  },
  onActionUpdated: (callback) => {
    const listener = (_event, action) => callback?.(action);
    ipcRenderer.on("action-updated", listener);
    return () => ipcRenderer.removeListener("action-updated", listener);
  },
  onActionDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("action-deleted", listener);
    return () => ipcRenderer.removeListener("action-deleted", listener);
  },

  onTranscriptionAdded: (callback) => {
    const listener = (_event, transcription) => callback?.(transcription);
    ipcRenderer.on("transcription-added", listener);
    return () => ipcRenderer.removeListener("transcription-added", listener);
  },
  onTranscriptionDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcription-deleted", listener);
    return () => ipcRenderer.removeListener("transcription-deleted", listener);
  },
  onTranscriptionsCleared: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcriptions-cleared", listener);
    return () => ipcRenderer.removeListener("transcriptions-cleared", listener);
  },
  onTranscriptionUpdated: (callback) => {
    const listener = (_event, transcription) => callback?.(transcription);
    ipcRenderer.on("transcription-updated", listener);
    return () => ipcRenderer.removeListener("transcription-updated", listener);
  },

  // Environment variables
  getOpenAIKey: () => ipcRenderer.invoke("get-openai-key"),
  saveOpenAIKey: (key) => ipcRenderer.invoke("save-openai-key", key),
  createProductionEnvFile: (key) => ipcRenderer.invoke("create-production-env-file", key),

  // Clipboard functions
  checkAccessibilityPermission: (silent) =>
    ipcRenderer.invoke("check-accessibility-permission", silent),
  promptAccessibilityPermission: () => ipcRenderer.invoke("prompt-accessibility-permission"),
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),
  checkPasteTools: () => ipcRenderer.invoke("check-paste-tools"),

  // Local Whisper functions (whisper.cpp)
  transcribeLocalWhisper: (audioBlob, options) =>
    ipcRenderer.invoke("transcribe-local-whisper", audioBlob, options),
  checkWhisperInstallation: () => ipcRenderer.invoke("check-whisper-installation"),
  downloadWhisperModel: (modelName) => ipcRenderer.invoke("download-whisper-model", modelName),
  onWhisperDownloadProgress: registerListener("whisper-download-progress"),
  checkModelStatus: (modelName) => ipcRenderer.invoke("check-model-status", modelName),
  listWhisperModels: () => ipcRenderer.invoke("list-whisper-models"),
  deleteWhisperModel: (modelName) => ipcRenderer.invoke("delete-whisper-model", modelName),
  deleteAllWhisperModels: () => ipcRenderer.invoke("delete-all-whisper-models"),
  cancelWhisperDownload: () => ipcRenderer.invoke("cancel-whisper-download"),
  checkFFmpegAvailability: () => ipcRenderer.invoke("check-ffmpeg-availability"),
  getAudioDiagnostics: () => ipcRenderer.invoke("get-audio-diagnostics"),

  // Whisper server functions (faster repeated transcriptions)
  whisperServerStart: (modelName) => ipcRenderer.invoke("whisper-server-start", modelName),
  whisperServerStop: () => ipcRenderer.invoke("whisper-server-stop"),
  whisperServerStatus: () => ipcRenderer.invoke("whisper-server-status"),

  // CUDA GPU acceleration
  detectGpu: () => ipcRenderer.invoke("detect-gpu"),
  getCudaWhisperStatus: () => ipcRenderer.invoke("get-cuda-whisper-status"),
  downloadCudaWhisperBinary: () => ipcRenderer.invoke("download-cuda-whisper-binary"),
  cancelCudaWhisperDownload: () => ipcRenderer.invoke("cancel-cuda-whisper-download"),
  deleteCudaWhisperBinary: () => ipcRenderer.invoke("delete-cuda-whisper-binary"),
  onCudaDownloadProgress: registerListener(
    "cuda-download-progress",
    (callback) => (_event, data) => callback(data)
  ),
  onCudaFallbackNotification: registerListener(
    "cuda-fallback-notification",
    (callback) => () => callback()
  ),

  // Local Parakeet (NVIDIA) functions
  transcribeLocalParakeet: (audioBlob, options) =>
    ipcRenderer.invoke("transcribe-local-parakeet", audioBlob, options),
  checkParakeetInstallation: () => ipcRenderer.invoke("check-parakeet-installation"),
  downloadParakeetModel: (modelName) => ipcRenderer.invoke("download-parakeet-model", modelName),
  onParakeetDownloadProgress: registerListener("parakeet-download-progress"),
  checkParakeetModelStatus: (modelName) =>
    ipcRenderer.invoke("check-parakeet-model-status", modelName),
  listParakeetModels: () => ipcRenderer.invoke("list-parakeet-models"),
  deleteParakeetModel: (modelName) => ipcRenderer.invoke("delete-parakeet-model", modelName),
  deleteAllParakeetModels: () => ipcRenderer.invoke("delete-all-parakeet-models"),
  cancelParakeetDownload: () => ipcRenderer.invoke("cancel-parakeet-download"),
  getParakeetDiagnostics: () => ipcRenderer.invoke("get-parakeet-diagnostics"),

  // Parakeet server functions (faster repeated transcriptions)
  parakeetServerStart: (modelName) => ipcRenderer.invoke("parakeet-server-start", modelName),
  parakeetServerStop: () => ipcRenderer.invoke("parakeet-server-stop"),
  parakeetServerStatus: () => ipcRenderer.invoke("parakeet-server-status"),
  parakeetStreamStart: (options) => ipcRenderer.invoke("parakeet-stream-start", options),
  parakeetStreamAudio: (pcmBuffer) => ipcRenderer.send("parakeet-stream-audio", pcmBuffer),
  parakeetStreamStop: () => ipcRenderer.invoke("parakeet-stream-stop"),
  parakeetStreamAbort: () => ipcRenderer.invoke("parakeet-stream-abort"),
  onParakeetStreamPartial: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on("parakeet-stream-partial", handler);
    return () => ipcRenderer.removeListener("parakeet-stream-partial", handler);
  },

  // Window control functions
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  restoreFromMeetingMode: () => ipcRenderer.invoke("restore-from-meeting-mode"),
  getPlatform: () => process.platform,
  appQuit: () => ipcRenderer.invoke("app-quit"),

  // Cleanup function
  cleanupApp: () => ipcRenderer.invoke("cleanup-app"),
  updateHotkey: (hotkey) => ipcRenderer.invoke("update-hotkey", hotkey),
  setHotkeyListeningMode: (enabled, newHotkey) =>
    ipcRenderer.invoke("set-hotkey-listening-mode", enabled, newHotkey),
  getHotkeyModeInfo: () => ipcRenderer.invoke("get-hotkey-mode-info"),
  startWindowDrag: () => ipcRenderer.invoke("start-window-drag"),
  stopWindowDrag: () => ipcRenderer.invoke("stop-window-drag"),
  setMainWindowInteractivity: (interactive) =>
    ipcRenderer.invoke("set-main-window-interactivity", interactive),
  resizeMainWindow: (sizeKey) => ipcRenderer.invoke("resize-main-window", sizeKey),

  // Update functions
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),

  // Update event listeners
  onUpdateAvailable: registerListener("update-available"),
  onUpdateNotAvailable: registerListener("update-not-available"),
  onUpdateDownloaded: registerListener("update-downloaded"),
  onUpdateDownloadProgress: registerListener("update-download-progress"),
  onUpdateError: registerListener("update-error"),

  // Audio event listeners
  onNoAudioDetected: registerListener("no-audio-detected"),

  // External link opener
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Model management functions
  modelGetAll: () => ipcRenderer.invoke("model-get-all"),
  modelCheck: (modelId) => ipcRenderer.invoke("model-check", modelId),
  modelDownload: (modelId) => ipcRenderer.invoke("model-download", modelId),
  modelDelete: (modelId) => ipcRenderer.invoke("model-delete", modelId),
  modelDeleteAll: () => ipcRenderer.invoke("model-delete-all"),
  modelCheckRuntime: () => ipcRenderer.invoke("model-check-runtime"),
  modelCancelDownload: (modelId) => ipcRenderer.invoke("model-cancel-download", modelId),
  onModelDownloadProgress: registerListener("model-download-progress"),

  // Anthropic API
  getAnthropicKey: () => ipcRenderer.invoke("get-anthropic-key"),
  saveAnthropicKey: (key) => ipcRenderer.invoke("save-anthropic-key", key),
  getUiLanguage: () => ipcRenderer.invoke("get-ui-language"),
  saveUiLanguage: (language) => ipcRenderer.invoke("save-ui-language", language),
  setUiLanguage: (language) => ipcRenderer.invoke("set-ui-language", language),

  // Gemini API
  getGeminiKey: () => ipcRenderer.invoke("get-gemini-key"),
  saveGeminiKey: (key) => ipcRenderer.invoke("save-gemini-key", key),

  // Groq API
  getGroqKey: () => ipcRenderer.invoke("get-groq-key"),
  saveGroqKey: (key) => ipcRenderer.invoke("save-groq-key", key),

  // Mistral API
  getMistralKey: () => ipcRenderer.invoke("get-mistral-key"),
  saveMistralKey: (key) => ipcRenderer.invoke("save-mistral-key", key),
  proxyMistralTranscription: (data) => ipcRenderer.invoke("proxy-mistral-transcription", data),

  // Custom endpoint API keys
  getCustomTranscriptionKey: () => ipcRenderer.invoke("get-custom-transcription-key"),
  saveCustomTranscriptionKey: (key) => ipcRenderer.invoke("save-custom-transcription-key", key),
  getCustomReasoningKey: () => ipcRenderer.invoke("get-custom-reasoning-key"),
  saveCustomReasoningKey: (key) => ipcRenderer.invoke("save-custom-reasoning-key", key),

  // Dictation key persistence (file-based for reliable startup)
  getDictationKey: () => ipcRenderer.invoke("get-dictation-key"),
  saveDictationKey: (key) => ipcRenderer.invoke("save-dictation-key", key),

  // Activation mode persistence (file-based for reliable startup)
  getActivationMode: () => ipcRenderer.invoke("get-activation-mode"),
  saveActivationMode: (mode) => ipcRenderer.invoke("save-activation-mode", mode),

  saveAllKeysToEnv: () => ipcRenderer.invoke("save-all-keys-to-env"),
  syncStartupPreferences: (prefs) => ipcRenderer.invoke("sync-startup-preferences", prefs),

  // Local reasoning
  processLocalReasoning: (text, modelId, agentName, config) =>
    ipcRenderer.invoke("process-local-reasoning", text, modelId, agentName, config),
  checkLocalReasoningAvailable: () => ipcRenderer.invoke("check-local-reasoning-available"),

  // Anthropic reasoning
  processAnthropicReasoning: (text, modelId, agentName, config) =>
    ipcRenderer.invoke("process-anthropic-reasoning", text, modelId, agentName, config),

  // llama.cpp
  llamaCppCheck: () => ipcRenderer.invoke("llama-cpp-check"),
  llamaCppInstall: () => ipcRenderer.invoke("llama-cpp-install"),
  llamaCppUninstall: () => ipcRenderer.invoke("llama-cpp-uninstall"),

  // llama-server
  llamaServerStart: (modelId) => ipcRenderer.invoke("llama-server-start", modelId),
  llamaServerStop: () => ipcRenderer.invoke("llama-server-stop"),
  llamaServerStatus: () => ipcRenderer.invoke("llama-server-status"),
  llamaGpuReset: () => ipcRenderer.invoke("llama-gpu-reset"),

  // Vulkan GPU acceleration
  detectVulkanGpu: () => ipcRenderer.invoke("detect-vulkan-gpu"),
  getLlamaVulkanStatus: () => ipcRenderer.invoke("get-llama-vulkan-status"),
  downloadLlamaVulkanBinary: () => ipcRenderer.invoke("download-llama-vulkan-binary"),
  cancelLlamaVulkanDownload: () => ipcRenderer.invoke("cancel-llama-vulkan-download"),
  deleteLlamaVulkanBinary: () => ipcRenderer.invoke("delete-llama-vulkan-binary"),
  onLlamaVulkanDownloadProgress: registerListener(
    "llama-vulkan-download-progress",
    (callback) => (_event, data) => callback(data)
  ),

  getLogLevel: () => ipcRenderer.invoke("get-log-level"),
  log: (entry) => ipcRenderer.invoke("app-log", entry),

  // ydotool status check
  getYdotoolStatus: () => ipcRenderer.invoke("get-ydotool-status"),

  // Debug logging management
  getDebugState: () => ipcRenderer.invoke("get-debug-state"),
  setDebugLogging: (enabled) => ipcRenderer.invoke("set-debug-logging", enabled),
  openLogsFolder: () => ipcRenderer.invoke("open-logs-folder"),

  // System settings helpers for microphone/audio permissions
  requestMicrophoneAccess: () => ipcRenderer.invoke("request-microphone-access"),
  checkMicrophoneAccess: () => ipcRenderer.invoke("check-microphone-access"),
  checkSystemAudioAccess: () => ipcRenderer.invoke("check-system-audio-access"),
  requestSystemAudioAccess: () => ipcRenderer.invoke("request-system-audio-access"),
  openMicrophoneSettings: () => ipcRenderer.invoke("open-microphone-settings"),
  openSoundInputSettings: () => ipcRenderer.invoke("open-sound-input-settings"),
  openAccessibilitySettings: () => ipcRenderer.invoke("open-accessibility-settings"),
  openSystemAudioSettings: () => ipcRenderer.invoke("open-system-audio-settings"),
  toggleMediaPlayback: () => ipcRenderer.invoke("toggle-media-playback"),
  pauseMediaPlayback: () => ipcRenderer.invoke("pause-media-playback"),
  resumeMediaPlayback: () => ipcRenderer.invoke("resume-media-playback"),
  openWhisperModelsFolder: () => ipcRenderer.invoke("open-whisper-models-folder"),
  authClearSession: () => ipcRenderer.invoke("auth-clear-session"),

  // OpenWhispr Cloud API
  cloudTranscribe: (audioBuffer, opts) => ipcRenderer.invoke("cloud-transcribe", audioBuffer, opts),
  cloudReason: (text, opts) => ipcRenderer.invoke("cloud-reason", text, opts),
  cloudStreamingUsage: (text, audioDurationSeconds, opts) =>
    ipcRenderer.invoke("cloud-streaming-usage", text, audioDurationSeconds, opts),
  cloudUsage: () => ipcRenderer.invoke("cloud-usage"),
  cloudCheckout: (opts) => ipcRenderer.invoke("cloud-checkout", opts),
  cloudBillingPortal: () => ipcRenderer.invoke("cloud-billing-portal"),
  cloudSwitchPlan: (opts) => ipcRenderer.invoke("cloud-switch-plan", opts),
  cloudPreviewSwitch: (opts) => ipcRenderer.invoke("cloud-preview-switch", opts),
  getSttConfig: () => ipcRenderer.invoke("get-stt-config"),

  // Cloud audio file transcription
  transcribeAudioFileCloud: (filePath) =>
    ipcRenderer.invoke("transcribe-audio-file-cloud", filePath),
  transcribeAudioFileByok: (options) => ipcRenderer.invoke("transcribe-audio-file-byok", options),
  onUploadTranscriptionProgress: registerListener(
    "upload-transcription-progress",
    (callback) => (_event, data) => callback(data)
  ),

  // Referral stats
  getReferralStats: () => ipcRenderer.invoke("get-referral-stats"),
  sendReferralInvite: (email) => ipcRenderer.invoke("send-referral-invite", email),
  getReferralInvites: () => ipcRenderer.invoke("get-referral-invites"),

  // Assembly AI Streaming
  assemblyAiStreamingWarmup: (options) =>
    ipcRenderer.invoke("assemblyai-streaming-warmup", options),
  assemblyAiStreamingStart: (options) => ipcRenderer.invoke("assemblyai-streaming-start", options),
  assemblyAiStreamingSend: (audioBuffer) =>
    ipcRenderer.send("assemblyai-streaming-send", audioBuffer),
  assemblyAiStreamingForceEndpoint: () => ipcRenderer.send("assemblyai-streaming-force-endpoint"),
  assemblyAiStreamingStop: () => ipcRenderer.invoke("assemblyai-streaming-stop"),
  assemblyAiStreamingStatus: () => ipcRenderer.invoke("assemblyai-streaming-status"),
  onAssemblyAiPartialTranscript: registerListener(
    "assemblyai-partial-transcript",
    (callback) => (_event, text) => callback(text)
  ),
  onAssemblyAiFinalTranscript: registerListener(
    "assemblyai-final-transcript",
    (callback) => (_event, text) => callback(text)
  ),
  onAssemblyAiError: registerListener(
    "assemblyai-error",
    (callback) => (_event, error) => callback(error)
  ),
  onAssemblyAiSessionEnd: registerListener(
    "assemblyai-session-end",
    (callback) => (_event, data) => callback(data)
  ),

  // Deepgram Streaming
  deepgramStreamingWarmup: (options) => ipcRenderer.invoke("deepgram-streaming-warmup", options),
  deepgramStreamingStart: (options) => ipcRenderer.invoke("deepgram-streaming-start", options),
  deepgramStreamingSend: (audioBuffer) => ipcRenderer.send("deepgram-streaming-send", audioBuffer),
  deepgramStreamingFinalize: () => ipcRenderer.send("deepgram-streaming-finalize"),
  deepgramStreamingStop: () => ipcRenderer.invoke("deepgram-streaming-stop"),
  deepgramStreamingStatus: () => ipcRenderer.invoke("deepgram-streaming-status"),
  onDeepgramPartialTranscript: registerListener(
    "deepgram-partial-transcript",
    (callback) => (_event, text) => callback(text)
  ),
  onDeepgramFinalTranscript: registerListener(
    "deepgram-final-transcript",
    (callback) => (_event, text) => callback(text)
  ),
  onDeepgramError: registerListener(
    "deepgram-error",
    (callback) => (_event, error) => callback(error)
  ),
  onDeepgramSessionEnd: registerListener(
    "deepgram-session-end",
    (callback) => (_event, data) => callback(data)
  ),

  // Meeting chain transcription (BaseTen)
  meetingTranscribeChain: (blobUrl, opts) =>
    ipcRenderer.invoke("meeting-transcribe-chain", blobUrl, opts),

  // Meeting transcription (streaming, dual-channel)
  meetingTranscriptionPrepare: (options) =>
    ipcRenderer.invoke("meeting-transcription-prepare", options),
  meetingTranscriptionStart: (options) =>
    ipcRenderer.invoke("meeting-transcription-start", options),
  meetingTranscriptionSend: (buffer, source) =>
    ipcRenderer.send("meeting-transcription-send", buffer, source),
  meetingTranscriptionStop: () => ipcRenderer.invoke("meeting-transcription-stop"),
  meetingAudioCleanup: (dir) => ipcRenderer.invoke("meeting-audio-cleanup", dir),
  meetingCheckpointStart: (noteId) => ipcRenderer.invoke("meeting-checkpoint-start", noteId),
  onMeetingTranscriptionSegment: registerListener(
    "meeting-transcription-segment",
    (callback) => (_event, data) => callback(data)
  ),
  onMeetingTranscriptionError: registerListener(
    "meeting-transcription-error",
    (callback) => (_event, data) => callback(data)
  ),

  // Dictation realtime streaming
  dictationRealtimeWarmup: (options) => ipcRenderer.invoke("dictation-realtime-warmup", options),
  dictationRealtimeStart: (options) => ipcRenderer.invoke("dictation-realtime-start", options),
  dictationRealtimeSend: (buffer) => ipcRenderer.send("dictation-realtime-send", buffer),
  dictationRealtimeStop: () => ipcRenderer.invoke("dictation-realtime-stop"),
  onDictationRealtimePartial: registerListener(
    "dictation-realtime-partial",
    (callback) => (_event, data) => callback(data)
  ),
  onDictationRealtimeFinal: registerListener(
    "dictation-realtime-final",
    (callback) => (_event, data) => callback(data)
  ),
  onDictationRealtimeError: registerListener(
    "dictation-realtime-error",
    (callback) => (_event, data) => callback(data)
  ),
  onDictationRealtimeSessionEnd: registerListener(
    "dictation-realtime-session-end",
    (callback) => (_event, data) => callback(data)
  ),

  // Usage limit events (for showing UpgradePrompt in ControlPanel)
  notifyLimitReached: (data) => ipcRenderer.send("limit-reached", data),
  onLimitReached: registerListener("limit-reached", (callback) => (_event, data) => callback(data)),

  // Globe key listener for hotkey capture (macOS only)
  onGlobeKeyPressed: (callback) => {
    const listener = () => callback?.();
    ipcRenderer.on("globe-key-pressed", listener);
    return () => ipcRenderer.removeListener("globe-key-pressed", listener);
  },
  onGlobeKeyReleased: (callback) => {
    const listener = () => callback?.();
    ipcRenderer.on("globe-key-released", listener);
    return () => ipcRenderer.removeListener("globe-key-released", listener);
  },

  // Hotkey registration events (for notifying user when hotkey fails)
  onHotkeyFallbackUsed: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("hotkey-fallback-used", listener);
    return () => ipcRenderer.removeListener("hotkey-fallback-used", listener);
  },
  onHotkeyRegistrationFailed: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("hotkey-registration-failed", listener);
    return () => ipcRenderer.removeListener("hotkey-registration-failed", listener);
  },
  onSettingUpdated: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("setting-updated", listener);
    return () => ipcRenderer.removeListener("setting-updated", listener);
  },
  onWindowsPushToTalkUnavailable: registerListener("windows-ptt-unavailable"),

  // Accessibility permission events (macOS)
  onAccessibilityMissing: (callback) => {
    const listener = () => callback?.();
    ipcRenderer.on("accessibility-missing", listener);
    return () => ipcRenderer.removeListener("accessibility-missing", listener);
  },
  checkAccessibilityTrusted: () => ipcRenderer.invoke("check-accessibility-trusted"),

  // Notify main process of activation mode changes (for Windows Push-to-Talk)
  notifyActivationModeChanged: (mode) => ipcRenderer.send("activation-mode-changed", mode),
  notifyHotkeyChanged: (hotkey) => ipcRenderer.send("hotkey-changed", hotkey),
  registerMeetingHotkey: (hotkey) => ipcRenderer.invoke("register-meeting-hotkey", hotkey),

  // Floating icon auto-hide
  notifyFloatingIconAutoHideChanged: (enabled) =>
    ipcRenderer.send("floating-icon-auto-hide-changed", enabled),
  onFloatingIconAutoHideChanged: registerListener(
    "floating-icon-auto-hide-changed",
    (callback) => (_event, enabled) => callback(enabled)
  ),

  // Panel start position
  notifyPanelStartPositionChanged: (position) =>
    ipcRenderer.send("panel-start-position-changed", position),

  // Start minimized
  notifyStartMinimizedChanged: (enabled) => ipcRenderer.send("start-minimized-changed", enabled),

  // Auto-start management
  getAutoStartEnabled: () => ipcRenderer.invoke("get-auto-start-enabled"),
  setAutoStartEnabled: (enabled) => ipcRenderer.invoke("set-auto-start-enabled", enabled),

  // Agent mode
  updateAgentHotkey: (hotkey) => ipcRenderer.invoke("update-agent-hotkey", hotkey),
  getAgentKey: () => ipcRenderer.invoke("get-agent-key"),
  saveAgentKey: (key) => ipcRenderer.invoke("save-agent-key", key),
  onAgentStartRecording: registerListener("agent-start-recording", (callback) => () => callback()),
  onAgentStopRecording: registerListener("agent-stop-recording", (callback) => () => callback()),
  onAgentToggleRecording: registerListener(
    "agent-toggle-recording",
    (callback) => () => callback()
  ),
  toggleAgentOverlay: () => ipcRenderer.invoke("toggle-agent-overlay"),
  hideAgentOverlay: () => ipcRenderer.invoke("hide-agent-overlay"),
  resizeAgentWindow: (width, height) => ipcRenderer.invoke("resize-agent-window", width, height),
  getAgentWindowBounds: () => ipcRenderer.invoke("get-agent-window-bounds"),
  setAgentWindowBounds: (x, y, width, height) =>
    ipcRenderer.invoke("set-agent-window-bounds", x, y, width, height),
  acquireRecordingLock: (pipeline) => ipcRenderer.invoke("acquire-recording-lock", pipeline),
  releaseRecordingLock: (pipeline) => ipcRenderer.invoke("release-recording-lock", pipeline),

  // Agent cloud streaming
  cloudAgentStream: (messages, opts) => ipcRenderer.invoke("cloud-agent-stream", messages, opts),
  onAgentStreamChunk: registerListener(
    "agent-stream-chunk",
    (callback) => (_event, chunk) => callback(chunk)
  ),
  onAgentStreamDone: registerListener("agent-stream-done", (callback) => () => callback()),

  // Agent conversation persistence
  createAgentConversation: (title) => ipcRenderer.invoke("db-create-agent-conversation", title),
  getAgentConversations: (limit) => ipcRenderer.invoke("db-get-agent-conversations", limit),
  getAgentConversation: (id) => ipcRenderer.invoke("db-get-agent-conversation", id),
  deleteAgentConversation: (id) => ipcRenderer.invoke("db-delete-agent-conversation", id),
  updateAgentConversationTitle: (id, title) =>
    ipcRenderer.invoke("db-update-agent-conversation-title", id, title),
  addAgentMessage: (conversationId, role, content) =>
    ipcRenderer.invoke("db-add-agent-message", conversationId, role, content),
  getAgentMessages: (conversationId) => ipcRenderer.invoke("db-get-agent-messages", conversationId),

  // Google Calendar
  gcalStartOAuth: () => ipcRenderer.invoke("gcal-start-oauth"),
  gcalDisconnect: () => ipcRenderer.invoke("gcal-disconnect"),
  gcalGetConnectionStatus: () => ipcRenderer.invoke("gcal-get-connection-status"),
  gcalGetCalendars: () => ipcRenderer.invoke("gcal-get-calendars"),
  gcalSetCalendarSelection: (calendarId, isSelected) =>
    ipcRenderer.invoke("gcal-set-calendar-selection", calendarId, isSelected),
  gcalSyncEvents: () => ipcRenderer.invoke("gcal-sync-events"),
  gcalGetUpcomingEvents: (windowMinutes) =>
    ipcRenderer.invoke("gcal-get-upcoming-events", windowMinutes),

  // Google Calendar event listeners
  onGcalMeetingStarting: registerListener(
    "gcal-meeting-starting",
    (callback) => (_event, data) => callback(data)
  ),
  onGcalMeetingEnded: registerListener(
    "gcal-meeting-ended",
    (callback) => (_event, data) => callback(data)
  ),
  onGcalStartRecording: registerListener(
    "gcal-start-recording",
    (callback) => (_event, data) => callback(data)
  ),
  onGcalConnectionChanged: registerListener(
    "gcal-connection-changed",
    (callback) => (_event, data) => callback(data)
  ),
  onGcalEventsSynced: registerListener(
    "gcal-events-synced",
    (callback) => (_event, data) => callback(data)
  ),

  // Meeting detection
  meetingDetectionGetPreferences: () => ipcRenderer.invoke("meeting-detection-get-preferences"),
  meetingDetectionSetPreferences: (prefs) =>
    ipcRenderer.invoke("meeting-detection-set-preferences", prefs),
  meetingDetectionRespond: (detectionId, action) =>
    ipcRenderer.invoke("meeting-detection-respond", detectionId, action),
  onMeetingDetected: registerListener(
    "meeting-detected",
    (callback) => (_event, data) => callback(data)
  ),
  onMeetingDetectedStartRecording: registerListener(
    "meeting-detected-start-recording",
    (callback) => (_event, data) => callback(data)
  ),
  onMeetingNotificationData: registerListener(
    "meeting-notification-data",
    (callback) => (_event, data) => callback(data)
  ),
  getMeetingNotificationData: () => ipcRenderer.invoke("get-meeting-notification-data"),
  meetingNotificationReady: () => ipcRenderer.invoke("meeting-notification-ready"),
  meetingNotificationRespond: (detectionId, action) =>
    ipcRenderer.invoke("meeting-notification-respond", detectionId, action),
  onNavigateToMeetingNote: registerListener(
    "navigate-to-meeting-note",
    (callback) => (_event, data) => callback(data)
  ),

  onMeetingState: registerListener(
    "meeting-state",
    (callback) => (_event, data) => callback(data)
  ),

  onUpdateNotificationData: registerListener(
    "update-notification-data",
    (callback) => (_event, data) => callback(data)
  ),
  getUpdateNotificationData: () => ipcRenderer.invoke("get-update-notification-data"),
  updateNotificationReady: () => ipcRenderer.invoke("update-notification-ready"),
  updateNotificationRespond: (action) => ipcRenderer.invoke("update-notification-respond", action),

  whisperwoofSaveEntry: (entry) => ipcRenderer.invoke("whisperwoof-save-entry", entry),

  // WhisperWoof: Adaptive style learning
  whisperwoofGetStyleStats: () => ipcRenderer.invoke("whisperwoof-get-style-stats"),
  whisperwoofClearStyleExamples: () => ipcRenderer.invoke("whisperwoof-clear-style-examples"),
  whisperwoofGetStyleExamples: () => ipcRenderer.invoke("whisperwoof-get-style-examples"),

  // WhisperWoof: Backtrack correction

  // WhisperWoof: Voice Activity Detection
  whisperwoofGetVadConfig: () => ipcRenderer.invoke("whisperwoof-get-vad-config"),

  // WhisperWoof: Usage analytics
  whisperwoofGetAnalytics: (options) => ipcRenderer.invoke("whisperwoof-get-analytics", options),

  // WhisperWoof: App automation
  whisperwoofDetectAutomation: (text) => ipcRenderer.invoke("whisperwoof-detect-automation", text),
  whisperwoofExecuteAutomation: (commandId, appName) => ipcRenderer.invoke("whisperwoof-execute-automation", commandId, appName),
  whisperwoofGetAutomationCommands: () => ipcRenderer.invoke("whisperwoof-get-automation-commands"),

  // WhisperWoof: Conversation memory

  // WhisperWoof: Agentic actions
  whisperwoofDetectAction: (text) => ipcRenderer.invoke("whisperwoof-detect-action", text),
  whisperwoofPrepareAction: (text, options) => ipcRenderer.invoke("whisperwoof-prepare-action", text, options),
  whisperwoofGetAvailableActions: () => ipcRenderer.invoke("whisperwoof-get-available-actions"),

  // WhisperWoof: Screen context

  // WhisperWoof: Entry chaining
  whisperwoofLinkEntries: (childId, parentId) => ipcRenderer.invoke("whisperwoof-link-entries", childId, parentId),
  whisperwoofUnlinkEntry: (childId) => ipcRenderer.invoke("whisperwoof-unlink-entry", childId),
  whisperwoofGetChain: (entryId) => ipcRenderer.invoke("whisperwoof-get-chain", entryId),
  whisperwoofGetChainStats: () => ipcRenderer.invoke("whisperwoof-get-chain-stats"),

  // WhisperWoof: Recurring capture
  whisperwoofGetSchedules: () => ipcRenderer.invoke("whisperwoof-get-schedules"),
  whisperwoofAddSchedule: (config) => ipcRenderer.invoke("whisperwoof-add-schedule", config),
  whisperwoofUpdateSchedule: (id, updates) => ipcRenderer.invoke("whisperwoof-update-schedule", id, updates),
  whisperwoofRemoveSchedule: (id) => ipcRenderer.invoke("whisperwoof-remove-schedule", id),
  whisperwoofGetSchedulePresets: () => ipcRenderer.invoke("whisperwoof-get-schedule-presets"),

  // WhisperWoof: Smart reply

  // WhisperWoof: Entry templates
  whisperwoofGetTemplates: () => ipcRenderer.invoke("whisperwoof-get-templates"),
  whisperwoofCreateTemplate: (config) => ipcRenderer.invoke("whisperwoof-create-template", config),
  whisperwoofDeleteTemplate: (id) => ipcRenderer.invoke("whisperwoof-delete-template", id),
  whisperwoofRenderTemplate: (templateId, values) => ipcRenderer.invoke("whisperwoof-render-template", templateId, values),
  whisperwoofGetNextSection: (templateId, filledSections) => ipcRenderer.invoke("whisperwoof-get-next-section", templateId, filledSections),

  // WhisperWoof: Semantic search

  // WhisperWoof: Auto-tagging

  // WhisperWoof: Webhooks
  whisperwoofGetWebhooks: () => ipcRenderer.invoke("whisperwoof-get-webhooks"),
  whisperwoofAddWebhook: (config) => ipcRenderer.invoke("whisperwoof-add-webhook", config),
  whisperwoofUpdateWebhook: (id, updates) => ipcRenderer.invoke("whisperwoof-update-webhook", id, updates),
  whisperwoofRemoveWebhook: (id) => ipcRenderer.invoke("whisperwoof-remove-webhook", id),
  whisperwoofTestWebhook: (id) => ipcRenderer.invoke("whisperwoof-test-webhook", id),
  whisperwoofGetDeliveryLog: (limit) => ipcRenderer.invoke("whisperwoof-get-delivery-log", limit),

  // WhisperWoof: Daily digest

  // WhisperWoof: Keybinding customization
  whisperwoofGetKeybindings: () => ipcRenderer.invoke("whisperwoof-get-keybindings"),
  whisperwoofRebindAction: (actionId, newKey) => ipcRenderer.invoke("whisperwoof-rebind-action", actionId, newKey),
  whisperwoofResetKeybinding: (actionId) => ipcRenderer.invoke("whisperwoof-reset-keybinding", actionId),
  whisperwoofResetAllKeybindings: () => ipcRenderer.invoke("whisperwoof-reset-all-keybindings"),
  whisperwoofExportKeybindings: () => ipcRenderer.invoke("whisperwoof-export-keybindings"),
  whisperwoofImportKeybindings: (data) => ipcRenderer.invoke("whisperwoof-import-keybindings", data),
  whisperwoofGetKeybindingCategories: () => ipcRenderer.invoke("whisperwoof-get-keybinding-categories"),

  // WhisperWoof: Privacy lock
  whisperwoofPrivacyEnable: (options) => ipcRenderer.invoke("whisperwoof-privacy-enable", options),
  whisperwoofPrivacyDisable: () => ipcRenderer.invoke("whisperwoof-privacy-disable"),
  whisperwoofPrivacyState: () => ipcRenderer.invoke("whisperwoof-privacy-state"),
  whisperwoofPrivacyCheckUrl: (url) => ipcRenderer.invoke("whisperwoof-privacy-check-url", url),
  whisperwoofPrivacyCheckProvider: (providerId) => ipcRenderer.invoke("whisperwoof-privacy-check-provider", providerId),
  whisperwoofPrivacyOverrides: () => ipcRenderer.invoke("whisperwoof-privacy-overrides"),
  whisperwoofPrivacySettings: (updates) => ipcRenderer.invoke("whisperwoof-privacy-settings", updates),

  // WhisperWoof: Entry tagging
  whisperwoofGetTags: () => ipcRenderer.invoke("whisperwoof-get-tags"),
  whisperwoofCreateTag: (name, color) => ipcRenderer.invoke("whisperwoof-create-tag", name, color),
  whisperwoofUpdateTag: (id, updates) => ipcRenderer.invoke("whisperwoof-update-tag", id, updates),
  whisperwoofDeleteTag: (id) => ipcRenderer.invoke("whisperwoof-delete-tag", id),
  whisperwoofAddTagToEntry: (entryId, tagId) => ipcRenderer.invoke("whisperwoof-add-tag-to-entry", entryId, tagId),
  whisperwoofRemoveTagFromEntry: (entryId, tagId) => ipcRenderer.invoke("whisperwoof-remove-tag-from-entry", entryId, tagId),
  whisperwoofGetEntryTags: (entryId) => ipcRenderer.invoke("whisperwoof-get-entry-tags", entryId),
  whisperwoofGetEntriesByTag: (tagId, limit) => ipcRenderer.invoke("whisperwoof-get-entries-by-tag", tagId, limit),
  whisperwoofBulkTagEntries: (entryIds, tagId) => ipcRenderer.invoke("whisperwoof-bulk-tag-entries", entryIds, tagId),
  whisperwoofGetTagStats: () => ipcRenderer.invoke("whisperwoof-get-tag-stats"),

  // WhisperWoof: Focus mode
  whisperwoofFocusStart: (options) => ipcRenderer.invoke("whisperwoof-focus-start", options),
  whisperwoofFocusEnd: (summary) => ipcRenderer.invoke("whisperwoof-focus-end", summary),
  whisperwoofFocusActive: () => ipcRenderer.invoke("whisperwoof-focus-active"),
  whisperwoofFocusRecordEntry: (entryId, wordCount) => ipcRenderer.invoke("whisperwoof-focus-record-entry", entryId, wordCount),
  whisperwoofFocusStats: () => ipcRenderer.invoke("whisperwoof-focus-stats"),
  whisperwoofFocusHistory: (options) => ipcRenderer.invoke("whisperwoof-focus-history", options),
  whisperwoofFocusPresets: () => ipcRenderer.invoke("whisperwoof-focus-presets"),

  // WhisperWoof: Streaming transcription
  whisperwoofStreamingFormat: (text, maxChars) => ipcRenderer.invoke("whisperwoof-streaming-format", text, maxChars),
  whisperwoofStreamingDiff: (oldText, newText) => ipcRenderer.invoke("whisperwoof-streaming-diff", oldText, newText),

  // WhisperWoof: Intent capture

  // WhisperWoof: Vibe coding
  whisperwoofGetCodingPrompt: (bundleId, spokenText) => ipcRenderer.invoke("whisperwoof-get-coding-prompt", bundleId, spokenText),

  // WhisperWoof: Language detection
  whisperwoofDetectLanguage: (text) => ipcRenderer.invoke("whisperwoof-detect-language", text),
  whisperwoofGetSupportedLanguages: () => ipcRenderer.invoke("whisperwoof-get-supported-languages"),

  // WhisperWoof: Settings export/import
  whisperwoofExportSettings: (options) => ipcRenderer.invoke("whisperwoof-export-settings", options),
  whisperwoofImportSettings: (bundle, options) => ipcRenderer.invoke("whisperwoof-import-settings", bundle, options),
  whisperwoofSaveExportFile: (filePath, bundle) => ipcRenderer.invoke("whisperwoof-save-export-file", filePath, bundle),
  whisperwoofLoadImportFile: (filePath) => ipcRenderer.invoke("whisperwoof-load-import-file", filePath),

  // WhisperWoof: Custom vocabulary
  whisperwoofGetVocabulary: (options) => ipcRenderer.invoke("whisperwoof-get-vocabulary", options),
  whisperwoofAddWord: (word, options) => ipcRenderer.invoke("whisperwoof-add-word", word, options),
  whisperwoofUpdateWord: (id, updates) => ipcRenderer.invoke("whisperwoof-update-word", id, updates),
  whisperwoofRemoveWord: (id) => ipcRenderer.invoke("whisperwoof-remove-word", id),
  whisperwoofImportWords: (words, category) => ipcRenderer.invoke("whisperwoof-import-words", words, category),
  whisperwoofGetVocabularyStats: () => ipcRenderer.invoke("whisperwoof-get-vocabulary-stats"),
  whisperwoofGetSttHints: (bundleId) => ipcRenderer.invoke("whisperwoof-get-stt-hints", bundleId),
  whisperwoofGetVocabularyForApp: (bundleId) => ipcRenderer.invoke("whisperwoof-get-vocabulary-for-app", bundleId),
  whisperwoofGetTrackedApps: () => ipcRenderer.invoke("whisperwoof-get-tracked-apps"),

  // WhisperWoof: Vocabulary packs
  whisperwoofGetAvailablePacks: () => ipcRenderer.invoke("whisperwoof-get-available-packs"),
  whisperwoofGetPackDetails: (packId) => ipcRenderer.invoke("whisperwoof-get-pack-details", packId),
  whisperwoofEnablePack: (packId) => ipcRenderer.invoke("whisperwoof-enable-pack", packId),
  whisperwoofDisablePack: (packId) => ipcRenderer.invoke("whisperwoof-disable-pack", packId),
  whisperwoofTogglePackEntry: (packId, word) => ipcRenderer.invoke("whisperwoof-toggle-pack-entry", packId, word),
  whisperwoofGetEnabledPackIds: () => ipcRenderer.invoke("whisperwoof-get-enabled-pack-ids"),
  whisperwoofGetPackEnhancedPrompt: (bundleId) => ipcRenderer.invoke("whisperwoof-get-pack-enhanced-prompt", bundleId),

  // WhisperWoof: Telegram companion
  whisperwoofTelegramSyncStatus: () => ipcRenderer.invoke("whisperwoof-telegram-sync-status"),
  whisperwoofTelegramImportNow: () => ipcRenderer.invoke("whisperwoof-telegram-import-now"),

  // WhisperWoof: Markdown notes (Fn+N)
  whisperwoofSaveMarkdown: (text) => ipcRenderer.invoke("whisperwoof-save-markdown", text),
  whisperwoofGetNotesDir: () => ipcRenderer.invoke("whisperwoof-get-notes-dir"),
  whisperwoofSetNotesDir: (dir) => ipcRenderer.invoke("whisperwoof-set-notes-dir", dir),
  whisperwoofPickNotesDir: () => ipcRenderer.invoke("whisperwoof-pick-notes-dir"),

  // WhisperWoof: History entries (voice + clipboard unified view)
  whisperwoofGetEntries: (limit, offset) => ipcRenderer.invoke("whisperwoof-get-entries", limit, offset),
  whisperwoofGetEntriesBySource: (source, limit, offset) =>
    ipcRenderer.invoke("whisperwoof-get-entries-by-source", source, limit, offset),
  whisperwoofSearchEntries: (query, limit) => ipcRenderer.invoke("whisperwoof-search-entries", query, limit),
  whisperwoofDeleteEntry: (id) => ipcRenderer.invoke("whisperwoof-delete-entry", id),
  whisperwoofToggleFavorite: (id) => ipcRenderer.invoke("whisperwoof-toggle-favorite", id),
  whisperwoofGetFavorites: (limit) => ipcRenderer.invoke("whisperwoof-get-favorites", limit),
  whisperwoofGetImage: (imagePath) => ipcRenderer.invoke("whisperwoof-get-image", imagePath),
  whisperwoofClipboardToggle: (enabled) => ipcRenderer.invoke("whisperwoof-clipboard-toggle", enabled),

  // WhisperWoof: Projects — named buckets for voice capture routing
  whisperwoofCreateProject: (name) => ipcRenderer.invoke("whisperwoof-create-project", name),
  whisperwoofGetProjects: () => ipcRenderer.invoke("whisperwoof-get-projects"),
  whisperwoofDeleteProject: (id) => ipcRenderer.invoke("whisperwoof-delete-project", id),
  whisperwoofGetProjectEntries: (projectId, limit) => ipcRenderer.invoke("whisperwoof-get-project-entries", projectId, limit),

  // WhisperWoof: Model advisor — recommend model based on system memory
  whisperwoofGetModelRecommendation: () => ipcRenderer.invoke("whisperwoof-get-model-recommendation"),
  whisperwoofGetModelFailureAdvice: (model, stderr) => ipcRenderer.invoke("whisperwoof-get-model-failure-advice", model, stderr),

  // WhisperWoof: File import — upload audio files for transcription
  whisperwoofImportAudio: (filePath) => ipcRenderer.invoke("whisperwoof-import-audio", filePath),
  whisperwoofImportSupportedExtensions: () => ipcRenderer.invoke("whisperwoof-import-supported-extensions"),

  // WhisperWoof: Meeting transcription — bridge to bf_entries with source='meeting'
  whisperwoofMeetingStart: (options) => ipcRenderer.invoke("whisperwoof-meeting-start", options),
  whisperwoofMeetingSegment: (text) => ipcRenderer.invoke("whisperwoof-meeting-segment", text),
  whisperwoofMeetingEnd: () => ipcRenderer.invoke("whisperwoof-meeting-end"),
  whisperwoofMeetingStatus: () => ipcRenderer.invoke("whisperwoof-meeting-status"),

  // WhisperWoof: Voice editing commands

  // WhisperWoof: Context-aware polish
  whisperwoofDetectContext: () => ipcRenderer.invoke("whisperwoof-detect-context"),
  whisperwoofGetAppPresetMap: () => ipcRenderer.invoke("whisperwoof-get-app-preset-map"),
  whisperwoofSetAppPreset: (bundleId, presetId) => ipcRenderer.invoke("whisperwoof-set-app-preset", bundleId, presetId),

  // WhisperWoof: Plugin management (MCP server plugins)
  whisperwoofGetPlugins: () => ipcRenderer.invoke("whisperwoof-get-plugins"),
  whisperwoofUpdatePlugin: (id, updates) => ipcRenderer.invoke("whisperwoof-update-plugin", id, updates),
  whisperwoofAddPlugin: (config) => ipcRenderer.invoke("whisperwoof-add-plugin", config),
  whisperwoofRemovePlugin: (id) => ipcRenderer.invoke("whisperwoof-remove-plugin", id),

  // WhisperWoof: Project → MCP plugin dispatch
  whisperwoofUpdateProjectIntegration: (projectId, pluginId) => ipcRenderer.invoke("whisperwoof-update-project-integration", projectId, pluginId),
  whisperwoofGetProjectIntegrations: () => ipcRenderer.invoke("whisperwoof-get-project-integrations"),
  whisperwoofDispatchEntry: (entryId, pluginId, text) => ipcRenderer.invoke("whisperwoof-dispatch-entry", entryId, pluginId, text),

  // Storage Manager
  whisperwoofStorageUsage: () => ipcRenderer.invoke("whisperwoof-storage-usage"),
  whisperwoofStorageEntries: (options) => ipcRenderer.invoke("whisperwoof-storage-entries", options),
  whisperwoofStorageDeleteBatch: (ids) => ipcRenderer.invoke("whisperwoof-storage-delete-batch", ids),
  whisperwoofStorageDeleteBySource: (source) => ipcRenderer.invoke("whisperwoof-storage-delete-by-source", source),
  whisperwoofStorageDeleteOlder: (days) => ipcRenderer.invoke("whisperwoof-storage-delete-older", days),
  whisperwoofStorageExport: (ids) => ipcRenderer.invoke("whisperwoof-storage-export", ids),
  whisperwoofStorageCleanupOrphans: () => ipcRenderer.invoke("whisperwoof-storage-cleanup-orphans"),

  // Eval Dataset
  whisperwoofRateTranscription: (params) => ipcRenderer.invoke("whisperwoof-rate-transcription", params),
  whisperwoofGetEvalEntries: (filter) => ipcRenderer.invoke("whisperwoof-get-eval-entries", filter),
  whisperwoofGetEvalStats: () => ipcRenderer.invoke("whisperwoof-get-eval-stats"),
  whisperwoofDeleteEvalEntry: (id) => ipcRenderer.invoke("whisperwoof-delete-eval-entry", id),

  // STT Model Comparison
  whisperwoofTranscribeWithModel: (audioBlob, model) => ipcRenderer.invoke("whisperwoof-transcribe-with-model", audioBlob, model),
});
