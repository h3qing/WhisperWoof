export type LocalTranscriptionProvider = "whisper" | "nvidia";

export type TranscriptionStatus = "completed" | "failed" | "pending";

export interface TranscriptionItem {
  id: number;
  text: string;
  raw_text: string | null;
  timestamp: string;
  created_at: string;
  has_audio: number;
  audio_duration_ms: number | null;
  provider: string | null;
  model: string | null;
  status: TranscriptionStatus;
  error_message: string | null;
}

export interface NoteItem {
  id: number;
  title: string;
  content: string;
  enhanced_content: string | null;
  enhancement_prompt: string | null;
  enhanced_at_content_hash: string | null;
  note_type: "personal" | "meeting" | "upload";
  source_file: string | null;
  audio_duration_seconds: number | null;
  folder_id: number | null;
  transcript: string | null;
  calendar_event_id: string | null;
  cloud_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderItem {
  id: number;
  name: string;
  is_default: number;
  sort_order: number;
  created_at: string;
}

export interface ActionItem {
  id: number;
  name: string;
  description: string;
  prompt: string;
  icon: string;
  is_builtin: number;
  sort_order: number;
  translation_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface GpuInfo {
  hasNvidiaGpu: boolean;
  gpuName?: string;
  driverVersion?: string;
  vramMb?: number;
}

export interface CudaWhisperStatus {
  downloaded: boolean;
  path: string | null;
  gpuInfo: GpuInfo;
}

export interface WhisperCheckResult {
  installed: boolean;
  working: boolean;
  error?: string;
}

export interface WhisperModelResult {
  success: boolean;
  model: string;
  downloaded: boolean;
  size_mb?: number;
  error?: string;
  code?: string;
}

export interface WhisperModelDeleteResult {
  success: boolean;
  model: string;
  deleted: boolean;
  freed_mb?: number;
  error?: string;
}

export interface WhisperModelsListResult {
  success: boolean;
  models: Array<{ model: string; downloaded: boolean; size_mb?: number }>;
  cache_dir: string;
}

export interface FFmpegAvailabilityResult {
  available: boolean;
  path?: string;
  error?: string;
}

export interface AudioDiagnosticsResult {
  platform: string;
  arch: string;
  resourcesPath: string | null;
  isPackaged: boolean;
  ffmpeg: { available: boolean; path: string | null; error: string | null };
  whisperBinary: { available: boolean; path: string | null; error: string | null };
  whisperServer: { available: boolean; path: string | null };
  modelsDir: string;
  models: string[];
}

export interface SystemAudioAccessResult {
  granted: boolean;
  status: "granted" | "denied" | "not-determined" | "restricted" | "unknown" | "unsupported";
  mode: "native" | "unsupported";
  error?: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  releaseDate?: string;
  files?: any[];
  releaseNotes?: string;
  message?: string;
}

export interface UpdateStatusResult {
  updateAvailable: boolean;
  updateDownloaded: boolean;
  isDevelopment: boolean;
}

export interface UpdateInfoResult {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | null;
  files?: any[];
}

export interface UpdateResult {
  success: boolean;
  message: string;
}

export interface AppVersionResult {
  version: string;
}

export interface WhisperDownloadProgressData {
  type: "progress" | "installing" | "complete" | "error";
  model: string;
  percentage?: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
  code?: string;
  result?: any;
}

export interface ParakeetCheckResult {
  installed: boolean;
  working: boolean;
  path?: string;
}

export interface ParakeetModelResult {
  success: boolean;
  model: string;
  downloaded: boolean;
  path?: string;
  size_bytes?: number;
  size_mb?: number;
  error?: string;
  code?: string;
}

export interface ParakeetModelDeleteResult {
  success: boolean;
  model: string;
  deleted: boolean;
  freed_bytes?: number;
  freed_mb?: number;
  error?: string;
}

export interface ParakeetModelsListResult {
  success: boolean;
  models: Array<{ model: string; downloaded: boolean; size_mb?: number }>;
  cache_dir: string;
}

export interface ParakeetDownloadProgressData {
  type: "progress" | "installing" | "complete" | "error";
  model: string;
  percentage?: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  error?: string;
  code?: string;
}

export interface ParakeetTranscriptionResult {
  success: boolean;
  text?: string;
  message?: string;
  error?: string;
}

export interface ParakeetDiagnosticsResult {
  platform: string;
  arch: string;
  resourcesPath: string | null;
  isPackaged: boolean;
  sherpaOnnx: { available: boolean; path: string | null };
  modelsDir: string;
  models: string[];
}

export interface PasteToolsResult {
  platform: "darwin" | "win32" | "linux";
  available: boolean;
  method: string | null;
  requiresPermission: boolean;
  isWayland?: boolean;
  xwaylandAvailable?: boolean;
  terminalAware?: boolean;
  hasNativeBinary?: boolean;
  hasUinput?: boolean;
  tools?: string[];
  recommendedInstall?: string;
}

export type GpuBackend = "vulkan" | "cpu" | "metal" | null;

export interface LlamaServerStatus {
  available: boolean;
  running: boolean;
  port: number | null;
  modelPath: string | null;
  modelName: string | null;
  backend: GpuBackend;
  gpuAccelerated: boolean;
}

export interface VulkanGpuResult {
  available: boolean;
  deviceName?: string;
  reason?: string;
  error?: string;
}

export interface LlamaVulkanStatus {
  supported: boolean;
  downloaded: boolean;
  downloading?: boolean;
  error?: string;
}

export interface LlamaVulkanDownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export interface ReferralItem {
  id: string;
  email: string;
  name: string | null;
  status: "pending" | "completed" | "rewarded";
  created_at: string;
  first_payment_at: string | null;
}

declare global {
  interface Window {
    electronAPI: {
      // Basic window operations
      pasteText: (text: string, options?: { fromStreaming?: boolean }) => Promise<void>;
      hideWindow: () => Promise<void>;
      showDictationPanel: () => Promise<void>;
      onToggleDictation: (callback: () => void) => () => void;
      onStartDictation?: (callback: () => void) => () => void;
      onStopDictation?: (callback: () => void) => () => void;

      // STT config
      getSttConfig?: () => Promise<{
        success: boolean;
        dictation: { mode: string };
        notes: { mode: string };
        streamingProvider: string;
      } | null>;

      // Database operations
      saveTranscription: (
        text: string,
        rawText?: string | null,
        options?: { status?: TranscriptionStatus; errorMessage?: string | null }
      ) => Promise<{ id: number; success: boolean; transcription?: TranscriptionItem }>;
      getTranscriptions: (limit?: number) => Promise<TranscriptionItem[]>;
      clearTranscriptions: () => Promise<{ cleared: number; success: boolean }>;
      deleteTranscription: (id: number) => Promise<{ success: boolean }>;
      getTranscriptionById: (id: number) => Promise<TranscriptionItem | null>;

      // Audio retention operations
      saveTranscriptionAudio: (
        id: number,
        audioBuffer: ArrayBuffer,
        metadata?: { durationMs?: number; provider?: string; model?: string }
      ) => Promise<{ success: boolean; path?: string }>;
      getAudioPath: (id: number) => Promise<string | null>;
      showAudioInFolder: (id: number) => Promise<{ success: boolean }>;
      getAudioBuffer: (id: number) => Promise<ArrayBuffer | null>;
      deleteTranscriptionAudio: (id: number) => Promise<{ success: boolean }>;
      getAudioStorageUsage: () => Promise<{ fileCount: number; totalBytes: number }>;
      deleteAllAudio: () => Promise<{ deleted: number }>;
      retryTranscription: (
        id: number
      ) => Promise<{ success: boolean; transcription?: TranscriptionItem; error?: string }>;
      updateTranscriptionText: (
        id: number,
        text: string,
        rawText: string
      ) => Promise<{ success: boolean; transcription?: TranscriptionItem; error?: string }>;

      // Dictionary operations
      getDictionary: () => Promise<string[]>;
      setDictionary: (words: string[]) => Promise<{ success: boolean }>;
      onDictionaryUpdated?: (callback: (words: string[]) => void) => () => void;
      setAutoLearnEnabled?: (enabled: boolean) => void;
      onCorrectionsLearned?: (callback: (words: string[]) => void) => () => void;
      undoLearnedCorrections?: (words: string[]) => Promise<{ success: boolean }>;

      // Note operations
      saveNote: (
        title: string,
        content: string,
        noteType?: string,
        sourceFile?: string | null,
        audioDuration?: number | null,
        folderId?: number | null
      ) => Promise<{ success: boolean; note?: NoteItem }>;
      getNote: (id: number) => Promise<NoteItem | null>;
      getNotes: (
        noteType?: string | null,
        limit?: number,
        folderId?: number | null
      ) => Promise<NoteItem[]>;
      updateNote: (
        id: number,
        updates: {
          title?: string;
          content?: string;
          enhanced_content?: string | null;
          enhancement_prompt?: string | null;
          enhanced_at_content_hash?: string | null;
          folder_id?: number | null;
          transcript?: string | null;
          calendar_event_id?: string | null;
        }
      ) => Promise<{ success: boolean; note?: NoteItem }>;
      deleteNote: (id: number) => Promise<{ success: boolean }>;
      exportNote: (
        noteId: number,
        format: "txt" | "md"
      ) => Promise<{ success: boolean; error?: string }>;
      searchNotes: (query: string, limit?: number) => Promise<NoteItem[]>;
      updateNoteCloudId: (id: number, cloudId: string) => Promise<NoteItem>;

      // Folder operations
      getFolders: () => Promise<FolderItem[]>;
      createFolder: (
        name: string
      ) => Promise<{ success: boolean; folder?: FolderItem; error?: string }>;
      deleteFolder: (id: number) => Promise<{ success: boolean; error?: string }>;
      renameFolder: (
        id: number,
        name: string
      ) => Promise<{ success: boolean; folder?: FolderItem; error?: string }>;
      getFolderNoteCounts: () => Promise<Array<{ folder_id: number; count: number }>>;

      // Action operations
      getActions: () => Promise<ActionItem[]>;
      getAction: (id: number) => Promise<ActionItem | null>;
      createAction: (
        name: string,
        description: string,
        prompt: string,
        icon?: string
      ) => Promise<{ success: boolean; action?: ActionItem; error?: string }>;
      updateAction: (
        id: number,
        updates: {
          name?: string;
          description?: string;
          prompt?: string;
          icon?: string;
          sort_order?: number;
        }
      ) => Promise<{ success: boolean; action?: ActionItem; error?: string }>;
      deleteAction: (id: number) => Promise<{ success: boolean; id?: number; error?: string }>;
      onActionCreated?: (callback: (action: ActionItem) => void) => () => void;
      onActionUpdated?: (callback: (action: ActionItem) => void) => () => void;
      onActionDeleted?: (callback: (payload: { id: number }) => void) => () => void;

      // Audio file operations
      selectAudioFile: () => Promise<{ canceled: boolean; filePath?: string }>;
      getFileSize?: (filePath: string) => Promise<number>;
      transcribeAudioFile: (
        filePath: string,
        options?: {
          provider?: "whisper" | "nvidia";
          model?: string;
          language?: string;
          [key: string]: unknown;
        }
      ) => Promise<{ success: boolean; text?: string; error?: string }>;
      getPathForFile: (file: File) => string;

      // Note event listeners
      onNoteAdded?: (callback: (note: NoteItem) => void) => () => void;
      onNoteUpdated?: (callback: (note: NoteItem) => void) => () => void;
      onNoteDeleted?: (callback: (payload: { id: number }) => void) => () => void;

      // Database event listeners
      onTranscriptionAdded?: (callback: (item: TranscriptionItem) => void) => () => void;
      onTranscriptionUpdated?: (callback: (item: TranscriptionItem) => void) => () => void;
      onTranscriptionDeleted?: (callback: (payload: { id: number }) => void) => () => void;
      onTranscriptionsCleared?: (callback: (payload: { cleared: number }) => void) => () => void;

      // API key management
      getOpenAIKey: () => Promise<string>;
      saveOpenAIKey: (key: string) => Promise<{ success: boolean }>;
      createProductionEnvFile: (key: string) => Promise<void>;
      getAnthropicKey: () => Promise<string | null>;
      saveAnthropicKey: (key: string) => Promise<void>;
      getUiLanguage: () => Promise<string>;
      saveUiLanguage: (language: string) => Promise<{ success: boolean; language: string }>;
      setUiLanguage: (language: string) => Promise<{ success: boolean; language: string }>;
      saveAllKeysToEnv: () => Promise<{ success: boolean; path: string }>;
      syncStartupPreferences: (prefs: {
        useLocalWhisper: boolean;
        localTranscriptionProvider: LocalTranscriptionProvider;
        model?: string;
        reasoningProvider: string;
        reasoningModel?: string;
      }) => Promise<void>;

      // Clipboard operations
      checkAccessibilityPermission: (silent?: boolean) => Promise<boolean>;
      promptAccessibilityPermission: () => Promise<boolean>;
      readClipboard: () => Promise<string>;
      writeClipboard: (text: string) => Promise<{ success: boolean }>;
      checkPasteTools: () => Promise<PasteToolsResult>;

      // Audio
      onNoAudioDetected: (callback: (event: any, data?: any) => void) => () => void;

      // Whisper operations (whisper.cpp)
      transcribeLocalWhisper: (audioBlob: Blob | ArrayBuffer, options?: any) => Promise<any>;
      checkWhisperInstallation: () => Promise<WhisperCheckResult>;
      downloadWhisperModel: (modelName: string) => Promise<WhisperModelResult>;
      onWhisperDownloadProgress: (
        callback: (event: any, data: WhisperDownloadProgressData) => void
      ) => () => void;
      checkModelStatus: (modelName: string) => Promise<WhisperModelResult>;
      listWhisperModels: () => Promise<WhisperModelsListResult>;
      deleteWhisperModel: (modelName: string) => Promise<WhisperModelDeleteResult>;
      deleteAllWhisperModels: () => Promise<{
        success: boolean;
        deleted_count?: number;
        freed_bytes?: number;
        freed_mb?: number;
        error?: string;
      }>;
      cancelWhisperDownload: () => Promise<{
        success: boolean;
        message?: string;
        error?: string;
      }>;

      // CUDA GPU acceleration
      detectGpu: () => Promise<GpuInfo>;
      getCudaWhisperStatus: () => Promise<CudaWhisperStatus>;
      downloadCudaWhisperBinary: () => Promise<{ success: boolean; error?: string }>;
      cancelCudaWhisperDownload: () => Promise<{ success: boolean }>;
      deleteCudaWhisperBinary: () => Promise<{ success: boolean }>;
      onCudaDownloadProgress: (
        callback: (data: {
          downloadedBytes: number;
          totalBytes: number;
          percentage: number;
        }) => void
      ) => () => void;
      onCudaFallbackNotification: (callback: () => void) => () => void;

      // Parakeet operations (NVIDIA via sherpa-onnx)
      transcribeLocalParakeet: (
        audioBlob: ArrayBuffer,
        options?: { model?: string; language?: string }
      ) => Promise<ParakeetTranscriptionResult>;
      checkParakeetInstallation: () => Promise<ParakeetCheckResult>;
      downloadParakeetModel: (modelName: string) => Promise<ParakeetModelResult>;
      onParakeetDownloadProgress: (
        callback: (event: any, data: ParakeetDownloadProgressData) => void
      ) => () => void;
      checkParakeetModelStatus: (modelName: string) => Promise<ParakeetModelResult>;
      listParakeetModels: () => Promise<ParakeetModelsListResult>;
      deleteParakeetModel: (modelName: string) => Promise<ParakeetModelDeleteResult>;
      deleteAllParakeetModels: () => Promise<{
        success: boolean;
        deleted_count?: number;
        freed_bytes?: number;
        freed_mb?: number;
        error?: string;
      }>;
      cancelParakeetDownload: () => Promise<{
        success: boolean;
        message?: string;
        error?: string;
      }>;
      getParakeetDiagnostics: () => Promise<ParakeetDiagnosticsResult>;

      // Local AI model management
      modelGetAll: () => Promise<any[]>;
      modelCheck: (modelId: string) => Promise<boolean>;
      modelDownload: (modelId: string) => Promise<{
        success: boolean;
        path?: string;
        error?: string;
        code?: string;
        details?: string;
      }>;
      modelDelete: (modelId: string) => Promise<{
        success: boolean;
        error?: string;
        code?: string;
        details?: string;
      }>;
      modelDeleteAll: () => Promise<{
        success: boolean;
        error?: string;
        code?: string;
        details?: string;
      }>;
      modelCheckRuntime: () => Promise<{
        available: boolean;
        error?: string;
        code?: string;
        details?: string;
      }>;
      modelCancelDownload: (modelId: string) => Promise<{ success: boolean; error?: string }>;
      onModelDownloadProgress: (callback: (event: any, data: any) => void) => () => void;

      // Local reasoning
      processLocalReasoning: (
        text: string,
        modelId: string,
        agentName: string | null,
        config: any
      ) => Promise<{ success: boolean; text?: string; error?: string }>;
      checkLocalReasoningAvailable: () => Promise<boolean>;

      // Anthropic reasoning
      processAnthropicReasoning: (
        text: string,
        modelId: string,
        agentName: string | null,
        config: any
      ) => Promise<{ success: boolean; text?: string; error?: string }>;

      // llama.cpp management
      llamaCppCheck: () => Promise<{ isInstalled: boolean; version?: string }>;
      llamaCppInstall: () => Promise<{ success: boolean; error?: string }>;
      llamaCppUninstall: () => Promise<{ success: boolean; error?: string }>;

      // llama-server
      llamaServerStart: (
        modelId: string
      ) => Promise<{ success: boolean; port?: number; error?: string }>;
      llamaServerStop: () => Promise<{ success: boolean; error?: string }>;
      llamaServerStatus: () => Promise<LlamaServerStatus>;
      llamaGpuReset: () => Promise<{ success: boolean; error?: string }>;
      detectVulkanGpu?: () => Promise<VulkanGpuResult>;
      getLlamaVulkanStatus?: () => Promise<LlamaVulkanStatus>;
      downloadLlamaVulkanBinary?: () => Promise<{
        success: boolean;
        cancelled?: boolean;
        error?: string;
      }>;
      cancelLlamaVulkanDownload?: () => Promise<{ success: boolean }>;
      deleteLlamaVulkanBinary?: () => Promise<{
        success: boolean;
        deletedCount?: number;
        error?: string;
      }>;
      onLlamaVulkanDownloadProgress?: (
        callback: (data: LlamaVulkanDownloadProgress) => void
      ) => () => void;

      // Window control operations
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      restoreFromMeetingMode: () => Promise<void>;
      getPlatform: () => string;
      startWindowDrag: () => Promise<void>;
      stopWindowDrag: () => Promise<void>;
      setMainWindowInteractivity: (interactive: boolean) => Promise<void>;

      // App management
      appQuit: () => Promise<void>;
      cleanupApp: () => Promise<{ success: boolean; message: string; errors?: string[] }>;

      // Update operations
      checkForUpdates: () => Promise<UpdateCheckResult>;
      downloadUpdate: () => Promise<UpdateResult>;
      installUpdate: () => Promise<UpdateResult>;
      getAppVersion: () => Promise<AppVersionResult>;
      getUpdateStatus: () => Promise<UpdateStatusResult>;
      getUpdateInfo: () => Promise<UpdateInfoResult | null>;

      // Update event listeners
      onUpdateAvailable: (callback: (event: any, info: any) => void) => () => void;
      onUpdateNotAvailable: (callback: (event: any, info: any) => void) => () => void;
      onUpdateDownloaded: (callback: (event: any, info: any) => void) => () => void;
      onUpdateDownloadProgress: (callback: (event: any, progressObj: any) => void) => () => void;
      onUpdateError: (callback: (event: any, error: any) => void) => () => void;

      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

      // Hotkey management
      updateHotkey: (key: string) => Promise<{ success: boolean; message: string }>;
      setHotkeyListeningMode?: (
        enabled: boolean,
        newHotkey?: string | null
      ) => Promise<{ success: boolean }>;
      getHotkeyModeInfo?: () => Promise<{
        isUsingGnome: boolean;
        isUsingHyprland: boolean;
        isUsingNativeShortcut: boolean;
      }>;

      // Wayland paste diagnostics
      getYdotoolStatus?: () => Promise<{
        isLinux: boolean;
        isWayland: boolean;
        hasYdotool: boolean;
        hasYdotoold: boolean;
        daemonRunning: boolean;
        hasService: boolean;
        hasUinput: boolean;
        hasUdevRule: boolean;
        hasGroup: boolean;
        allGood: boolean;
      }>;

      // Globe key listener for hotkey capture (macOS only)
      onGlobeKeyPressed?: (callback: () => void) => () => void;
      onGlobeKeyReleased?: (callback: () => void) => () => void;

      // Hotkey registration events
      onHotkeyFallbackUsed?: (
        callback: (data: { original: string; fallback: string; message: string }) => void
      ) => () => void;
      onHotkeyRegistrationFailed?: (
        callback: (data: { hotkey: string; error: string; suggestions: string[] }) => void
      ) => () => void;
      onSettingUpdated?: (callback: (data: { key: string; value: unknown }) => void) => () => void;

      // Accessibility permission events (macOS)
      onAccessibilityMissing?: (callback: () => void) => () => void;
      checkAccessibilityTrusted?: () => Promise<boolean>;

      // Gemini API key management
      getGeminiKey: () => Promise<string | null>;
      saveGeminiKey: (key: string) => Promise<void>;

      // Groq API key management
      getGroqKey: () => Promise<string | null>;
      saveGroqKey: (key: string) => Promise<void>;

      // Mistral API key management
      getMistralKey: () => Promise<string | null>;
      saveMistralKey: (key: string) => Promise<void>;
      proxyMistralTranscription: (data: {
        audioBuffer: ArrayBuffer;
        model?: string;
        language?: string;
        contextBias?: string[];
      }) => Promise<{ text: string }>;

      // Custom endpoint API keys
      getCustomTranscriptionKey?: () => Promise<string | null>;
      saveCustomTranscriptionKey?: (key: string) => Promise<void>;
      getCustomReasoningKey?: () => Promise<string | null>;
      saveCustomReasoningKey?: (key: string) => Promise<void>;

      // Dictation key persistence (file-based for reliable startup)
      getDictationKey?: () => Promise<string | null>;
      saveDictationKey?: (key: string) => Promise<void>;

      // Activation mode persistence (file-based for reliable startup)
      getActivationMode?: () => Promise<"tap" | "push">;
      saveActivationMode?: (mode: "tap" | "push") => Promise<void>;

      // Debug logging
      getLogLevel?: () => Promise<string>;
      log?: (entry: {
        level: string;
        message: string;
        meta?: any;
        scope?: string;
        source?: string;
      }) => Promise<void>;
      getDebugState: () => Promise<{
        enabled: boolean;
        logPath: string | null;
        logLevel: string;
      }>;
      setDebugLogging: (enabled: boolean) => Promise<{
        success: boolean;
        enabled?: boolean;
        logPath?: string | null;
        error?: string;
      }>;
      openLogsFolder: () => Promise<{ success: boolean; error?: string }>;

      // FFmpeg availability
      checkFFmpegAvailability: () => Promise<FFmpegAvailabilityResult>;
      getAudioDiagnostics: () => Promise<AudioDiagnosticsResult>;

      // System settings helpers
      requestMicrophoneAccess?: () => Promise<{ granted: boolean }>;
      checkMicrophoneAccess?: () => Promise<{ granted: boolean; status: string }>;
      checkSystemAudioAccess?: () => Promise<SystemAudioAccessResult>;
      requestSystemAudioAccess?: () => Promise<SystemAudioAccessResult>;
      openMicrophoneSettings?: () => Promise<{ success: boolean; error?: string }>;
      openSoundInputSettings?: () => Promise<{ success: boolean; error?: string }>;
      openAccessibilitySettings?: () => Promise<{ success: boolean; error?: string }>;
      openSystemAudioSettings?: () => Promise<{ success: boolean; error?: string }>;
      toggleMediaPlayback?: () => Promise<boolean>;
      pauseMediaPlayback?: () => Promise<boolean>;
      resumeMediaPlayback?: () => Promise<boolean>;
      openWhisperModelsFolder?: () => Promise<{ success: boolean; error?: string }>;

      // Windows Push-to-Talk notifications
      notifyActivationModeChanged?: (mode: "tap" | "push") => void;
      notifyHotkeyChanged?: (hotkey: string) => void;
      registerMeetingHotkey?: (hotkey: string) => Promise<{ success: boolean; message?: string }>;
      notifyFloatingIconAutoHideChanged?: (enabled: boolean) => void;
      onFloatingIconAutoHideChanged?: (callback: (enabled: boolean) => void) => () => void;
      notifyStartMinimizedChanged?: (enabled: boolean) => void;
      notifyPanelStartPositionChanged?: (position: string) => void;

      // Auto-start at login
      getAutoStartEnabled?: () => Promise<boolean>;
      setAutoStartEnabled?: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;

      // Auth
      authClearSession?: () => Promise<void>;

      // OpenWhispr Cloud API
      cloudTranscribe?: (
        audioBuffer: ArrayBuffer,
        opts: { language?: string; prompt?: string; useCase?: string; diarization?: boolean }
      ) => Promise<{
        success: boolean;
        text?: string;
        wordsUsed?: number;
        wordsRemaining?: number;
        limitReached?: boolean;
        error?: string;
        code?: string;
      }>;
      cloudReason?: (
        text: string,
        opts: {
          model?: string;
          agentName?: string;
          customDictionary?: string[];
          customPrompt?: string;
          systemPrompt?: string;
          language?: string;
          locale?: string;
        }
      ) => Promise<{
        success: boolean;
        text?: string;
        model?: string;
        provider?: string;
        promptMode?: string;
        matchType?: string;
        error?: string;
        code?: string;
      }>;
      cloudStreamingUsage?: (
        text: string,
        audioDurationSeconds: number,
        opts?: {
          sendLogs?: boolean;
          sttProvider?: string;
          sttModel?: string;
          sttProcessingMs?: number;
          sttLanguage?: string;
          audioSizeBytes?: number;
          audioFormat?: string;
          clientTotalMs?: number;
        }
      ) => Promise<{
        success: boolean;
        wordsUsed?: number;
        wordsRemaining?: number;
        limitReached?: boolean;
        error?: string;
        code?: string;
      }>;
      cloudUsage?: () => Promise<{
        success: boolean;
        wordsUsed?: number;
        wordsRemaining?: number;
        limit?: number;
        plan?: string;
        status?: string;
        isSubscribed?: boolean;
        isTrial?: boolean;
        trialDaysLeft?: number | null;
        currentPeriodEnd?: string | null;
        billingInterval?: "monthly" | "annual" | null;
        resetAt?: string;
        error?: string;
        code?: string;
      }>;
      cloudCheckout?: (opts?: {
        plan?: "monthly" | "annual";
        tier?: "pro" | "business";
      }) => Promise<{
        success: boolean;
        url?: string;
        error?: string;
        code?: string;
      }>;
      cloudBillingPortal?: () => Promise<{
        success: boolean;
        url?: string;
        error?: string;
        code?: string;
      }>;
      cloudSwitchPlan?: (opts: {
        plan: "monthly" | "annual";
        tier: "pro" | "business";
      }) => Promise<{
        success: boolean;
        alreadyOnPlan?: boolean;
        error?: string;
      }>;
      cloudPreviewSwitch?: (opts: {
        plan: "monthly" | "annual";
        tier: "pro" | "business";
      }) => Promise<{
        success: boolean;
        immediateAmount?: number;
        currency?: string;
        currentPriceAmount?: number;
        currentInterval?: string;
        newPriceAmount?: number;
        newInterval?: string;
        nextBillingDate?: string;
        alreadyOnPlan?: boolean;
        error?: string;
      }>;

      // Cloud audio file transcription
      transcribeAudioFileCloud?: (filePath: string) => Promise<{
        success: boolean;
        text?: string;
        error?: string;
        code?: string;
      }>;

      onUploadTranscriptionProgress?: (
        callback: (data: { stage: string; chunksTotal: number; chunksCompleted: number }) => void
      ) => () => void;

      // BYOK audio file transcription
      transcribeAudioFileByok?: (options: {
        filePath: string;
        apiKey: string;
        baseUrl: string;
        model: string;
      }) => Promise<{
        success: boolean;
        text?: string;
        error?: string;
      }>;

      // Usage limit events
      notifyLimitReached?: (data: { wordsUsed: number; limit: number }) => void;
      onLimitReached?: (
        callback: (data: { wordsUsed: number; limit: number }) => void
      ) => () => void;

      // AssemblyAI Streaming
      assemblyAiStreamingWarmup?: (options?: {
        sampleRate?: number;
        language?: string;
      }) => Promise<{
        success: boolean;
        alreadyWarm?: boolean;
        error?: string;
        code?: string;
      }>;
      assemblyAiStreamingStart?: (options?: { sampleRate?: number; language?: string }) => Promise<{
        success: boolean;
        usedWarmConnection?: boolean;
        error?: string;
        code?: string;
      }>;
      assemblyAiStreamingSend?: (audioBuffer: ArrayBuffer) => void;
      assemblyAiStreamingForceEndpoint?: () => void;
      assemblyAiStreamingStop?: () => Promise<{
        success: boolean;
        text?: string;
        error?: string;
      }>;
      assemblyAiStreamingStatus?: () => Promise<{
        isConnected: boolean;
        sessionId: string | null;
      }>;
      onAssemblyAiPartialTranscript?: (callback: (text: string) => void) => () => void;
      onAssemblyAiFinalTranscript?: (callback: (text: string) => void) => () => void;
      onAssemblyAiError?: (callback: (error: string) => void) => () => void;
      onAssemblyAiSessionEnd?: (
        callback: (data: { audioDuration?: number; text?: string }) => void
      ) => () => void;

      // Referral stats
      getReferralStats?: () => Promise<{
        referralCode: string;
        referralLink: string;
        totalReferrals: number;
        completedReferrals: number;
        pendingReferrals: number;
        totalMonthsEarned: number;
        referrals: Array<{
          id: string;
          email: string;
          name: string;
          status: "pending" | "completed" | "rewarded";
          created_at: string;
          first_payment_at: string | null;
          words_used: number;
        }>;
      }>;

      sendReferralInvite?: (email: string) => Promise<{
        success: boolean;
        invite: {
          id: string;
          recipientEmail: string;
          status: "sent" | "failed" | "opened" | "converted";
          sentAt: string;
        };
      }>;

      getReferralInvites?: () => Promise<{
        invites: Array<{
          id: string;
          recipientEmail: string;
          status: "sent" | "failed" | "opened" | "converted";
          sentAt: string;
          openedAt?: string;
          convertedAt?: string;
        }>;
      }>;

      // Agent Mode
      updateAgentHotkey?: (hotkey: string) => Promise<{ success: boolean; message: string }>;
      getAgentKey?: () => Promise<string>;
      saveAgentKey?: (key: string) => Promise<void>;
      createAgentConversation?: (title: string) => Promise<{
        id: number;
        title: string;
        created_at: string;
        updated_at: string;
      }>;
      getAgentConversations?: (limit?: number) => Promise<
        Array<{
          id: number;
          title: string;
          created_at: string;
          updated_at: string;
        }>
      >;
      getAgentConversation?: (id: number) => Promise<{
        id: number;
        title: string;
        created_at: string;
        updated_at: string;
        messages: Array<{
          id: number;
          conversation_id: number;
          role: "user" | "assistant" | "system";
          content: string;
          created_at: string;
        }>;
      } | null>;
      deleteAgentConversation?: (id: number) => Promise<{ success: boolean }>;
      updateAgentConversationTitle?: (id: number, title: string) => Promise<{ success: boolean }>;
      addAgentMessage?: (
        conversationId: number,
        role: "user" | "assistant" | "system",
        content: string
      ) => Promise<{
        id: number;
        conversation_id: number;
        role: string;
        content: string;
        created_at: string;
      }>;
      getAgentMessages?: (conversationId: number) => Promise<
        Array<{
          id: number;
          conversation_id: number;
          role: "user" | "assistant" | "system";
          content: string;
          created_at: string;
        }>
      >;

      // Deepgram Streaming
      deepgramStreamingWarmup?: (options?: { sampleRate?: number; language?: string }) => Promise<{
        success: boolean;
        alreadyWarm?: boolean;
        error?: string;
        code?: string;
      }>;
      deepgramStreamingStart?: (options?: {
        sampleRate?: number;
        language?: string;
        forceNew?: boolean;
      }) => Promise<{
        success: boolean;
        usedWarmConnection?: boolean;
        error?: string;
        code?: string;
      }>;
      deepgramStreamingSend?: (audioBuffer: ArrayBuffer) => void;
      deepgramStreamingFinalize?: () => void;
      deepgramStreamingStop?: () => Promise<{
        success: boolean;
        text?: string;
        error?: string;
      }>;
      deepgramStreamingStatus?: () => Promise<{
        isConnected: boolean;
        sessionId: string | null;
      }>;
      onDeepgramPartialTranscript?: (callback: (text: string) => void) => () => void;
      onDeepgramFinalTranscript?: (callback: (text: string) => void) => () => void;
      onDeepgramError?: (callback: (error: string) => void) => () => void;
      onDeepgramSessionEnd?: (
        callback: (data: { audioDuration?: number; text?: string }) => void
      ) => () => void;

      // Agent overlay
      resizeAgentWindow?: (width: number, height: number) => Promise<void>;
      getAgentWindowBounds?: () => Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
      } | null>;
      setAgentWindowBounds?: (x: number, y: number, width: number, height: number) => Promise<void>;
      hideAgentOverlay?: () => Promise<void>;
      onAgentStartRecording?: (callback: () => void) => () => void;
      onAgentStopRecording?: (callback: () => void) => () => void;
      onAgentToggleRecording?: (callback: () => void) => () => void;

      // Agent cloud streaming
      cloudAgentStream?: (
        messages: Array<{ role: string; content: string }>,
        opts?: { systemPrompt?: string }
      ) => Promise<{ success: boolean; error?: string; code?: string }>;
      onAgentStreamChunk?: (callback: (chunk: string) => void) => () => void;
      onAgentStreamDone?: (callback: () => void) => () => void;

      // Google Calendar
      gcalStartOAuth?: () => Promise<{ success: boolean; email?: string; error?: string }>;
      gcalDisconnect?: (email?: string) => Promise<{ success: boolean; error?: string }>;
      gcalGetConnectionStatus?: () => Promise<{
        connected: boolean;
        accounts: Array<{ email: string }>;
        email: string | null;
      }>;
      gcalGetCalendars?: () => Promise<{ success: boolean; calendars: any[] }>;
      gcalSetCalendarSelection?: (
        calendarId: string,
        isSelected: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      gcalSyncEvents?: () => Promise<{ success: boolean; error?: string }>;
      gcalGetUpcomingEvents?: (
        windowMinutes?: number
      ) => Promise<{ success: boolean; events: any[] }>;

      // Meeting chain transcription (BaseTen)
      meetingTranscribeChain?: (
        blobUrl: string,
        opts?: {
          skipCleanup?: boolean;
          agentName?: string;
          customDictionary?: string[];
        }
      ) => Promise<{
        success: boolean;
        text?: string;
        rawText?: string;
        cleanedText?: string;
        processingDurationSec?: number;
        speedupFactor?: number;
        error?: string;
      }>;

      // Meeting transcription (streaming, dual-channel)
      meetingTranscriptionPrepare?: (options: {
        provider?: string;
        model?: string;
        language?: string;
      }) => Promise<{ success: boolean; alreadyPrepared?: boolean; error?: string }>;
      meetingTranscriptionStart?: (options: {
        provider?: string;
        model?: string;
        language?: string;
        noteId?: string;
      }) => Promise<{
        success: boolean;
        error?: string;
        systemAudioMode?: "native" | "unsupported";
      }>;
      meetingTranscriptionSend?: (buffer: ArrayBuffer, source: "mic" | "system") => void;
      meetingTranscriptionStop?: () => Promise<{
        success: boolean;
        transcript?: string;
        error?: string;
        audioBufferDir?: string;
        audioFiles?: string[];
        checkpointedSegments?: number;
      }>;
      meetingAudioCleanup?: (dir?: string) => Promise<{ success: boolean; error?: string }>;
      meetingCheckpointStart?: (noteId: string) => Promise<{ success: boolean; error?: string }>;
      onMeetingTranscriptionSegment?: (
        callback: (data: {
          text: string;
          source: "mic" | "system";
          type: "partial" | "final";
        }) => void
      ) => () => void;
      onMeetingTranscriptionError?: (callback: (error: string) => void) => () => void;

      // Dictation realtime streaming
      dictationRealtimeWarmup?: (options: {
        model?: string;
        mode?: "byok" | "openwhispr";
      }) => Promise<{ success: boolean; error?: string }>;
      dictationRealtimeStart?: (options: {
        model?: string;
        mode?: "byok" | "openwhispr";
      }) => Promise<{ success: boolean; error?: string }>;
      dictationRealtimeSend?: (buffer: ArrayBuffer) => void;
      dictationRealtimeStop?: () => Promise<{ success: boolean; text: string }>;
      onDictationRealtimePartial?: (callback: (text: string) => void) => () => void;
      onDictationRealtimeFinal?: (callback: (text: string) => void) => () => void;
      onDictationRealtimeError?: (callback: (error: string) => void) => () => void;
      onDictationRealtimeSessionEnd?: (callback: (data: { text: string }) => void) => () => void;

      // Google Calendar event listeners
      onGcalMeetingStarting?: (callback: (data: any) => void) => () => void;
      onGcalMeetingEnded?: (callback: (data: any) => void) => () => void;
      onGcalStartRecording?: (callback: (data: any) => void) => () => void;
      onGcalConnectionChanged?: (callback: (data: any) => void) => () => void;
      onGcalEventsSynced?: (callback: (data: any) => void) => () => void;

      meetingDetectionGetPreferences?: () => Promise<{ success: boolean; preferences?: any }>;
      meetingDetectionSetPreferences?: (
        prefs: Record<string, boolean>
      ) => Promise<{ success: boolean }>;
      meetingDetectionRespond?: (
        detectionId: string,
        action: string
      ) => Promise<{ success: boolean }>;
      onMeetingDetected?: (callback: (data: any) => void) => () => void;
      onMeetingDetectedStartRecording?: (callback: (data: any) => void) => () => void;
      onMeetingNotificationData?: (callback: (data: any) => void) => () => void;
      getMeetingNotificationData?: () => Promise<any>;
      meetingNotificationReady?: () => Promise<void>;
      meetingNotificationRespond?: (
        detectionId: string,
        action: string
      ) => Promise<{ success: boolean }>;
      onNavigateToMeetingNote?: (
        callback: (data: { noteId: number; folderId: number; event: any }) => void
      ) => () => void;
      onUpdateNotificationData?: (
        callback: (data: { version: string; releaseDate?: string }) => void
      ) => () => void;
      getUpdateNotificationData?: () => Promise<{
        version: string;
        releaseDate?: string;
      } | null>;
      updateNotificationReady?: () => Promise<void>;
      updateNotificationRespond?: (action: string) => Promise<{ success: boolean }>;

      // WhisperWoof — History
      whisperwoofGetEntries: (limit: number, offset: number) => Promise<any[]>;
      whisperwoofSearchEntries: (query: string, limit: number) => Promise<any[]>;
      whisperwoofDeleteEntry: (id: string) => Promise<void>;

      // WhisperWoof — Projects
      whisperwoofGetProjects: () => Promise<any[]>;
      whisperwoofCreateProject: (name: string) => Promise<any>;
      whisperwoofDeleteProject: (id: string) => Promise<void>;
      whisperwoofGetProjectEntries: (projectId: string, limit: number) => Promise<any[]>;

      // WhisperWoof — Voice Activity Detection
      whisperwoofGetVadConfig: () => Promise<{ silenceThreshold: number; autoStopSilenceMs: number; minRecordingMs: number; frameSizeSamples: number; trimPaddingMs: number }>;

      // WhisperWoof — Settings export/import
      whisperwoofExportSettings: (options?: { appPresetMap?: Record<string, string>; localStorageKeys?: Record<string, string> }) => Promise<{ bundle: any; stats: Record<string, number>; error?: string }>;
      whisperwoofImportSettings: (bundle: any, options?: { merge?: boolean }) => Promise<{ success: boolean; imported: Record<string, any>; errors: string[]; appPresetMap?: Record<string, string>; preferences?: Record<string, string> }>;
      whisperwoofSaveExportFile: (filePath: string, bundle: any) => Promise<{ success: boolean; path?: string; sizeBytes?: number; error?: string }>;
      whisperwoofLoadImportFile: (filePath: string) => Promise<{ success: boolean; bundle?: any; error?: string }>;

      // WhisperWoof — Usage analytics
      whisperwoofGetAnalytics: (options?: { days?: number }) => Promise<{
        summary: { totalEntries: number; todayEntries: number; thisWeekEntries: number; thisMonthEntries: number };
        entriesPerDay: Array<{ day: string; count: number }>;
        sourceBreakdown: Array<{ source: string; count: number }>;
        polishStats: { totalPolished: number; totalRaw: number; avgCharsSaved: number; polishRate: number };
        topCommands: Array<{ command: string; count: number }>;
        topSnippets: Array<{ trigger: string; count: number }>;
        busiestHours: Array<{ hour: number; count: number }>;
        averageDuration: { avgMs: number; totalMs: number; count: number };
        streaks: { current: number; longest: number };
      } | null>;

      // WhisperWoof — Language detection
      whisperwoofDetectLanguage: (text: string) => Promise<{ lang: string; name: string; confidence: string }>;
      whisperwoofGetSupportedLanguages: () => Promise<Array<{ code: string; name: string }>>;

      // WhisperWoof — Intent capture
      whisperwoofDetectRambling: (text: string) => Promise<{ score: number; signals: Record<string, number>; isRambling: boolean }>;
      whisperwoofExtractIntent: (text: string, options?: { mode?: string }) => Promise<{ text: string; mode: string; ramblingScore: number; extracted: boolean; error?: string }>;
      whisperwoofGetIntentModes: () => Promise<Array<{ id: string; name: string; description: string }>>;

      // WhisperWoof — Streaming transcription
      whisperwoofStreamingFormat: (text: string, maxChars?: number) => Promise<string>;
      whisperwoofStreamingDiff: (oldText: string, newText: string) => Promise<{ unchanged: number; changed: number; added: number; newWords: string[] }>;

      // WhisperWoof — Focus mode
      whisperwoofFocusStart: (options?: { durationMin?: number; goal?: string; presetId?: string }) => Promise<{ success: boolean; session?: any; error?: string }>;
      whisperwoofFocusEnd: (summary?: string) => Promise<{ success: boolean; session?: any; error?: string }>;
      whisperwoofFocusActive: () => Promise<{ id: string; startedAt: string; durationMin: number; goal: string | null; entryIds: string[]; wordCount: number; elapsedMin: number; remainingMin: number; isExpired: boolean } | null>;
      whisperwoofFocusRecordEntry: (entryId: string, wordCount: number) => Promise<boolean>;
      whisperwoofFocusStats: () => Promise<{ totalSessions: number; totalMinutes: number; totalWords: number; totalEntries: number; avgDuration: number; completionRate: number; currentStreak: number }>;
      whisperwoofFocusHistory: (options?: { days?: number; limit?: number }) => Promise<any[]>;
      whisperwoofFocusPresets: () => Promise<Array<{ id: string; name: string; durationMin: number; description: string }>>;

      // WhisperWoof — App automation
      whisperwoofDetectAutomation: (text: string) => Promise<{ id: string; label: string; appName: string | null } | null>;
      whisperwoofExecuteAutomation: (commandId: string, appName?: string) => Promise<{ success: boolean; output?: string; error?: string }>;
      whisperwoofGetAutomationCommands: () => Promise<Array<{ id: string; label: string }>>;

      // WhisperWoof — Conversation memory
      whisperwoofIsMemoryQuery: (text: string) => Promise<boolean>;
      whisperwoofExtractQueryTopic: (text: string) => Promise<string | null>;
      whisperwoofAnswerMemoryQuery: (query: string, entries: any[], options?: Record<string, any>) => Promise<{ success: boolean; answer?: string; entriesUsed?: number; entries?: any[]; error?: string }>;
      whisperwoofGetMemoryExamples: () => Promise<string[]>;

      // WhisperWoof — Agentic actions
      whisperwoofDetectAction: (text: string) => Promise<{ id: string; plugin: string; tool: string; label: string } | null>;
      whisperwoofPrepareAction: (text: string, options?: Record<string, any>) => Promise<{ success: boolean; isAction: boolean; action?: any; error?: string }>;
      whisperwoofGetAvailableActions: () => Promise<Array<{ id: string; plugin: string; label: string }>>;

      // WhisperWoof — Screen context
      whisperwoofGetSelectedText: () => Promise<string | null>;
      whisperwoofDetectScreenCommand: (text: string) => Promise<{ id: string; prompt: string; label: string } | null>;
      whisperwoofExecuteScreenCommand: (commandId: string, selectedText?: string, options?: Record<string, any>) => Promise<{ success: boolean; result?: string; command?: string; error?: string }>;
      whisperwoofGetScreenCommands: () => Promise<Array<{ id: string; label: string }>>;

      // WhisperWoof — Entry chaining
      whisperwoofLinkEntries: (childId: string, parentId: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofUnlinkEntry: (childId: string) => Promise<{ success: boolean; removed?: boolean; error?: string }>;
      whisperwoofGetChain: (entryId: string) => Promise<Array<{ id: string; createdAt: string; source: string; text: string }>>;
      whisperwoofGetChainStats: () => Promise<{ totalChains: number; totalLinks: number; avgChainLength: number }>;

      // WhisperWoof — Recurring capture
      whisperwoofGetSchedules: () => Promise<any[]>;
      whisperwoofAddSchedule: (config: { prompt: string; time: string; days?: number[]; templateId?: string; tagId?: string }) => Promise<{ success: boolean; schedule?: any; error?: string }>;
      whisperwoofUpdateSchedule: (id: string, updates: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
      whisperwoofRemoveSchedule: (id: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofGetSchedulePresets: () => Promise<Array<{ name: string; prompt: string; time: string; days: number[] }>>;

      // WhisperWoof — Smart reply
      whisperwoofDraftReply: (text: string, options?: { mode?: string; bundleId?: string }) => Promise<{ success: boolean; draft?: string; mode?: string; error?: string }>;
      whisperwoofIsReplyIntent: (text: string) => Promise<boolean>;
      whisperwoofGetReplyModes: () => Promise<Array<{ id: string; name: string }>>;

      // WhisperWoof — Entry templates
      whisperwoofGetTemplates: () => Promise<any[]>;
      whisperwoofCreateTemplate: (config: any) => Promise<{ success: boolean; template?: any; error?: string }>;
      whisperwoofDeleteTemplate: (id: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofRenderTemplate: (templateId: string, values: Record<string, string>) => Promise<{ success: boolean; output?: string; error?: string }>;
      whisperwoofGetNextSection: (templateId: string, filledSections: Record<string, string>) => Promise<{ id: string; label: string; prompt: string; required: boolean } | null>;

      // WhisperWoof — Semantic search
      whisperwoofSemanticSearch: (query: string, options?: { limit?: number; minScore?: number; days?: number }) => Promise<Array<{ id: string; text: string; score: number; source: string; createdAt: string }>>;
      whisperwoofFindSimilar: (entryId: string, options?: { limit?: number }) => Promise<Array<{ id: string; text: string; score: number; source: string; createdAt: string }>>;

      // WhisperWoof — Auto-tagging
      whisperwoofAutoTag: (text: string, existingTagNames?: string[], options?: { useLlm?: boolean }) => Promise<{ tags: string[]; source: string; suggestions?: any[]; error?: string }>;
      whisperwoofSuggestTagsKeywords: (text: string, existingTagNames?: string[]) => Promise<Array<{ tag: string; score: number; matchedKeywords: string[]; source: string }>>;

      // WhisperWoof — Daily digest
      whisperwoofCreateDigest: (options?: { days?: number }) => Promise<{ success: boolean; digest?: any; error?: string }>;
      whisperwoofGetDigestHistory: (limit?: number) => Promise<any[]>;
      whisperwoofGetTodayEntriesCount: () => Promise<number>;

      // WhisperWoof — Webhooks
      whisperwoofGetWebhooks: () => Promise<any[]>;
      whisperwoofAddWebhook: (config: { url: string; name?: string; enabled?: boolean; secret?: string; sources?: string[]; tags?: string[]; projects?: string[] }) => Promise<{ success: boolean; webhook?: any; error?: string }>;
      whisperwoofUpdateWebhook: (id: string, updates: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
      whisperwoofRemoveWebhook: (id: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofTestWebhook: (id: string) => Promise<{ success: boolean; statusCode?: number; durationMs?: number; error?: string }>;
      whisperwoofGetDeliveryLog: (limit?: number) => Promise<any[]>;

      // WhisperWoof — Keybinding customization
      whisperwoofGetKeybindings: () => Promise<Array<{ actionId: string; key: string; label: string; category: string; isCustom: boolean; defaultKey: string }>>;
      whisperwoofRebindAction: (actionId: string, newKey: string) => Promise<{ success: boolean; error?: string; conflict?: string }>;
      whisperwoofResetKeybinding: (actionId: string) => Promise<{ success: boolean; key?: string; error?: string }>;
      whisperwoofResetAllKeybindings: () => Promise<{ success: boolean }>;
      whisperwoofExportKeybindings: () => Promise<any>;
      whisperwoofImportKeybindings: (data: any) => Promise<{ success: boolean; imported?: number; errors?: string[]; error?: string }>;
      whisperwoofGetKeybindingCategories: () => Promise<Array<{ id: string; name: string; description: string }>>;

      // WhisperWoof — Privacy lock
      whisperwoofPrivacyEnable: (options?: { lockedBy?: string }) => Promise<{ success: boolean; alreadyLocked?: boolean; error?: string }>;
      whisperwoofPrivacyDisable: () => Promise<{ success: boolean; alreadyUnlocked?: boolean; durationMin?: number; error?: string }>;
      whisperwoofPrivacyState: () => Promise<{ locked: boolean; lockedAt: string | null; lockedBy: string | null; autoLockOnBattery: boolean; autoLockOnVpn: boolean; durationMin: number }>;
      whisperwoofPrivacyCheckUrl: (url: string) => Promise<boolean>;
      whisperwoofPrivacyCheckProvider: (providerId: string) => Promise<boolean>;
      whisperwoofPrivacyOverrides: () => Promise<{ provider: string; useLocalWhisper: boolean; cloudSttDisabled: boolean; telegramSyncPaused: boolean; analyticsDisabled: boolean; pluginNetworkBlocked: boolean } | null>;
      whisperwoofPrivacySettings: (updates: { autoLockOnBattery?: boolean; autoLockOnVpn?: boolean; networkBlockList?: string[] }) => Promise<{ success: boolean; error?: string }>;

      // WhisperWoof — Entry tagging
      whisperwoofGetTags: () => Promise<Array<{ id: string; name: string; color: string; createdAt: string; entryCount: number }>>;
      whisperwoofCreateTag: (name: string, color?: string) => Promise<{ success: boolean; tag?: any; error?: string }>;
      whisperwoofUpdateTag: (id: string, updates: { name?: string; color?: string }) => Promise<{ success: boolean; error?: string }>;
      whisperwoofDeleteTag: (id: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofAddTagToEntry: (entryId: string, tagId: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofRemoveTagFromEntry: (entryId: string, tagId: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofGetEntryTags: (entryId: string) => Promise<Array<{ id: string; name: string; color: string }>>;
      whisperwoofGetEntriesByTag: (tagId: string, limit?: number) => Promise<any[]>;
      whisperwoofBulkTagEntries: (entryIds: string[], tagId: string) => Promise<{ success: boolean; tagged?: number; error?: string }>;
      whisperwoofGetTagStats: () => Promise<{ totalTags: number; totalTaggings: number; taggedEntries: number; untaggedCount: number; topTags: Array<{ name: string; color: string; count: number }> }>;

      // WhisperWoof — Vibe coding
      whisperwoofGetCodingPrompt: (bundleId: string, spokenText: string) => Promise<{ prompt: string | null; mode: 'code' | 'shell' | 'prose' }>;

      // WhisperWoof — Custom vocabulary
      whisperwoofGetVocabulary: (options?: { category?: string; search?: string; sortBy?: string }) => Promise<Array<{ id: string; word: string; category: string; alternatives: string[]; createdAt: string; source: string; usageCount: number }>>;
      whisperwoofAddWord: (word: string, options?: { category?: string; alternatives?: string[]; source?: string }) => Promise<{ success: boolean; entry?: any; error?: string }>;
      whisperwoofUpdateWord: (id: string, updates: { word?: string; category?: string; alternatives?: string[] }) => Promise<{ success: boolean; error?: string }>;
      whisperwoofRemoveWord: (id: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofImportWords: (words: Array<string | { word: string; category?: string; alternatives?: string[] }>, category?: string) => Promise<{ success: boolean; added?: number; total?: number; error?: string }>;
      whisperwoofGetVocabularyStats: () => Promise<{ total: number; max: number; categories: Record<string, number>; topUsed: Array<{ word: string; usageCount: number }> }>;
      whisperwoofGetSttHints: () => Promise<string[]>;

      // WhisperWoof — Backtrack correction
      whisperwoofDetectBacktrack: (text: string) => Promise<{ hasBacktrack: boolean; signals: string[] }>;

      // WhisperWoof — Telegram companion
      whisperwoofTelegramSyncStatus: () => Promise<{ running: boolean; inboxPath: string; inboxExists: boolean; pending: number; total: number }>;
      whisperwoofTelegramImportNow: () => Promise<{ success: boolean; imported?: number; error?: string }>;

      // WhisperWoof — Voice snippets
      whisperwoofGetSnippets: () => Promise<Array<{ id: string; trigger: string; body: string; createdAt: string; usageCount: number }>>;
      whisperwoofAddSnippet: (trigger: string, body: string) => Promise<{ success: boolean; snippet?: any; error?: string }>;
      whisperwoofUpdateSnippet: (id: string, updates: { trigger?: string; body?: string }) => Promise<{ success: boolean; error?: string }>;
      whisperwoofRemoveSnippet: (id: string) => Promise<{ success: boolean; error?: string }>;
      whisperwoofExpandSnippet: (text: string) => Promise<{ matched: boolean; trigger: string; body: string; matchType: string } | null>;

      // WhisperWoof — Adaptive style learning
      whisperwoofGetStyleStats: () => Promise<{ exampleCount: number; maxExamples: number; oldestExample: string | null; newestExample: string | null }>;
      whisperwoofClearStyleExamples: () => Promise<{ success: boolean }>;
      whisperwoofGetStyleExamples: () => Promise<Array<{ polished: string; edited: string; timestamp: string; editRatio: number }>>;

      // WhisperWoof — LLM providers (BYOM)
      whisperwoofGetProviders: () => Promise<Array<{ id: string; name: string; description: string; requiresApiKey: boolean; defaultModel: string; models: string[] }>>;

      // WhisperWoof — Voice editing commands
      whisperwoofVoiceCommand: (spokenText: string, selectedText: string, options?: Record<string, unknown>) => Promise<{ success: boolean; text?: string; isCommand: boolean; command?: string; error?: string }>;
      whisperwoofDetectVoiceCommand: (spokenText: string) => Promise<{ isCommand: boolean; command: string | null }>;
      whisperwoofGetVoiceCommands: () => Promise<Array<{ id: string; example: string }>>;

      // WhisperWoof — Context-aware polish
      whisperwoofDetectContext: () => Promise<{ app: { bundleId: string; name: string } | null; preset: string | null }>;
      whisperwoofGetAppPresetMap: () => Promise<Record<string, string>>;
      whisperwoofSetAppPreset: (bundleId: string, presetId: string | null) => Promise<{ success: boolean }>;

      // WhisperWoof — Plugins
      whisperwoofGetPlugins: () => Promise<any[]>;
      whisperwoofUpdatePlugin: (id: string, updates: Record<string, unknown>) => Promise<any>;
      whisperwoofAddPlugin: (config: Record<string, unknown>) => Promise<any>;
      whisperwoofRemovePlugin: (id: string) => Promise<{ success: boolean }>;

      // WhisperWoof — Project → MCP dispatch
      whisperwoofUpdateProjectIntegration: (projectId: string, pluginId: string | null) => Promise<any>;
      whisperwoofGetProjectIntegration: (projectId: string) => Promise<string | null>;
      whisperwoofDispatchEntry: (entryId: string, pluginId: string, text: string) => Promise<{ success: boolean; message?: string; error?: string }>;
    };

    api?: {
      sendDebugLog: (message: string) => void;
    };
  }
}
