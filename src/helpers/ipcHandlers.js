const { ipcMain, app, shell, BrowserWindow, systemPreferences } = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const debugLogger = require("./debugLogger");
const GnomeShortcutManager = require("./gnomeShortcut");
const HyprlandShortcutManager = require("./hyprlandShortcut");
const AssemblyAiStreaming = require("./assemblyAiStreaming");
const { i18nMain, changeLanguage } = require("./i18nMain");
const DeepgramStreaming = require("./deepgramStreaming");
const OpenAIRealtimeStreaming = require("./openaiRealtimeStreaming");
const AudioStorageManager = require("./audioStorage");
const MeetingAudioBuffer = require("./meetingAudioBuffer");
const MeetingTranscriptCheckpoint = require("./meetingTranscriptCheckpoint");

const MISTRAL_TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";

// Debounce delay: wait for user to stop typing before processing corrections
const AUTO_LEARN_DEBOUNCE_MS = 1500;

const AUDIO_MIME_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  const boundary = `----OpenWhispr${Date.now()}`;
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(fileBuffer);
  parts.push("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    if (value != null) {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      );
    }
  }

  parts.push(`--${boundary}--\r\n`);

  const bodyParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
  return { body: Buffer.concat(bodyParts), boundary };
}

function postMultipart(url, body, boundary, headers = {}) {
  const httpModule = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = httpModule.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          ...headers,
        },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(responseData) });
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${responseData.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.whisperManager = managers.whisperManager;
    this.parakeetManager = managers.parakeetManager;
    this.windowManager = managers.windowManager;
    this.updateManager = managers.updateManager;
    this.windowsKeyManager = managers.windowsKeyManager;
    this.textEditMonitor = managers.textEditMonitor;
    this.getTrayManager = managers.getTrayManager;
    this.whisperCudaManager = managers.whisperCudaManager;
    this.googleCalendarManager = managers.googleCalendarManager;
    this.meetingDetectionEngine = managers.meetingDetectionEngine;
    this.audioTapManager = managers.audioTapManager;
    this.sessionId = crypto.randomUUID();
    this.assemblyAiStreaming = null;
    this.deepgramStreaming = null;
    this._dictationStreaming = null;
    this._meetingMicStreaming = null;
    this._meetingSystemStreaming = null;
    this._autoLearnEnabled = true; // Default on, synced from renderer
    this._autoLearnDebounceTimer = null;
    this._autoLearnLatestData = null;
    this._textEditHandler = null;
    this._activeRecordingPipeline = null;
    this.audioStorageManager = new AudioStorageManager();
    this._meetingAudioBuffer = new MeetingAudioBuffer();
    this._meetingTranscriptCheckpoint = new MeetingTranscriptCheckpoint({
      databaseManager: this.databaseManager,
    });
    this._meetingSessionRotationTimer = null;
    this._meetingReconnecting = {};
    this._audioCleanupInterval = null;
    this._setupTextEditMonitor();
    this._setupAudioCleanup();
    this.setupHandlers();

    if (this.whisperManager?.serverManager) {
      this.whisperManager.serverManager.on("cuda-fallback", () => {
        this.broadcastToWindows("cuda-fallback-notification", {});
      });
    }
  }

  _getDictionarySafe() {
    try {
      return this.databaseManager.getDictionary();
    } catch {
      return [];
    }
  }

  _cleanupTextEditMonitor() {
    if (this._autoLearnDebounceTimer) {
      clearTimeout(this._autoLearnDebounceTimer);
      this._autoLearnDebounceTimer = null;
    }
    this._autoLearnLatestData = null;
    if (this.textEditMonitor && this._textEditHandler) {
      this.textEditMonitor.removeListener("text-edited", this._textEditHandler);
      this._textEditHandler = null;
    }
  }

  _setupAudioCleanup() {
    const DEFAULT_RETENTION_DAYS = 30;
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    // Run initial cleanup with default retention
    try {
      this.audioStorageManager.cleanupExpiredAudio(DEFAULT_RETENTION_DAYS, this.databaseManager);
    } catch (error) {
      debugLogger.error("Initial audio cleanup failed", { error: error.message }, "audio-storage");
    }

    // Set up periodic cleanup every 6 hours
    this._audioCleanupInterval = setInterval(() => {
      try {
        this.audioStorageManager.cleanupExpiredAudio(DEFAULT_RETENTION_DAYS, this.databaseManager);
      } catch (error) {
        debugLogger.error(
          "Periodic audio cleanup failed",
          { error: error.message },
          "audio-storage"
        );
      }
    }, SIX_HOURS_MS);
  }

  _setupTextEditMonitor() {
    if (!this.textEditMonitor) return;

    this._textEditHandler = (data) => {
      if (
        !data ||
        typeof data.originalText !== "string" ||
        typeof data.newFieldValue !== "string"
      ) {
        debugLogger.debug("[AutoLearn] Invalid event payload, skipping");
        return;
      }

      const { originalText, newFieldValue } = data;

      debugLogger.debug("[AutoLearn] text-edited event", {
        originalPreview: originalText.substring(0, 80),
        newValuePreview: newFieldValue.substring(0, 80),
      });

      this._autoLearnLatestData = { originalText, newFieldValue };

      if (this._autoLearnDebounceTimer) {
        clearTimeout(this._autoLearnDebounceTimer);
      }

      this._autoLearnDebounceTimer = setTimeout(() => {
        this._processCorrections();
      }, AUTO_LEARN_DEBOUNCE_MS);
    };

    this.textEditMonitor.on("text-edited", this._textEditHandler);
  }

  async _processCorrections() {
    this._autoLearnDebounceTimer = null;
    if (!this._autoLearnLatestData) return;
    if (!this._autoLearnEnabled) {
      debugLogger.debug("[AutoLearn] Disabled, skipping correction processing");
      this._autoLearnLatestData = null;
      return;
    }

    const { originalText, newFieldValue } = this._autoLearnLatestData;
    this._autoLearnLatestData = null;

    // Detect active app for context-aware Memory tagging
    let bundleId = null;
    try {
      const { detectActiveApp } = require("../whisperwoof/bridge/context-detector");
      const app = await detectActiveApp();
      bundleId = app?.bundleId ?? null;
    } catch {
      // Context detection is optional, proceed without it
    }

    try {
      const { extractCorrections } = require("../utils/correctionLearner");
      const currentDict = this._getDictionarySafe();
      const corrections = extractCorrections(originalText, newFieldValue, currentDict);
      debugLogger.debug("[AutoLearn] Corrections result", {
        corrections,
        dictSize: currentDict.length,
        bundleId,
      });

      if (corrections.length > 0) {
        const updatedDict = [...currentDict, ...corrections];
        const saveResult = this.databaseManager.setDictionary(updatedDict);

        if (saveResult?.success === false) {
          debugLogger.debug("[AutoLearn] Failed to save dictionary", { error: saveResult.error });
          return;
        }

        this.broadcastToWindows("dictionary-updated", updatedDict);

        // WhisperWoof Memory: also save to context-aware vocabulary
        try {
          const { addWord } = require("../whisperwoof/bridge/vocabulary");
          for (const word of corrections) {
            addWord(word, { source: "auto-learn", category: "general", bundleId });
          }
          debugLogger.debug("[AutoLearn] Saved to Memory vocabulary", { count: corrections.length, bundleId });
        } catch (vocabErr) {
          debugLogger.debug("[AutoLearn] Memory vocabulary save failed", { error: vocabErr.message });
        }

        // Show the overlay so the toast is visible (it may have been hidden after dictation)
        this.windowManager.showDictationPanel();
        this.broadcastToWindows("corrections-learned", corrections);
        debugLogger.debug("[AutoLearn] Saved corrections", { corrections });
      }
    } catch (error) {
      debugLogger.debug("[AutoLearn] Error processing corrections", { error: error.message });
    }

    // WhisperWoof: Record style example for adaptive polish learning
    try {
      const { recordStyleExample } = require("../whisperwoof/bridge/style-learner");
      recordStyleExample(originalText, newFieldValue);
    } catch (styleError) {
      debugLogger.debug("[WhisperWoof] Style learning failed", { error: styleError.message });
    }
  }

  _syncStartupEnv(setVars, clearVars = []) {
    let changed = false;
    for (const [key, value] of Object.entries(setVars)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
        changed = true;
      }
    }
    for (const key of clearVars) {
      if (process.env[key]) {
        delete process.env[key];
        changed = true;
      }
    }
    if (changed) {
      debugLogger.info("Synced startup env vars", {
        set: Object.keys(setVars),
        cleared: clearVars.filter((k) => !process.env[k]),
      });
      // Surface persistence failures: when the userData .env can't be written,
      // every subsequent app launch loses pre-warm because main.js boot relies
      // on REASONING_PROVIDER / LOCAL_REASONING_MODEL being present. Silent
      // catch hid this for weeks — see 2026-05-17 audit.
      this.environmentManager.saveAllKeysToEnvFile().catch((err) => {
        debugLogger.warn("Failed to persist startup env vars to userData .env", {
          error: err && err.message ? err.message : String(err),
          keys: Object.keys(setVars),
        });
      });
    }
  }

  setupHandlers() {
    ipcMain.handle("window-minimize", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.minimize();
      }
    });

    ipcMain.handle("window-maximize", () => {
      if (this.windowManager.controlPanelWindow) {
        if (this.windowManager.controlPanelWindow.isMaximized()) {
          this.windowManager.controlPanelWindow.unmaximize();
        } else {
          this.windowManager.controlPanelWindow.maximize();
        }
      }
    });

    ipcMain.handle("window-close", () => {
      if (this.windowManager.controlPanelWindow) {
        this.windowManager.controlPanelWindow.close();
      }
    });

    ipcMain.handle("window-is-maximized", () => {
      if (this.windowManager.controlPanelWindow) {
        return this.windowManager.controlPanelWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("restore-from-meeting-mode", () => {
      this.windowManager.restoreControlPanelFromMeetingMode();
      this.meetingDetectionEngine?.setMeetingModeActive(false);
    });

    ipcMain.handle("app-quit", () => {
      app.quit();
    });

    ipcMain.handle("hide-window", () => {
      if (process.platform === "darwin") {
        this.windowManager.hideDictationPanel();
        if (app.dock) app.dock.show();
      } else {
        this.windowManager.hideDictationPanel();
      }
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel();
    });

    ipcMain.handle("force-stop-dictation", () => {
      if (this.windowManager?.forceStopMacCompoundPush) {
        this.windowManager.forceStopMacCompoundPush("manual");
      }
      return { success: true };
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    ipcMain.handle("resize-main-window", (event, sizeKey) => {
      return this.windowManager.resizeMainWindow(sizeKey);
    });

    ipcMain.handle("get-openai-key", async (event) => {
      return this.environmentManager.getOpenAIKey();
    });

    ipcMain.handle("save-openai-key", async (event, key) => {
      return this.environmentManager.saveOpenAIKey(key);
    });

    ipcMain.handle("create-production-env-file", async (event, apiKey) => {
      return this.environmentManager.createProductionEnvFile(apiKey);
    });

    ipcMain.handle("db-save-transcription", async (event, text, rawText, options) => {
      const result = this.databaseManager.saveTranscription(text, rawText, options);
      if (result?.success && result?.transcription) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-added", result.transcription);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
      return this.databaseManager.getTranscriptions(limit);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      this.audioStorageManager.deleteAllAudio();
      const result = this.databaseManager.clearTranscriptions();
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcriptions-cleared", {
            cleared: result.cleared,
          });
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      this.audioStorageManager.deleteAudio(id);
      const result = this.databaseManager.deleteTranscription(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-deleted", { id });
        });
      }
      return result;
    });

    // Audio storage handlers
    ipcMain.handle("save-transcription-audio", async (event, id, audioBuffer, metadata) => {
      const transcription = this.databaseManager.getTranscriptionById(id);
      const timestamp = transcription?.timestamp || null;
      const result = this.audioStorageManager.saveAudio(id, Buffer.from(audioBuffer), timestamp);
      if (result.success) {
        this.databaseManager.updateTranscriptionAudio(id, {
          hasAudio: 1,
          audioDurationMs: metadata?.durationMs || null,
          provider: metadata?.provider || null,
          model: metadata?.model || null,
        });
      }
      return result;
    });

    ipcMain.handle("get-audio-path", async (event, id) => {
      return this.audioStorageManager.getAudioPath(id);
    });

    ipcMain.handle("show-audio-in-folder", async (event, id) => {
      const filePath = this.audioStorageManager.getAudioPath(id);
      if (!filePath) return { success: false };
      shell.showItemInFolder(filePath);
      return { success: true };
    });

    ipcMain.handle("get-audio-buffer", async (event, id) => {
      const buffer = this.audioStorageManager.getAudioBuffer(id);
      return buffer ? buffer.buffer : null;
    });

    ipcMain.handle("delete-transcription-audio", async (event, id) => {
      const result = this.audioStorageManager.deleteAudio(id);
      if (result.success) {
        this.databaseManager.updateTranscriptionAudio(id, {
          hasAudio: 0,
          audioDurationMs: null,
          provider: null,
          model: null,
        });
      }
      return result;
    });

    ipcMain.handle("get-audio-storage-usage", async () => {
      return this.audioStorageManager.getStorageUsage();
    });

    ipcMain.handle("delete-all-audio", async () => {
      const result = this.audioStorageManager.deleteAllAudio();
      try {
        const rows = this.databaseManager.db
          .prepare("SELECT id FROM transcriptions WHERE has_audio = 1")
          .all();
        if (rows.length > 0) {
          this.databaseManager.clearAudioFlags(rows.map((r) => r.id));
        }
      } catch (error) {
        debugLogger.error(
          "Failed to clear audio flags after delete-all",
          { error: error.message },
          "audio-storage"
        );
      }
      return result;
    });

    ipcMain.handle("get-transcription-by-id", async (event, id) => {
      return this.databaseManager.getTranscriptionById(id);
    });

    // Dictionary handlers
    ipcMain.on("auto-learn-changed", (_event, enabled) => {
      this._autoLearnEnabled = !!enabled;
      if (!this._autoLearnEnabled) {
        if (this._autoLearnDebounceTimer) {
          clearTimeout(this._autoLearnDebounceTimer);
          this._autoLearnDebounceTimer = null;
        }
        this._autoLearnLatestData = null;
      }
      debugLogger.debug("[AutoLearn] Setting changed", { enabled: this._autoLearnEnabled });
    });

    ipcMain.handle("db-get-dictionary", async () => {
      return this.databaseManager.getDictionary();
    });

    ipcMain.handle("db-set-dictionary", async (event, words) => {
      if (!Array.isArray(words)) {
        throw new Error("words must be an array");
      }
      return this.databaseManager.setDictionary(words);
    });

    ipcMain.handle("undo-learned-corrections", async (_event, words) => {
      try {
        if (!Array.isArray(words) || words.length === 0) {
          return { success: false };
        }
        const validWords = words.filter((w) => typeof w === "string" && w.trim().length > 0);
        if (validWords.length === 0) {
          return { success: false };
        }
        const currentDict = this._getDictionarySafe();
        const removeSet = new Set(validWords.map((w) => w.toLowerCase()));
        const updatedDict = currentDict.filter((w) => !removeSet.has(w.toLowerCase()));
        const saveResult = this.databaseManager.setDictionary(updatedDict);
        if (saveResult?.success === false) {
          debugLogger.debug("[AutoLearn] Undo failed to save dictionary", {
            error: saveResult.error,
          });
          return { success: false };
        }
        this.broadcastToWindows("dictionary-updated", updatedDict);
        debugLogger.debug("[AutoLearn] Undo: removed words", { words: validWords });
        return { success: true };
      } catch (err) {
        debugLogger.debug("[AutoLearn] Undo failed", { error: err.message });
        return { success: false };
      }
    });

    ipcMain.handle(
      "db-save-note",
      async (event, title, content, noteType, sourceFile, audioDuration, folderId) => {
        const result = this.databaseManager.saveNote(
          title,
          content,
          noteType,
          sourceFile,
          audioDuration,
          folderId
        );
        if (result?.success && result?.note) {
          setImmediate(() => {
            this.broadcastToWindows("note-added", result.note);
          });
        }
        return result;
      }
    );

    ipcMain.handle("db-get-note", async (event, id) => {
      return this.databaseManager.getNote(id);
    });

    ipcMain.handle("db-get-notes", async (event, noteType, limit, folderId) => {
      return this.databaseManager.getNotes(noteType, limit, folderId);
    });

    ipcMain.handle("db-update-note", async (event, id, updates) => {
      const result = this.databaseManager.updateNote(id, updates);
      if (result?.success && result?.note) {
        setImmediate(() => {
          this.broadcastToWindows("note-updated", result.note);
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-note", async (event, id) => {
      const result = this.databaseManager.deleteNote(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("note-deleted", { id });
        });
      }
      return result;
    });

    ipcMain.handle("db-search-notes", async (event, query, limit) => {
      return this.databaseManager.searchNotes(query, limit);
    });

    ipcMain.handle("db-update-note-cloud-id", async (event, id, cloudId) => {
      return this.databaseManager.updateNoteCloudId(id, cloudId);
    });

    ipcMain.handle("db-get-folders", async () => {
      return this.databaseManager.getFolders();
    });

    ipcMain.handle("db-create-folder", async (event, name) => {
      const result = this.databaseManager.createFolder(name);
      if (result?.success && result?.folder) {
        setImmediate(() => {
          this.broadcastToWindows("folder-created", result.folder);
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-folder", async (event, id) => {
      const result = this.databaseManager.deleteFolder(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("folder-deleted", { id });
        });
      }
      return result;
    });

    ipcMain.handle("db-rename-folder", async (event, id, name) => {
      const result = this.databaseManager.renameFolder(id, name);
      if (result?.success && result?.folder) {
        setImmediate(() => {
          this.broadcastToWindows("folder-renamed", result.folder);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-folder-note-counts", async () => {
      return this.databaseManager.getFolderNoteCounts();
    });

    ipcMain.handle("db-get-actions", async () => {
      return this.databaseManager.getActions();
    });

    ipcMain.handle("db-get-action", async (event, id) => {
      return this.databaseManager.getAction(id);
    });

    ipcMain.handle("db-create-action", async (event, name, description, prompt, icon) => {
      const result = this.databaseManager.createAction(name, description, prompt, icon);
      if (result?.success && result?.action) {
        setImmediate(() => {
          this.broadcastToWindows("action-created", result.action);
        });
      }
      return result;
    });

    ipcMain.handle("db-update-action", async (event, id, updates) => {
      const result = this.databaseManager.updateAction(id, updates);
      if (result?.success && result?.action) {
        setImmediate(() => {
          this.broadcastToWindows("action-updated", result.action);
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-action", async (event, id) => {
      const result = this.databaseManager.deleteAction(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("action-deleted", { id });
        });
      }
      return result;
    });

    // Agent conversation handlers
    ipcMain.handle("db-create-agent-conversation", async (event, title) => {
      return this.databaseManager.createAgentConversation(title);
    });

    ipcMain.handle("db-get-agent-conversations", async (event, limit) => {
      return this.databaseManager.getAgentConversations(limit);
    });

    ipcMain.handle("db-get-agent-conversation", async (event, id) => {
      return this.databaseManager.getAgentConversation(id);
    });

    ipcMain.handle("db-delete-agent-conversation", async (event, id) => {
      return this.databaseManager.deleteAgentConversation(id);
    });

    ipcMain.handle("db-update-agent-conversation-title", async (event, id, title) => {
      return this.databaseManager.updateAgentConversationTitle(id, title);
    });

    ipcMain.handle("db-add-agent-message", async (event, conversationId, role, content) => {
      return this.databaseManager.addAgentMessage(conversationId, role, content);
    });

    ipcMain.handle("db-get-agent-messages", async (event, conversationId) => {
      return this.databaseManager.getAgentMessages(conversationId);
    });

    ipcMain.handle("export-note", async (event, noteId, format) => {
      try {
        const note = this.databaseManager.getNote(noteId);
        if (!note) return { success: false, error: "Note not found" };

        const { dialog } = require("electron");
        const fs = require("fs");
        const ext = format === "txt" ? "txt" : "md";
        const safeName = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-");

        const result = await dialog.showSaveDialog({
          defaultPath: `${safeName}.${ext}`,
          filters: [
            { name: "Markdown", extensions: ["md"] },
            { name: "Text", extensions: ["txt"] },
          ],
        });

        if (result.canceled || !result.filePath) return { success: false };

        let exportContent;
        if (format === "txt") {
          exportContent = (note.content || "")
            .replace(/#{1,6}\s+/g, "")
            .replace(/[*_~`]+/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
            .replace(/^>\s+/gm, "")
            .trim();
        } else {
          exportContent = note.enhanced_content || note.content;
        }

        fs.writeFileSync(result.filePath, exportContent, "utf-8");
        return { success: true };
      } catch (error) {
        debugLogger.error("Error exporting note", { error: error.message }, "notes");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("select-audio-file", async () => {
      const { dialog } = require("electron");
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
          { name: "Audio Files", extensions: ["mp3", "wav", "m4a", "webm", "ogg", "flac", "aac"] },
        ],
      });
      if (result.canceled || !result.filePaths.length) {
        return { canceled: true };
      }
      return { canceled: false, filePath: result.filePaths[0] };
    });

    ipcMain.handle("get-file-size", async (_event, filePath) => {
      const fs = require("fs");
      try {
        // WhisperWoof security: validate path is not traversing outside expected directories
        const resolved = path.resolve(filePath);
        const userDataDir = app.getPath("userData");
        const homeDir = app.getPath("home");
        // Allow files in user data dir, home dir, or paths from file dialog (absolute)
        if (!resolved.startsWith(userDataDir) && !resolved.startsWith(homeDir)) {
          debugLogger.warn("get-file-size: blocked path outside home directory", { filePath: resolved });
          return 0;
        }
        const stats = fs.statSync(resolved);
        return stats.size;
      } catch {
        return 0;
      }
    });

    ipcMain.handle("transcribe-audio-file", async (event, filePath, options = {}) => {
      const fs = require("fs");
      try {
        // WhisperWoof security: validate file path and size
        const resolved = path.resolve(filePath);
        const homeDir = app.getPath("home");
        if (!resolved.startsWith(homeDir)) {
          return { success: false, error: "File path outside home directory" };
        }
        const stats = fs.statSync(resolved);
        const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB max for local transcription
        if (stats.size > MAX_FILE_SIZE) {
          return { success: false, error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum is 500MB.` };
        }
        const audioBuffer = fs.readFileSync(resolved);
        if (options.provider === "nvidia") {
          const result = await this.parakeetManager.transcribeLocalParakeet(audioBuffer, options);
          return result;
        }
        const result = await this.whisperManager.transcribeLocalWhisper(audioBuffer, options);
        return result;
      } catch (error) {
        debugLogger.error("Audio file transcription error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("paste-text", async (event, text, options) => {
      // The paste keystroke is delivered session-wide, so it only lands in the
      // right field when the captured target app is frontmost (#668). Explicitly
      // activate it; Chromium/Electron targets (e.g. Claude Desktop) don't
      // reliably reclaim key-window status from hide()'s implicit hand-off.
      let activated = false;
      if (process.platform === "darwin" && this.textEditMonitor) {
        activated = await this.textEditMonitor.activateTargetPid();
      }
      // Fallback: if activation didn't run (no PID captured) and the floating
      // dictation panel has focus, dismiss it so the keystroke lands in the
      // user's target app instead of the overlay.
      const mainWindow = this.windowManager?.mainWindow;
      if (!activated && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
        if (process.platform === "darwin") {
          // hide() forces macOS to activate the previous app; showInactive()
          // restores the overlay without stealing focus.
          mainWindow.hide();
          await new Promise((resolve) => setTimeout(resolve, 120));
          mainWindow.showInactive();
        } else {
          mainWindow.blur();
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      }
      const result = await this.clipboardManager.pasteText(text, {
        ...options,
        webContents: event.sender,
      });
      const targetPid = this.textEditMonitor?.lastTargetPid || null;
      debugLogger.debug("[AutoLearn] Paste completed", {
        autoLearnEnabled: this._autoLearnEnabled,
        hasMonitor: !!this.textEditMonitor,
        targetPid,
      });
      if (this.textEditMonitor && this._autoLearnEnabled) {
        setTimeout(() => {
          try {
            debugLogger.debug("[AutoLearn] Starting monitoring", {
              textPreview: text.substring(0, 80),
            });
            this.textEditMonitor.startMonitoring(text, 30000, { targetPid });
          } catch (err) {
            debugLogger.debug("[AutoLearn] Failed to start monitoring", { error: err.message });
          }
        }, 500);
      }
      return result;
    });

    ipcMain.handle("check-accessibility-permission", async (_event, silent = false) => {
      return this.clipboardManager.checkAccessibilityPermissions(silent);
    });

    // Passes `true` to isTrustedAccessibilityClient to trigger the macOS system prompt
    ipcMain.handle("prompt-accessibility-permission", async () => {
      if (process.platform !== "darwin") return true;
      return systemPreferences.isTrustedAccessibilityClient(true);
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text, event.sender);
    });

    ipcMain.handle("check-paste-tools", async () => {
      return this.clipboardManager.checkPasteTools();
    });

    ipcMain.handle("transcribe-local-whisper", async (event, audioBlob, options = {}) => {
      debugLogger.log("transcribe-local-whisper called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.whisperManager.transcribeLocalWhisper(audioBlob, options);

        debugLogger.log("Whisper result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        // Check if no audio was detected and send appropriate event
        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local Whisper transcription error", error);
        const errorMessage = error.message || "Unknown error";

        // Return specific error types for better user feedback
        if (errorMessage.includes("FFmpeg not found")) {
          return {
            success: false,
            error: "ffmpeg_not_found",
            message: "FFmpeg is missing. Please reinstall the app or install FFmpeg manually.",
          };
        }
        if (
          errorMessage.includes("FFmpeg conversion failed") ||
          errorMessage.includes("FFmpeg process error")
        ) {
          return {
            success: false,
            error: "ffmpeg_error",
            message: "Audio conversion failed. The recording may be corrupted.",
          };
        }
        if (
          errorMessage.includes("whisper.cpp not found") ||
          errorMessage.includes("whisper-cpp")
        ) {
          return {
            success: false,
            error: "whisper_not_found",
            message: "Whisper binary is missing. Please reinstall the app.",
          };
        }
        if (
          errorMessage.includes("Audio buffer is empty") ||
          errorMessage.includes("Audio data too small")
        ) {
          return {
            success: false,
            error: "no_audio_data",
            message: "No audio detected",
          };
        }
        if (errorMessage.includes("model") && errorMessage.includes("not downloaded")) {
          // WhisperWoof: try auto-downloading the tiny model (75MB) before giving up
          try {
            debugLogger.log("[Whisper] Model missing — auto-downloading tiny model...");
            await this.whisperManager.downloadWhisperModel("tiny", (p) => {
              debugLogger.log(`[Whisper] Downloading tiny: ${Math.round(p.percentage || 0)}%`);
            });
            debugLogger.log("[Whisper] Tiny model downloaded, retrying...");
            const retryResult = await this.whisperManager.transcribeLocalWhisper(audioBlob, { ...options, model: "tiny" });
            return retryResult;
          } catch (dlErr) {
            debugLogger.log(`[Whisper] Auto-download failed: ${dlErr.message}`);
            return {
              success: false,
              error: "model_not_found",
              message: `No model available. Download one from Settings → Transcription.`,
            };
          }
        }

        throw error;
      }
    });

    ipcMain.handle("check-whisper-installation", async (event) => {
      return this.whisperManager.checkWhisperInstallation();
    });

    ipcMain.handle("get-audio-diagnostics", async () => {
      return this.whisperManager.getDiagnostics();
    });

    ipcMain.handle("download-whisper-model", async (event, modelName) => {
      try {
        const result = await this.whisperManager.downloadWhisperModel(modelName, (progressData) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("whisper-download-progress", progressData);
          }
        });
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("whisper-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-model-status", async (event, modelName) => {
      return this.whisperManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-whisper-models", async (event) => {
      return this.whisperManager.listWhisperModels();
    });

    ipcMain.handle("delete-whisper-model", async (event, modelName) => {
      return this.whisperManager.deleteWhisperModel(modelName);
    });

    ipcMain.handle("delete-all-whisper-models", async () => {
      return this.whisperManager.deleteAllWhisperModels();
    });

    ipcMain.handle("cancel-whisper-download", async (event) => {
      return this.whisperManager.cancelDownload();
    });

    ipcMain.handle("whisper-server-start", async (event, modelName) => {
      const useCuda =
        process.env.WHISPER_CUDA_ENABLED === "true" && this.whisperCudaManager?.isDownloaded();
      return this.whisperManager.startServer(modelName, { useCuda });
    });

    ipcMain.handle("whisper-server-stop", async () => {
      return this.whisperManager.stopServer();
    });

    ipcMain.handle("whisper-server-status", async () => {
      return this.whisperManager.getServerStatus();
    });

    ipcMain.handle("detect-gpu", async () => {
      const { detectNvidiaGpu } = require("../utils/gpuDetection");
      return detectNvidiaGpu();
    });

    ipcMain.handle("get-cuda-whisper-status", async () => {
      const { detectNvidiaGpu } = require("../utils/gpuDetection");
      const gpuInfo = await detectNvidiaGpu();
      if (!this.whisperCudaManager) {
        return { downloaded: false, downloading: false, path: null, gpuInfo };
      }
      return {
        downloaded: this.whisperCudaManager.isDownloaded(),
        downloading: this.whisperCudaManager.isDownloading(),
        path: this.whisperCudaManager.getCudaBinaryPath(),
        gpuInfo,
      };
    });

    ipcMain.handle("download-cuda-whisper-binary", async (event) => {
      if (!this.whisperCudaManager) {
        return { success: false, error: "CUDA not supported on this platform" };
      }
      try {
        await this.whisperCudaManager.download((progress) => {
          if (progress.type === "progress" && !event.sender.isDestroyed()) {
            event.sender.send("cuda-download-progress", {
              downloadedBytes: progress.downloaded_bytes,
              totalBytes: progress.total_bytes,
              percentage: progress.percentage,
            });
          }
        });
        this._syncStartupEnv({ WHISPER_CUDA_ENABLED: "true" });
        // Restart whisper-server so it picks up the CUDA binary
        await this.whisperManager.stopServer().catch(() => {});
        return { success: true };
      } catch (error) {
        debugLogger.error("CUDA binary download failed", {
          error: error.message,
          stack: error.stack,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-cuda-whisper-download", async () => {
      if (!this.whisperCudaManager) return { success: false };
      return this.whisperCudaManager.cancelDownload();
    });

    ipcMain.handle("delete-cuda-whisper-binary", async () => {
      if (!this.whisperCudaManager) return { success: false };
      const result = await this.whisperCudaManager.delete();
      if (result.success) {
        this._syncStartupEnv({}, ["WHISPER_CUDA_ENABLED"]);
        // Restart whisper-server so it falls back to CPU binary
        await this.whisperManager.stopServer().catch(() => {});
      }
      return result;
    });

    ipcMain.handle("check-ffmpeg-availability", async (event) => {
      return this.whisperManager.checkFFmpegAvailability();
    });

    ipcMain.handle("transcribe-local-parakeet", async (event, audioBlob, options = {}) => {
      debugLogger.log("transcribe-local-parakeet called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        options,
      });

      try {
        const result = await this.parakeetManager.transcribeLocalParakeet(audioBlob, options);

        debugLogger.log("Parakeet result", {
          success: result.success,
          hasText: !!result.text,
          message: result.message,
          error: result.error,
        });

        if (!result.success && result.message === "No audio detected") {
          debugLogger.log("Sending no-audio-detected event to renderer");
          event.sender.send("no-audio-detected");
        }

        return result;
      } catch (error) {
        debugLogger.error("Local Parakeet transcription error", error);
        const errorMessage = error.message || "Unknown error";

        if (errorMessage.includes("sherpa-onnx") && errorMessage.includes("not found")) {
          return {
            success: false,
            error: "parakeet_not_found",
            message: "Parakeet binary is missing. Please reinstall the app.",
          };
        }
        if (errorMessage.includes("model") && errorMessage.includes("not downloaded")) {
          return {
            success: false,
            error: "model_not_found",
            message: errorMessage,
          };
        }

        throw error;
      }
    });

    ipcMain.handle("check-parakeet-installation", async () => {
      return this.parakeetManager.checkInstallation();
    });

    ipcMain.handle("download-parakeet-model", async (event, modelName) => {
      try {
        const result = await this.parakeetManager.downloadParakeetModel(
          modelName,
          (progressData) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("parakeet-download-progress", progressData);
            }
          }
        );
        return result;
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("parakeet-download-progress", {
            type: "error",
            model: modelName,
            error: error.message,
            code: error.code || "DOWNLOAD_FAILED",
          });
        }
        return {
          success: false,
          error: error.message,
          code: error.code || "DOWNLOAD_FAILED",
        };
      }
    });

    ipcMain.handle("check-parakeet-model-status", async (_event, modelName) => {
      return this.parakeetManager.checkModelStatus(modelName);
    });

    ipcMain.handle("list-parakeet-models", async () => {
      return this.parakeetManager.listParakeetModels();
    });

    ipcMain.handle("delete-parakeet-model", async (_event, modelName) => {
      return this.parakeetManager.deleteParakeetModel(modelName);
    });

    ipcMain.handle("delete-all-parakeet-models", async () => {
      return this.parakeetManager.deleteAllParakeetModels();
    });

    ipcMain.handle("cancel-parakeet-download", async () => {
      return this.parakeetManager.cancelDownload();
    });

    ipcMain.handle("get-parakeet-diagnostics", async () => {
      return this.parakeetManager.getDiagnostics();
    });

    ipcMain.handle("parakeet-server-start", async (event, modelName) => {
      const result = await this.parakeetManager.startServer(modelName);
      process.env.LOCAL_TRANSCRIPTION_PROVIDER = "nvidia";
      process.env.PARAKEET_MODEL = modelName;
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("parakeet-server-stop", async () => {
      const result = await this.parakeetManager.stopServer();
      delete process.env.LOCAL_TRANSCRIPTION_PROVIDER;
      delete process.env.PARAKEET_MODEL;
      await this.environmentManager.saveAllKeysToEnvFile();
      return result;
    });

    ipcMain.handle("parakeet-server-status", async () => {
      return this.parakeetManager.getServerStatus();
    });

    ipcMain.handle("cleanup-app", async (event) => {
      const fs = require("fs");
      const os = require("os");
      const errors = [];
      const mainWindow = this.windowManager.mainWindow;

      // Stop services before deleting files they hold open
      try {
        await this.parakeetManager?.stopServer();
      } catch (e) {
        errors.push(`Parakeet stop: ${e.message}`);
      }
      try {
        this.whisperManager?.stopServer();
      } catch (e) {
        errors.push(`Whisper stop: ${e.message}`);
      }
      try {
        this.googleCalendarManager?.stop();
      } catch (e) {
        errors.push(`GCal stop: ${e.message}`);
      }

      // Revoke Google OAuth tokens before DB is closed
      try {
        await this.googleCalendarManager?.revokeAllTokens();
      } catch (e) {
        errors.push(`GCal revoke: ${e.message}`);
      }

      // Close DB connection before deleting the file
      try {
        this.databaseManager?.db?.close();
      } catch (e) {
        errors.push(`DB close: ${e.message}`);
      }

      // Delete audio files
      try {
        this.audioStorageManager.deleteAllAudio();
      } catch (e) {
        errors.push(`Audio delete: ${e.message}`);
      }

      // Delete downloaded models
      try {
        const whisperDir = path.join(os.homedir(), ".cache", "openwhispr", "whisper-models");
        if (fs.existsSync(whisperDir)) fs.rmSync(whisperDir, { recursive: true, force: true });
      } catch (e) {
        errors.push(`Whisper models: ${e.message}`);
      }
      try {
        await this.parakeetManager?.deleteAllParakeetModels();
      } catch (e) {
        errors.push(`Parakeet models: ${e.message}`);
      }
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteAllModels();
      } catch (e) {
        errors.push(`LLM models: ${e.message}`);
      }

      // Delete database file + WAL/SHM
      try {
        const dbPath = path.join(
          app.getPath("userData"),
          process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"
        );
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
        if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
      } catch (e) {
        errors.push(`DB file: ${e.message}`);
      }

      // Delete .env file
      try {
        const envPath = path.join(app.getPath("userData"), ".env");
        if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
      } catch (e) {
        errors.push(`Env file: ${e.message}`);
      }

      // Clear session cookies
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) await win.webContents.session.clearStorageData({ storages: ["cookies"] });
      } catch (e) {
        errors.push(`Cookies: ${e.message}`);
      }

      // Clear localStorage
      if (mainWindow?.webContents) {
        try {
          await mainWindow.webContents.executeJavaScript("localStorage.clear()");
        } catch (e) {
          errors.push(`localStorage: ${e.message}`);
        }
      }

      if (errors.length > 0) {
        debugLogger.warn("Cleanup completed with errors", { errors }, "cleanup");
      }

      return { success: errors.length === 0, message: "Cleanup completed", errors };
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      return await this.windowManager.updateHotkey(hotkey);
    });

    ipcMain.handle("set-hotkey-listening-mode", async (event, enabled, newHotkey = null) => {
      this.windowManager.setHotkeyListeningMode(enabled);
      const hotkeyManager = this.windowManager.hotkeyManager;

      // When exiting capture mode with a new hotkey, use that to avoid reading stale state
      const effectiveHotkey = !enabled && newHotkey ? newHotkey : hotkeyManager.getCurrentHotkey();

      const {
        isGlobeLikeHotkey,
        isModifierOnlyHotkey,
        isRightSideModifier,
      } = require("./hotkeyManager");
      const usesNativeListener = (hotkey) =>
        !hotkey ||
        isGlobeLikeHotkey(hotkey) ||
        isModifierOnlyHotkey(hotkey) ||
        isRightSideModifier(hotkey);

      if (enabled) {
        // Entering capture mode - unregister globalShortcut so it doesn't consume key events
        const currentHotkey = hotkeyManager.getCurrentHotkey();
        if (currentHotkey && !usesNativeListener(currentHotkey)) {
          debugLogger.log(
            `[IPC] Unregistering globalShortcut "${currentHotkey}" for hotkey capture mode`
          );
          const { globalShortcut } = require("electron");
          globalShortcut.unregister(currentHotkey);
        }

        // On Windows, stop the Windows key listener
        if (process.platform === "win32" && this.windowsKeyManager) {
          debugLogger.log("[IPC] Stopping Windows key listener for hotkey capture mode");
          this.windowsKeyManager.stop();
        }

        // On GNOME Wayland, unregister the keybinding during capture
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager) {
          debugLogger.log("[IPC] Unregistering GNOME keybinding for hotkey capture mode");
          await hotkeyManager.gnomeManager.unregisterKeybinding().catch((err) => {
            debugLogger.warn("[IPC] Failed to unregister GNOME keybinding:", err.message);
          });
        }

        // On Hyprland Wayland, unregister the keybinding during capture
        if (hotkeyManager.isUsingHyprland() && hotkeyManager.hyprlandManager) {
          debugLogger.log("[IPC] Unregistering Hyprland keybinding for hotkey capture mode");
          await hotkeyManager.hyprlandManager.unregisterKeybinding().catch((err) => {
            debugLogger.warn("[IPC] Failed to unregister Hyprland keybinding:", err.message);
          });
        }
      } else {
        // Exiting capture mode - re-register globalShortcut if not already registered
        if (effectiveHotkey && !usesNativeListener(effectiveHotkey)) {
          const { globalShortcut } = require("electron");
          const accelerator = effectiveHotkey.startsWith("Fn+")
            ? effectiveHotkey.slice(3)
            : effectiveHotkey;
          if (!globalShortcut.isRegistered(accelerator)) {
            debugLogger.log(
              `[IPC] Re-registering globalShortcut "${accelerator}" after capture mode`
            );
            const callback = this.windowManager.createHotkeyCallback();
            const registered = globalShortcut.register(accelerator, callback);
            if (!registered) {
              debugLogger.warn(
                `[IPC] Failed to re-register globalShortcut "${accelerator}" after capture mode`
              );
            }
          }
        }

        if (process.platform === "win32" && this.windowsKeyManager) {
          const activationMode = this.windowManager.getActivationMode();
          debugLogger.log(
            `[IPC] Exiting hotkey capture mode, activationMode="${activationMode}", hotkey="${effectiveHotkey}"`
          );
          const needsListener =
            effectiveHotkey &&
            !isGlobeLikeHotkey(effectiveHotkey) &&
            (activationMode === "push" ||
              isModifierOnlyHotkey(effectiveHotkey) ||
              isRightSideModifier(effectiveHotkey));
          if (needsListener) {
            debugLogger.log(`[IPC] Restarting Windows key listener for hotkey: ${effectiveHotkey}`);
            this.windowsKeyManager.start(effectiveHotkey);
          } else {
            this.windowsKeyManager.stop();
          }
        }

        // On GNOME Wayland, re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingGnome() && hotkeyManager.gnomeManager && effectiveHotkey) {
          const gnomeHotkey = GnomeShortcutManager.convertToGnomeFormat(effectiveHotkey);
          debugLogger.log(
            `[IPC] Re-registering GNOME keybinding "${gnomeHotkey}" after capture mode`
          );
          const success = await hotkeyManager.gnomeManager.registerKeybinding(gnomeHotkey);
          if (success) {
            hotkeyManager.currentHotkey = effectiveHotkey;
          }
        }

        // On Hyprland Wayland, re-register the keybinding with the effective hotkey
        if (hotkeyManager.isUsingHyprland() && hotkeyManager.hyprlandManager && effectiveHotkey) {
          debugLogger.log(
            `[IPC] Re-registering Hyprland keybinding "${effectiveHotkey}" after capture mode`
          );
          const success = await hotkeyManager.hyprlandManager.registerKeybinding(effectiveHotkey);
          if (success) {
            hotkeyManager.currentHotkey = effectiveHotkey;
          }
        }
      }

      return { success: true };
    });

    ipcMain.handle("get-hotkey-mode-info", async () => {
      return {
        isUsingGnome: this.windowManager.isUsingGnomeHotkeys(),
        isUsingHyprland: this.windowManager.isUsingHyprlandHotkeys(),
        isUsingKDE: this.windowManager.isUsingKDEHotkeys(),
        isUsingNativeShortcut: this.windowManager.isUsingNativeShortcutHotkeys(),
      };
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    ipcMain.handle("open-external", async (event, url) => {
      try {
        // WhisperWoof security: validate URL protocol before opening
        const parsed = new URL(url);
        const allowedProtocols = ["http:", "https:", "mailto:"];
        if (!allowedProtocols.includes(parsed.protocol)) {
          return { success: false, error: `Blocked protocol: ${parsed.protocol}` };
        }
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-auto-start-enabled", async () => {
      try {
        const loginSettings = app.getLoginItemSettings();
        return loginSettings.openAtLogin;
      } catch (error) {
        debugLogger.error(`Error getting auto-start status: ${error.message}`);
        return false;
      }
    });

    ipcMain.handle("set-auto-start-enabled", async (event, enabled) => {
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true, // Start minimized to tray
        });
        debugLogger.debug("Auto-start setting updated", { enabled });
        return { success: true };
      } catch (error) {
        debugLogger.error(`Error setting auto-start: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("model-get-all", async () => {
      try {
        debugLogger.debug("model-get-all called", undefined, "ipc");
        const modelManager = require("./modelManagerBridge").default;
        const models = await modelManager.getModelsWithStatus();
        debugLogger.debug("Returning models", { count: models.length }, "ipc");
        return models;
      } catch (error) {
        debugLogger.error(`Error in model-get-all: ${error.message}`);
        throw error;
      }
    });

    ipcMain.handle("model-check", async (_, modelId) => {
      const modelManager = require("./modelManagerBridge").default;
      return modelManager.isModelDownloaded(modelId);
    });

    ipcMain.handle("model-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const result = await modelManager.downloadModel(
          modelId,
          (progress, downloadedSize, totalSize) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("model-download-progress", {
                modelId,
                progress,
                downloadedSize,
                totalSize,
              });
            }
          }
        );
        return { success: true, path: result };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-delete", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteModel(modelId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-delete-all", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.deleteAllModels();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("model-cancel-download", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const cancelled = modelManager.cancelDownload(modelId);
        return { success: cancelled };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    });

    ipcMain.handle("model-check-runtime", async (event) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.ensureLlamaCpp();
        return { available: true };
      } catch (error) {
        return {
          available: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
    });

    ipcMain.handle("get-anthropic-key", async (event) => {
      return this.environmentManager.getAnthropicKey();
    });

    ipcMain.handle("get-gemini-key", async (event) => {
      return this.environmentManager.getGeminiKey();
    });

    ipcMain.handle("save-gemini-key", async (event, key) => {
      return this.environmentManager.saveGeminiKey(key);
    });

    ipcMain.handle("get-groq-key", async (event) => {
      return this.environmentManager.getGroqKey();
    });

    ipcMain.handle("save-groq-key", async (event, key) => {
      return this.environmentManager.saveGroqKey(key);
    });

    ipcMain.handle("get-mistral-key", async () => {
      return this.environmentManager.getMistralKey();
    });

    ipcMain.handle("save-mistral-key", async (event, key) => {
      return this.environmentManager.saveMistralKey(key);
    });

    ipcMain.handle(
      "proxy-mistral-transcription",
      async (event, { audioBuffer, model, language, contextBias }) => {
        const apiKey = this.environmentManager.getMistralKey();
        if (!apiKey) {
          throw new Error("Mistral API key not configured");
        }

        const formData = new FormData();
        const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: "audio/webm" });
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", model || "voxtral-mini-latest");
        if (language && language !== "auto") {
          formData.append("language", language);
        }
        if (contextBias && contextBias.length > 0) {
          for (const token of contextBias) {
            formData.append("context_bias", token);
          }
        }

        const response = await fetch(MISTRAL_TRANSCRIPTION_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Mistral API Error: ${response.status} ${errorText}`);
        }

        return await response.json();
      }
    );

    ipcMain.handle("get-custom-transcription-key", async () => {
      return this.environmentManager.getCustomTranscriptionKey();
    });

    ipcMain.handle("save-custom-transcription-key", async (event, key) => {
      return this.environmentManager.saveCustomTranscriptionKey(key);
    });

    ipcMain.handle("get-custom-reasoning-key", async () => {
      return this.environmentManager.getCustomReasoningKey();
    });

    ipcMain.handle("save-custom-reasoning-key", async (event, key) => {
      return this.environmentManager.saveCustomReasoningKey(key);
    });

    ipcMain.handle("get-dictation-key", async () => {
      return this.environmentManager.getDictationKey();
    });

    ipcMain.handle("save-dictation-key", async (event, key) => {
      return this.environmentManager.saveDictationKey(key);
    });

    ipcMain.handle("get-activation-mode", async () => {
      return this.environmentManager.getActivationMode();
    });

    ipcMain.handle("save-activation-mode", async (event, mode) => {
      return this.environmentManager.saveActivationMode(mode);
    });

    ipcMain.handle("save-anthropic-key", async (event, key) => {
      return this.environmentManager.saveAnthropicKey(key);
    });

    ipcMain.handle("get-ui-language", async () => {
      return this.environmentManager.getUiLanguage();
    });

    ipcMain.handle("save-ui-language", async (event, language) => {
      return this.environmentManager.saveUiLanguage(language);
    });

    ipcMain.handle("set-ui-language", async (event, language) => {
      const result = this.environmentManager.saveUiLanguage(language);
      process.env.UI_LANGUAGE = result.language;
      changeLanguage(result.language);
      this.windowManager?.refreshLocalizedUi?.();
      this.getTrayManager?.()?.updateTrayMenu?.();
      return { success: true, language: result.language };
    });

    ipcMain.handle("save-all-keys-to-env", async () => {
      return this.environmentManager.saveAllKeysToEnvFile();
    });

    ipcMain.handle("sync-startup-preferences", async (event, prefs) => {
      const setVars = {};
      const clearVars = [];

      if (prefs.useLocalWhisper && prefs.model) {
        // Local mode with model selected - set provider and model for pre-warming
        setVars.LOCAL_TRANSCRIPTION_PROVIDER = prefs.localTranscriptionProvider;
        if (prefs.localTranscriptionProvider === "nvidia") {
          setVars.PARAKEET_MODEL = prefs.model;
          clearVars.push("LOCAL_WHISPER_MODEL");
          this.whisperManager.stopServer().catch((err) => {
            debugLogger.error("Failed to stop whisper-server on provider switch", {
              error: err.message,
            });
          });
        } else {
          setVars.LOCAL_WHISPER_MODEL = prefs.model;
          clearVars.push("PARAKEET_MODEL");
          this.parakeetManager.stopServer().catch((err) => {
            debugLogger.error("Failed to stop parakeet-server on provider switch", {
              error: err.message,
            });
          });
        }
      } else if (prefs.useLocalWhisper) {
        // Local mode enabled but no model selected - clear pre-warming vars
        clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
      } else {
        // Cloud mode - stop local servers to free RAM
        clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
        this.whisperManager.stopServer().catch((err) => {
          debugLogger.error("Failed to stop whisper-server on cloud switch", {
            error: err.message,
          });
        });
        this.parakeetManager.stopServer().catch((err) => {
          debugLogger.error("Failed to stop parakeet-server on cloud switch", {
            error: err.message,
          });
        });
      }

      if (prefs.reasoningProvider === "local" && prefs.reasoningModel) {
        // Configuration is independent of active use: persist env vars whenever
        // local + model are set so the renderer/reasoning service can pick them
        // up later. Only the prewarm (active RAM use) is gated by the master
        // useReasoningModel toggle below.
        setVars.REASONING_PROVIDER = "local";
        setVars.LOCAL_REASONING_MODEL = prefs.reasoningModel;

        const modelManager = require("./modelManagerBridge").default;
        if (prefs.useReasoningModel) {
          // Pre-warm llama-server so the first dictation doesn't pay the
          // model-load cost (~10-15s for Qwen3.5 2B on Apple Silicon).
          // Idempotent: serverManager.start returns early if already running
          // with the same model, so re-firing on every settings sync is safe.
          modelManager.prewarmServer(prefs.reasoningModel).catch((err) => {
            debugLogger.warn("Failed to pre-warm llama-server at startup", {
              modelId: prefs.reasoningModel,
              error: err.message,
            });
          });
        } else {
          // Master toggle is off — stop server to free RAM. Mirrors the
          // cloud-switch stop path below so flipping the toggle off mid-session
          // releases resources without waiting for an app restart.
          modelManager.stopServer().catch((err) => {
            debugLogger.warn("Failed to stop llama-server (useReasoningModel off)", {
              error: err.message,
            });
          });
        }
      } else if (prefs.reasoningProvider && prefs.reasoningProvider !== "local") {
        clearVars.push("REASONING_PROVIDER", "LOCAL_REASONING_MODEL");
        const modelManager = require("./modelManagerBridge").default;
        modelManager.stopServer().catch((err) => {
          debugLogger.error("Failed to stop llama-server on provider switch", {
            error: err.message,
          });
        });
      }

      this._syncStartupEnv(setVars, clearVars);
    });

    ipcMain.handle("process-local-reasoning", async (event, text, modelId, _agentName, config) => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        const result = await LocalReasoningService.processText(text, modelId, config);
        return { success: true, text: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Adaptive style learning
    ipcMain.handle("whisperwoof-get-style-stats", async () => {
      try {
        const { getStyleStats } = require("../whisperwoof/bridge/style-learner");
        return getStyleStats();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-style-stats failed: ${error.message}`);
        return { exampleCount: 0, maxExamples: 50, oldestExample: null, newestExample: null };
      }
    });

    ipcMain.handle("whisperwoof-clear-style-examples", async () => {
      try {
        const { clearStyleExamples } = require("../whisperwoof/bridge/style-learner");
        return clearStyleExamples();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] clear-style-examples failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-get-style-examples", async () => {
      try {
        const { getStyleExamples } = require("../whisperwoof/bridge/style-learner");
        return getStyleExamples();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-style-examples failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Voice Activity Detection
    ipcMain.handle("whisperwoof-get-vad-config", async () => {
      try {
        const { getVadConfig } = require("../whisperwoof/bridge/vad");
        return getVadConfig();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-vad-config failed: ${error.message}`);
        return {};
      }
    });

    // WhisperWoof: Usage analytics
    ipcMain.handle("whisperwoof-get-analytics", async (_event, options) => {
      try {
        const { getDashboard } = require("../whisperwoof/bridge/analytics");
        return getDashboard(options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-analytics failed: ${error.message}`);
        return null;
      }
    });

    // WhisperWoof: App automation
    ipcMain.handle("whisperwoof-detect-automation", async (_event, text) => {
      try { const { detectAutomationCommand } = require("../whisperwoof/bridge/app-automation"); return detectAutomationCommand(text); }
      catch (error) { return null; }
    });
    ipcMain.handle("whisperwoof-execute-automation", async (_event, commandId, appName) => {
      try { const { executeAutomation } = require("../whisperwoof/bridge/app-automation"); return await executeAutomation(commandId, appName); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-get-automation-commands", async () => {
      try { const { getAutomationCommands } = require("../whisperwoof/bridge/app-automation"); return getAutomationCommands(); }
      catch (error) { return []; }
    });

    // WhisperWoof: Agentic actions
    ipcMain.handle("whisperwoof-detect-action", async (_event, text) => {
      try { const { detectActionIntent } = require("../whisperwoof/bridge/agentic-actions"); return detectActionIntent(text); }
      catch (error) { return null; }
    });
    ipcMain.handle("whisperwoof-prepare-action", async (_event, text, options) => {
      try { const { prepareAction } = require("../whisperwoof/bridge/agentic-actions"); return await prepareAction(text, options || {}); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-get-available-actions", async () => {
      try { const { getAvailableActions } = require("../whisperwoof/bridge/agentic-actions"); return getAvailableActions(); }
      catch (error) { return []; }
    });

    // WhisperWoof: Entry chaining
    ipcMain.handle("whisperwoof-link-entries", async (_event, childId, parentId) => {
      try { const { linkEntries } = require("../whisperwoof/bridge/entry-chains"); return linkEntries(childId, parentId); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-unlink-entry", async (_event, childId) => {
      try { const { unlinkEntry } = require("../whisperwoof/bridge/entry-chains"); return unlinkEntry(childId); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-get-chain", async (_event, entryId) => {
      try { const { getChain } = require("../whisperwoof/bridge/entry-chains"); return getChain(entryId); }
      catch (error) { return []; }
    });
    ipcMain.handle("whisperwoof-get-chain-stats", async () => {
      try { const { getChainStats } = require("../whisperwoof/bridge/entry-chains"); return getChainStats(); }
      catch (error) { return { totalChains: 0, totalLinks: 0, avgChainLength: 0 }; }
    });

    // WhisperWoof: Recurring capture
    ipcMain.handle("whisperwoof-get-schedules", async () => {
      try { const { getSchedules } = require("../whisperwoof/bridge/recurring-capture"); return getSchedules(); }
      catch (error) { return []; }
    });
    ipcMain.handle("whisperwoof-add-schedule", async (_event, config) => {
      try { const { addSchedule } = require("../whisperwoof/bridge/recurring-capture"); return addSchedule(config); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-update-schedule", async (_event, id, updates) => {
      try { const { updateSchedule } = require("../whisperwoof/bridge/recurring-capture"); return updateSchedule(id, updates); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-remove-schedule", async (_event, id) => {
      try { const { removeSchedule } = require("../whisperwoof/bridge/recurring-capture"); return removeSchedule(id); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-get-schedule-presets", async () => {
      try { const { getPresets } = require("../whisperwoof/bridge/recurring-capture"); return getPresets(); }
      catch (error) { return []; }
    });

    // WhisperWoof: Entry templates
    ipcMain.handle("whisperwoof-get-templates", async () => {
      try { const { getAllTemplates } = require("../whisperwoof/bridge/entry-templates"); return getAllTemplates(); }
      catch (error) { return []; }
    });
    ipcMain.handle("whisperwoof-create-template", async (_event, config) => {
      try { const { createTemplate } = require("../whisperwoof/bridge/entry-templates"); return createTemplate(config); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-delete-template", async (_event, id) => {
      try { const { deleteTemplate } = require("../whisperwoof/bridge/entry-templates"); return deleteTemplate(id); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-render-template", async (_event, templateId, values) => {
      try { const { renderTemplate } = require("../whisperwoof/bridge/entry-templates"); return renderTemplate(templateId, values); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-get-next-section", async (_event, templateId, filledSections) => {
      try { const { getNextSection } = require("../whisperwoof/bridge/entry-templates"); return getNextSection(templateId, filledSections); }
      catch (error) { return null; }
    });

    // WhisperWoof: Webhooks
    ipcMain.handle("whisperwoof-get-webhooks", async () => {
      try { const { getWebhooks } = require("../whisperwoof/bridge/webhooks"); return getWebhooks(); }
      catch (error) { return []; }
    });
    ipcMain.handle("whisperwoof-add-webhook", async (_event, config) => {
      try { const { addWebhook } = require("../whisperwoof/bridge/webhooks"); return addWebhook(config); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-update-webhook", async (_event, id, updates) => {
      try { const { updateWebhook } = require("../whisperwoof/bridge/webhooks"); return updateWebhook(id, updates); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-remove-webhook", async (_event, id) => {
      try { const { removeWebhook } = require("../whisperwoof/bridge/webhooks"); return removeWebhook(id); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-test-webhook", async (_event, id) => {
      try { const { testWebhook } = require("../whisperwoof/bridge/webhooks"); return await testWebhook(id); }
      catch (error) { return { success: false, error: error.message }; }
    });
    ipcMain.handle("whisperwoof-get-delivery-log", async (_event, limit) => {
      try { const { getDeliveryLog } = require("../whisperwoof/bridge/webhooks"); return getDeliveryLog(limit); }
      catch (error) { return []; }
    });

    // WhisperWoof: Keybinding customization
    ipcMain.handle("whisperwoof-get-keybindings", async () => {
      try {
        const { getKeybindingsList } = require("../whisperwoof/bridge/keybindings");
        return getKeybindingsList();
      } catch (error) { return []; }
    });

    ipcMain.handle("whisperwoof-rebind-action", async (_event, actionId, newKey) => {
      try {
        const { rebindAction } = require("../whisperwoof/bridge/keybindings");
        return rebindAction(actionId, newKey);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-reset-keybinding", async (_event, actionId) => {
      try {
        const { resetAction } = require("../whisperwoof/bridge/keybindings");
        return resetAction(actionId);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-reset-all-keybindings", async () => {
      try {
        const { resetAll } = require("../whisperwoof/bridge/keybindings");
        return resetAll();
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-export-keybindings", async () => {
      try {
        const { exportKeybindings } = require("../whisperwoof/bridge/keybindings");
        return exportKeybindings();
      } catch (error) { return null; }
    });

    ipcMain.handle("whisperwoof-import-keybindings", async (_event, data) => {
      try {
        const { importKeybindings } = require("../whisperwoof/bridge/keybindings");
        return importKeybindings(data);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-get-keybinding-categories", async () => {
      try {
        const { getCategories } = require("../whisperwoof/bridge/keybindings");
        return getCategories();
      } catch (error) { return []; }
    });

    // WhisperWoof: Privacy lock
    ipcMain.handle("whisperwoof-privacy-enable", async (_event, options) => {
      try {
        const { enablePrivacyLock } = require("../whisperwoof/bridge/privacy-lock");
        return enablePrivacyLock(options || {});
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-privacy-disable", async () => {
      try {
        const { disablePrivacyLock } = require("../whisperwoof/bridge/privacy-lock");
        return disablePrivacyLock();
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-privacy-state", async () => {
      try {
        const { getPrivacyState } = require("../whisperwoof/bridge/privacy-lock");
        return getPrivacyState();
      } catch (error) { return { locked: false, lockedAt: null, lockedBy: null, durationMin: 0 }; }
    });

    ipcMain.handle("whisperwoof-privacy-check-url", async (_event, url) => {
      try {
        const { isUrlAllowed } = require("../whisperwoof/bridge/privacy-lock");
        return isUrlAllowed(url);
      } catch (error) { return true; }
    });

    ipcMain.handle("whisperwoof-privacy-check-provider", async (_event, providerId) => {
      try {
        const { isProviderAllowed } = require("../whisperwoof/bridge/privacy-lock");
        return isProviderAllowed(providerId);
      } catch (error) { return true; }
    });

    ipcMain.handle("whisperwoof-privacy-overrides", async () => {
      try {
        const { getPrivacyOverrides } = require("../whisperwoof/bridge/privacy-lock");
        return getPrivacyOverrides();
      } catch (error) { return null; }
    });

    ipcMain.handle("whisperwoof-privacy-settings", async (_event, updates) => {
      try {
        const { updatePrivacySettings } = require("../whisperwoof/bridge/privacy-lock");
        return updatePrivacySettings(updates);
      } catch (error) { return { success: false, error: error.message }; }
    });

    // WhisperWoof: Entry tagging
    ipcMain.handle("whisperwoof-get-tags", async () => {
      try {
        const { getAllTags } = require("../whisperwoof/bridge/entry-tags");
        return getAllTags();
      } catch (error) { return []; }
    });

    ipcMain.handle("whisperwoof-create-tag", async (_event, name, color) => {
      try {
        const { createTag } = require("../whisperwoof/bridge/entry-tags");
        return createTag(name, color);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-update-tag", async (_event, id, updates) => {
      try {
        const { updateTag } = require("../whisperwoof/bridge/entry-tags");
        return updateTag(id, updates);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-delete-tag", async (_event, id) => {
      try {
        const { deleteTag } = require("../whisperwoof/bridge/entry-tags");
        return deleteTag(id);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-add-tag-to-entry", async (_event, entryId, tagId) => {
      try {
        const { addTagToEntry } = require("../whisperwoof/bridge/entry-tags");
        return addTagToEntry(entryId, tagId);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-remove-tag-from-entry", async (_event, entryId, tagId) => {
      try {
        const { removeTagFromEntry } = require("../whisperwoof/bridge/entry-tags");
        return removeTagFromEntry(entryId, tagId);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-get-entry-tags", async (_event, entryId) => {
      try {
        const { getEntryTags } = require("../whisperwoof/bridge/entry-tags");
        return getEntryTags(entryId);
      } catch (error) { return []; }
    });

    ipcMain.handle("whisperwoof-get-entries-by-tag", async (_event, tagId, limit) => {
      try {
        const { getEntriesByTag } = require("../whisperwoof/bridge/entry-tags");
        return getEntriesByTag(tagId, limit);
      } catch (error) { return []; }
    });

    ipcMain.handle("whisperwoof-bulk-tag-entries", async (_event, entryIds, tagId) => {
      try {
        const { bulkTagEntries } = require("../whisperwoof/bridge/entry-tags");
        return bulkTagEntries(entryIds, tagId);
      } catch (error) { return { success: false, error: error.message }; }
    });

    ipcMain.handle("whisperwoof-get-tag-stats", async () => {
      try {
        const { getTagStats } = require("../whisperwoof/bridge/entry-tags");
        return getTagStats();
      } catch (error) { return { totalTags: 0, totalTaggings: 0, topTags: [], untaggedCount: 0 }; }
    });

    // WhisperWoof: Focus mode
    ipcMain.handle("whisperwoof-focus-start", async (_event, options) => {
      try {
        const { startSession } = require("../whisperwoof/bridge/focus-mode");
        return startSession(options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] focus-start failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-focus-end", async (_event, summary) => {
      try {
        const { endSession } = require("../whisperwoof/bridge/focus-mode");
        return endSession(summary);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] focus-end failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-focus-active", async () => {
      try {
        const { getActiveSession } = require("../whisperwoof/bridge/focus-mode");
        return getActiveSession();
      } catch (error) {
        return null;
      }
    });

    ipcMain.handle("whisperwoof-focus-record-entry", async (_event, entryId, wordCount) => {
      try {
        const { recordEntry } = require("../whisperwoof/bridge/focus-mode");
        return recordEntry(entryId, wordCount);
      } catch (error) {
        return false;
      }
    });

    ipcMain.handle("whisperwoof-focus-stats", async () => {
      try {
        const { getFocusStats } = require("../whisperwoof/bridge/focus-mode");
        return getFocusStats();
      } catch (error) {
        return { totalSessions: 0, totalMinutes: 0, totalWords: 0, totalEntries: 0, avgDuration: 0, completionRate: 0, currentStreak: 0 };
      }
    });

    ipcMain.handle("whisperwoof-focus-history", async (_event, options) => {
      try {
        const { getSessionHistory } = require("../whisperwoof/bridge/focus-mode");
        return getSessionHistory(options || {});
      } catch (error) {
        return [];
      }
    });

    ipcMain.handle("whisperwoof-focus-presets", async () => {
      try {
        const { getSprintPresets } = require("../whisperwoof/bridge/focus-mode");
        return getSprintPresets();
      } catch (error) {
        return [];
      }
    });

    // WhisperWoof: Streaming transcription manager
    ipcMain.handle("whisperwoof-streaming-format", async (_event, text, maxChars) => {
      try {
        const { formatForDisplay } = require("../whisperwoof/bridge/streaming-manager");
        return formatForDisplay(text, maxChars);
      } catch (error) {
        return text || "";
      }
    });

    ipcMain.handle("whisperwoof-streaming-diff", async (_event, oldText, newText) => {
      try {
        const { diffPartials } = require("../whisperwoof/bridge/streaming-manager");
        return diffPartials(oldText, newText);
      } catch (error) {
        return { unchanged: 0, changed: 0, added: 0, newWords: [] };
      }
    });


    // WhisperWoof: Vibe coding
    ipcMain.handle("whisperwoof-get-coding-prompt", async (_event, bundleId, spokenText) => {
      try {
        const { getCodingPrompt } = require("../whisperwoof/bridge/vibe-coding");
        return getCodingPrompt(bundleId, spokenText);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-coding-prompt failed: ${error.message}`);
        return { prompt: null, mode: "prose" };
      }
    });

    // WhisperWoof: Language detection
    ipcMain.handle("whisperwoof-detect-language", async (_event, text) => {
      try {
        const { detectLanguage } = require("../whisperwoof/bridge/language-detect");
        return detectLanguage(text);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] detect-language failed: ${error.message}`);
        return { lang: "en", name: "English", confidence: "default" };
      }
    });

    ipcMain.handle("whisperwoof-get-supported-languages", async () => {
      try {
        const { getSupportedLanguages } = require("../whisperwoof/bridge/language-detect");
        return getSupportedLanguages();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-supported-languages failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Settings export/import
    ipcMain.handle("whisperwoof-export-settings", async (_event, options) => {
      try {
        const { exportSettings } = require("../whisperwoof/bridge/settings-export");
        return exportSettings(options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] export-settings failed: ${error.message}`);
        return { bundle: null, stats: {}, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-import-settings", async (_event, bundle, options) => {
      try {
        const { importSettings } = require("../whisperwoof/bridge/settings-export");
        return importSettings(bundle, options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] import-settings failed: ${error.message}`);
        return { success: false, imported: {}, errors: [error.message] };
      }
    });

    ipcMain.handle("whisperwoof-save-export-file", async (_event, filePath, bundle) => {
      try {
        const { saveExportFile } = require("../whisperwoof/bridge/settings-export");
        return saveExportFile(filePath, bundle);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] save-export-file failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-load-import-file", async (_event, filePath) => {
      try {
        const { loadImportFile } = require("../whisperwoof/bridge/settings-export");
        return loadImportFile(filePath);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] load-import-file failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Custom vocabulary
    ipcMain.handle("whisperwoof-get-vocabulary", async (_event, options) => {
      try {
        const { getVocabulary } = require("../whisperwoof/bridge/vocabulary");
        return getVocabulary(options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-vocabulary failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-add-word", async (_event, word, options) => {
      try {
        const { addWord } = require("../whisperwoof/bridge/vocabulary");
        return addWord(word, options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] add-word failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-update-word", async (_event, id, updates) => {
      try {
        const { updateWord } = require("../whisperwoof/bridge/vocabulary");
        return updateWord(id, updates);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] update-word failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-remove-word", async (_event, id) => {
      try {
        const { removeWord } = require("../whisperwoof/bridge/vocabulary");
        return removeWord(id);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] remove-word failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-import-words", async (_event, words, category) => {
      try {
        const { importWords } = require("../whisperwoof/bridge/vocabulary");
        return importWords(words, category);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] import-words failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-get-vocabulary-stats", async () => {
      try {
        const { getVocabularyStats } = require("../whisperwoof/bridge/vocabulary");
        return getVocabularyStats();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-vocabulary-stats failed: ${error.message}`);
        return { total: 0, max: 1000, categories: {}, topUsed: [] };
      }
    });

    ipcMain.handle("whisperwoof-get-stt-hints", async (_event, bundleId) => {
      try {
        const { getSttHints } = require("../whisperwoof/bridge/vocabulary");
        const { getPackEnhancedSttPrompt } = require("../whisperwoof/bridge/vocabulary-packs");
        const userHints = getSttHints(bundleId || undefined);
        // Return pack-enhanced prompt string (merged user + pack hints, truncated to fit Whisper limit)
        const prompt = getPackEnhancedSttPrompt(userHints, bundleId || undefined);
        return prompt ? prompt.split(", ") : userHints;
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-stt-hints failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Vocabulary packs
    ipcMain.handle("whisperwoof-get-available-packs", async () => {
      try {
        const { getAvailablePacks } = require("../whisperwoof/bridge/vocabulary-packs");
        return getAvailablePacks();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-available-packs failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-get-pack-details", async (_event, packId) => {
      try {
        const { getPackDetails } = require("../whisperwoof/bridge/vocabulary-packs");
        return getPackDetails(packId);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-pack-details failed: ${error.message}`);
        return null;
      }
    });

    ipcMain.handle("whisperwoof-enable-pack", async (_event, packId) => {
      try {
        const { enablePackById } = require("../whisperwoof/bridge/vocabulary-packs");
        return enablePackById(packId);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] enable-pack failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-disable-pack", async (_event, packId) => {
      try {
        const { disablePackById } = require("../whisperwoof/bridge/vocabulary-packs");
        return disablePackById(packId);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] disable-pack failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-toggle-pack-entry", async (_event, packId, word) => {
      try {
        const { togglePackEntryById } = require("../whisperwoof/bridge/vocabulary-packs");
        return togglePackEntryById(packId, word);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] toggle-pack-entry failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-get-enabled-pack-ids", async () => {
      try {
        const { getEnabledPackIds } = require("../whisperwoof/bridge/vocabulary-packs");
        return getEnabledPackIds();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-enabled-pack-ids failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-get-pack-enhanced-prompt", async (_event, bundleId) => {
      try {
        const { getSttHints } = require("../whisperwoof/bridge/vocabulary");
        const { getPackEnhancedSttPrompt } = require("../whisperwoof/bridge/vocabulary-packs");
        const userHints = getSttHints(bundleId || undefined);
        return getPackEnhancedSttPrompt(userHints, bundleId || undefined);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-pack-enhanced-prompt failed: ${error.message}`);
        return "";
      }
    });

    // Memory: context-aware vocabulary
    ipcMain.handle("whisperwoof-get-vocabulary-for-app", async (_event, bundleId) => {
      try {
        const { getVocabularyForApp } = require("../whisperwoof/bridge/vocabulary");
        return getVocabularyForApp(bundleId);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-vocabulary-for-app failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-get-tracked-apps", async () => {
      try {
        const { getTrackedApps } = require("../whisperwoof/bridge/vocabulary");
        return getTrackedApps();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-tracked-apps failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Telegram companion sync
    ipcMain.handle("whisperwoof-telegram-sync-status", async () => {
      try {
        const { getTelegramSyncStatus } = require("../whisperwoof/bridge/telegram-sync");
        return getTelegramSyncStatus();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] telegram-sync-status failed: ${error.message}`);
        return { running: false, inboxExists: false, pending: 0, total: 0 };
      }
    });

    ipcMain.handle("whisperwoof-telegram-import-now", async () => {
      try {
        const { importPendingEntries } = require("../whisperwoof/bridge/telegram-sync");
        const count = importPendingEntries();
        return { success: true, imported: count };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] telegram-import-now failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });


    // WhisperWoof: Save entry to bf_entries table
    ipcMain.handle("whisperwoof-save-entry", async (event, entry) => {
      try {
        const { saveWhisperWoofEntry } = require("../whisperwoof/bridge/app-init");
        const result = saveWhisperWoofEntry(entry);
        if (result) {
          // Memory: track vocabulary usage from this transcription
          try {
            const { getVocabulary, incrementUsage } = require("../whisperwoof/bridge/vocabulary");
            const text = (entry.polished || entry.rawText || "").toLowerCase();
            if (text.length > 0) {
              // Detect active app for context tagging
              let bundleId = null;
              try {
                const { detectActiveApp } = require("../whisperwoof/bridge/context-detector");
                const app = await detectActiveApp();
                bundleId = app?.bundleId ?? null;
              } catch { /* optional */ }

              const vocab = getVocabulary();
              for (const v of vocab) {
                if (text.includes(v.word.toLowerCase())) {
                  incrementUsage(v.word, bundleId);
                }
              }
            }
          } catch (vocabErr) {
            debugLogger.debug("[WhisperWoof] Vocabulary usage tracking failed", { error: vocabErr.message });
          }

          return { success: true, ...result };
        }
        return { success: false, error: "WhisperWoof database not initialized" };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Save as Markdown note (Fn+N routing destination)
    ipcMain.handle("whisperwoof-save-markdown", async (event, text) => {
      try {
        const { saveAsMarkdown } = require("../whisperwoof/bridge/markdown-route");
        return saveAsMarkdown(text);
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-get-notes-dir", async () => {
      try {
        const { getNotesDirectory } = require("../whisperwoof/bridge/markdown-route");
        return { success: true, path: getNotesDirectory() };
      } catch (error) {
        return { success: false, error: `Failed to get notes directory: ${error.message}` };
      }
    });

    ipcMain.handle("whisperwoof-set-notes-dir", async (_event, dir) => {
      try {
        const { setNotesDir } = require("../whisperwoof/bridge/markdown-route");
        const result = setNotesDir(dir);
        return { success: true, path: result };
      } catch (error) {
        return { success: false, error: `Failed to set notes directory: ${error.message}` };
      }
    });

    ipcMain.handle("whisperwoof-pick-notes-dir", async () => {
      try {
        const { dialog } = require("electron");
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          title: "Choose Notes Folder",
          message: "Pick a folder for WhisperWoof to save voice notes (works with Obsidian vaults, iCloud, or any local folder)",
        });
        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, canceled: true };
        }
        const { setNotesDir } = require("../whisperwoof/bridge/markdown-route");
        const dir = setNotesDir(result.filePaths[0]);
        return { success: true, path: dir };
      } catch (error) {
        return { success: false, error: `Failed to pick notes directory: ${error.message}` };
      }
    });

    // WhisperWoof: History entries (voice + clipboard unified view)
    ipcMain.handle("whisperwoof-get-entries", async (_event, limit, offset) => {
      try {
        const { getWhisperWoofEntries } = require("../whisperwoof/bridge/app-init");
        return getWhisperWoofEntries(limit, offset);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-entries failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-get-entries-by-source", async (_event, source, limit, offset) => {
      try {
        const { getWhisperWoofEntriesBySource } = require("../whisperwoof/bridge/app-init");
        return getWhisperWoofEntriesBySource(source, limit, offset);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-entries-by-source failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-search-entries", async (_event, query, limit) => {
      try {
        const { searchWhisperWoofEntries } = require("../whisperwoof/bridge/app-init");
        return searchWhisperWoofEntries(query, limit);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] search-entries failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-delete-entry", async (_event, id) => {
      try {
        const { deleteWhisperWoofEntry } = require("../whisperwoof/bridge/app-init");
        deleteWhisperWoofEntry(id);
        return { success: true };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] delete-entry failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Toggle favorite on an entry
    ipcMain.handle("whisperwoof-toggle-favorite", async (_event, id) => {
      try {
        const { toggleWhisperWoofFavorite } = require("../whisperwoof/bridge/app-init");
        const isFavorite = toggleWhisperWoofFavorite(id);
        return { success: true, isFavorite };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] toggle-favorite failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Get favorited entries
    ipcMain.handle("whisperwoof-get-favorites", async (_event, limit) => {
      try {
        const { getWhisperWoofFavorites } = require("../whisperwoof/bridge/app-init");
        return getWhisperWoofFavorites(limit ?? 50);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-favorites failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Read image file as base64 (for History view)
    ipcMain.handle("whisperwoof-get-image", async (_event, imagePath) => {
      try {
        const fs = require("fs");
        if (!fs.existsSync(imagePath)) return { success: false, error: "File not found" };
        const data = fs.readFileSync(imagePath);
        return { success: true, data: data.toString("base64") };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-image failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Toggle clipboard monitoring on/off
    ipcMain.handle("whisperwoof-clipboard-toggle", async (_event, enabled) => {
      try {
        const { startClipboardMonitor, stopClipboardMonitor } = require("../whisperwoof/bridge/app-init");
        if (enabled) {
          startClipboardMonitor();
        } else {
          stopClipboardMonitor();
        }
        return { success: true, enabled };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] clipboard-toggle failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Projects — named buckets for "wandering mind" capture
    ipcMain.handle("whisperwoof-create-project", async (_event, name) => {
      try {
        const { createWhisperWoofProject } = require("../whisperwoof/bridge/app-init");
        const result = createWhisperWoofProject(name);
        if (result) {
          return { success: true, ...result };
        }
        return { success: false, error: "WhisperWoof database not initialized" };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] create-project failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-get-projects", async () => {
      try {
        const { getWhisperWoofProjects } = require("../whisperwoof/bridge/app-init");
        return getWhisperWoofProjects();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-projects failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-delete-project", async (_event, id) => {
      try {
        const { deleteWhisperWoofProject } = require("../whisperwoof/bridge/app-init");
        deleteWhisperWoofProject(id);
        return { success: true };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] delete-project failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-get-project-entries", async (_event, projectId, limit) => {
      try {
        const { getProjectEntries } = require("../whisperwoof/bridge/app-init");
        return getProjectEntries(projectId, limit);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-project-entries failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Model advisor — recommend model based on system memory
    ipcMain.handle("whisperwoof-get-model-recommendation", async () => {
      try {
        const { getRecommendedModel } = require("../whisperwoof/bridge/model-advisor");
        return getRecommendedModel();
      } catch (error) {
        return { recommended: "small", systemRAM: 8, models: [] };
      }
    });

    ipcMain.handle("whisperwoof-get-model-failure-advice", async (_event, failedModel, stderr) => {
      try {
        const { getModelFailureAdvice } = require("../whisperwoof/bridge/model-advisor");
        return getModelFailureAdvice(failedModel, stderr);
      } catch {
        return { title: "Model failed", message: "Try a smaller model.", recommendation: "small" };
      }
    });

    // WhisperWoof: File import — upload audio files for transcription
    ipcMain.handle("whisperwoof-import-audio", async (_event, filePath) => {
      try {
        const { importAudioFile } = require("../whisperwoof/bridge/file-import");
        const result = importAudioFile(filePath);
        if (!result.success) return result;

        const transcription = await this.whisperManager.transcribeLocalWhisper(
          result.audioBuffer,
          { model: process.env.WHISPER_MODEL || "base" }
        );

        if (transcription.success && transcription.text) {
          // Polish is a renderer-layer concern (routes through ReasoningService
          // with the canonical cleanupPrompt and the user's useReasoningModel
          // setting). The IPC returns the raw transcript; if a caller wants
          // polished output, it can run ReasoningService.processText on rawText
          // and update the entry via whisperwoofUpdateEntry.
          const { saveWhisperWoofEntry } = require("../whisperwoof/bridge/app-init");
          const entry = saveWhisperWoofEntry({
            source: "import",
            rawText: transcription.text,
            polished: null,
            routedTo: null,
            hotkeyUsed: null,
            durationMs: null,
            projectId: null,
            audioPath: filePath,
            metadata: { filename: result.filename, size: result.size },
          });

          return {
            success: true,
            text: transcription.text,
            rawText: transcription.text,
            entryId: entry?.id,
            filename: result.filename,
          };
        }
        return { success: false, error: transcription.error || "Transcription failed" };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-import-supported-extensions", async () => {
      const { getSupportedExtensions } = require("../whisperwoof/bridge/file-import");
      return getSupportedExtensions();
    });

    // WhisperWoof: Meeting transcription bridge — records meetings into bf_entries
    ipcMain.handle("whisperwoof-meeting-start", async (_event, options = {}) => {
      try {
        const { startMeeting } = require("../whisperwoof/bridge/meeting-bridge");
        const meetingId = startMeeting(options);
        if (meetingId) {
          return { success: true, meetingId };
        }
        return { success: false, error: "A meeting is already in progress" };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-meeting-segment", async (_event, text) => {
      try {
        const { addMeetingSegment } = require("../whisperwoof/bridge/meeting-bridge");
        addMeetingSegment(text);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-meeting-end", async () => {
      try {
        const { endMeeting } = require("../whisperwoof/bridge/meeting-bridge");
        const result = endMeeting();
        if (!result) {
          return { success: false, error: "No active meeting" };
        }

        // Polish is a renderer-layer concern (routes through ReasoningService
        // with the canonical cleanupPrompt and the user's useReasoningModel
        // setting). The IPC returns the raw transcript; if a caller wants
        // polished output, it can run ReasoningService.processText on transcript
        // and update the entry via whisperwoofUpdateEntry.
        const { saveWhisperWoofEntry } = require("../whisperwoof/bridge/app-init");
        const entry = saveWhisperWoofEntry({
          source: "meeting",
          rawText: result.transcript,
          polished: null,
          routedTo: null,
          hotkeyUsed: null,
          durationMs: result.durationMs,
          projectId: null,
          audioPath: null,
          metadata: {
            meetingId: result.id,
            segmentCount: result.segmentCount,
            transcriptOnly: result.transcriptOnly,
          },
        });

        return {
          success: true,
          meetingId: result.id,
          transcript: result.transcript,
          polished: null,
          durationMs: result.durationMs,
          segmentCount: result.segmentCount,
          transcriptOnly: result.transcriptOnly,
          entryId: entry?.id ?? null,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("whisperwoof-meeting-status", async () => {
      try {
        const { getActiveMeeting } = require("../whisperwoof/bridge/meeting-bridge");
        const meeting = getActiveMeeting();
        return { success: true, active: meeting !== null, meeting };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Voice editing commands
    ipcMain.handle("whisperwoof-voice-command", async (_event, spokenText, selectedText, options) => {
      try {
        const { executeVoiceCommand } = require("../whisperwoof/bridge/voice-commands");
        return await executeVoiceCommand(spokenText, selectedText, options || {});
      } catch (error) {
        debugLogger.log(`[WhisperWoof] voice-command failed: ${error.message}`);
        return { success: false, error: error.message, isCommand: false };
      }
    });

    ipcMain.handle("whisperwoof-detect-voice-command", async (_event, spokenText) => {
      try {
        const { detectCommand } = require("../whisperwoof/bridge/voice-commands");
        const command = detectCommand(spokenText);
        return { isCommand: !!command, command: command?.id ?? null };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] detect-voice-command failed: ${error.message}`);
        return { isCommand: false, command: null };
      }
    });

    ipcMain.handle("whisperwoof-get-voice-commands", async () => {
      try {
        const { getAvailableCommands } = require("../whisperwoof/bridge/voice-commands");
        return getAvailableCommands();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-voice-commands failed: ${error.message}`);
        return [];
      }
    });

    // WhisperWoof: Context-aware polish (detect active app)
    ipcMain.handle("whisperwoof-detect-context", async () => {
      try {
        const { detectContextPreset } = require("../whisperwoof/bridge/context-detector");
        return await detectContextPreset();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] detect-context failed: ${error.message}`);
        return { app: null, preset: null };
      }
    });

    ipcMain.handle("whisperwoof-get-app-preset-map", async () => {
      try {
        const { getAppPresetMap } = require("../whisperwoof/bridge/context-detector");
        return getAppPresetMap();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-app-preset-map failed: ${error.message}`);
        return {};
      }
    });

    ipcMain.handle("whisperwoof-set-app-preset", async (_event, bundleId, presetId) => {
      try {
        const { setAppPreset } = require("../whisperwoof/bridge/context-detector");
        setAppPreset(bundleId, presetId);
        return { success: true };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] set-app-preset failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Plugin management (MCP server plugins)
    ipcMain.handle("whisperwoof-get-plugins", async () => {
      try {
        const { getPlugins } = require("../whisperwoof/bridge/plugin-bridge");
        return getPlugins();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-plugins failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-update-plugin", async (_event, id, updates) => {
      try {
        const { updatePlugin } = require("../whisperwoof/bridge/plugin-bridge");
        return updatePlugin(id, updates);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] update-plugin failed: ${error.message}`);
        return null;
      }
    });

    ipcMain.handle("whisperwoof-add-plugin", async (_event, config) => {
      try {
        const { addPlugin } = require("../whisperwoof/bridge/plugin-bridge");
        return addPlugin(config);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] add-plugin failed: ${error.message}`);
        return null;
      }
    });

    ipcMain.handle("whisperwoof-remove-plugin", async (_event, id) => {
      try {
        const { removePlugin } = require("../whisperwoof/bridge/plugin-bridge");
        removePlugin(id);
        return { success: true };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] remove-plugin failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // WhisperWoof: Project → MCP plugin dispatch
    ipcMain.handle("whisperwoof-update-project-integration", async (_event, projectId, pluginId) => {
      try {
        const { updateProjectIntegration } = require("../whisperwoof/bridge/app-init");
        return updateProjectIntegration(projectId, pluginId);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] update-project-integration failed: ${error.message}`);
        return null;
      }
    });

    ipcMain.handle("whisperwoof-get-project-integrations", async () => {
      try {
        const { getProjectIntegrations } = require("../whisperwoof/bridge/app-init");
        return getProjectIntegrations();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] get-project-integrations failed: ${error.message}`);
        return {};
      }
    });

    ipcMain.handle("whisperwoof-dispatch-entry", async (_event, entryId, pluginId, text) => {
      try {
        if (!pluginId || !text) {
          return { success: false, error: "Missing pluginId or text" };
        }
        const { getPlugins } = require("../whisperwoof/bridge/plugin-bridge");
        const plugins = getPlugins();
        const plugin = plugins.find((p) => p.id === pluginId);
        if (!plugin) {
          return { success: false, error: `Plugin not found: ${pluginId}` };
        }
        if (!plugin.enabled) {
          return { success: false, error: `Plugin "${plugin.name}" is not enabled` };
        }

        // Use dynamic import for MCP SDK (ESM module)
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

        const [command, ...args] = plugin.command.split(/\s+/);
        const transport = new StdioClientTransport({ command, args });
        const client = new Client({ name: "whisperwoof", version: "0.9.0" }, { capabilities: {} });

        await client.connect(transport);

        // Discover tools and call the best one
        let toolName = "execute";
        try {
          const toolList = await client.listTools();
          const tools = toolList.tools.map((t) => t.name);
          if (tools.length > 0 && !tools.includes("execute")) {
            toolName = tools[0];
          }
        } catch {
          // fallback to "execute"
        }

        const result = await client.callTool({
          name: toolName,
          arguments: { text, entryId },
        });

        await client.close();

        const textContent = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");

        debugLogger.log(`[WhisperWoof] Dispatched entry ${entryId} to plugin ${pluginId}: ${textContent.slice(0, 100)}`);
        return { success: true, message: textContent || "Dispatched successfully" };
      } catch (error) {
        debugLogger.log(`[WhisperWoof] dispatch-entry failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle(
      "process-anthropic-reasoning",
      async (event, text, modelId, _agentName, config) => {
        try {
          const apiKey = this.environmentManager.getAnthropicKey();

          if (!apiKey) {
            throw new Error("Anthropic API key not configured");
          }

          const systemPrompt = config?.systemPrompt || "";
          const userPrompt = text;

          if (!modelId) {
            throw new Error("No model specified for Anthropic API call");
          }

          const requestBody = {
            model: modelId,
            messages: [{ role: "user", content: userPrompt }],
            system: systemPrompt,
            max_tokens: config?.maxTokens || Math.max(100, Math.min(text.length * 2, 4096)),
            temperature: config?.temperature || 0.3,
          };

          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            let errorData = { error: response.statusText };
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText || response.statusText };
            }
            throw new Error(
              errorData.error?.message ||
                errorData.error ||
                `Anthropic API error: ${response.status}`
            );
          }

          const data = await response.json();
          return { success: true, text: data.content[0].text.trim() };
        } catch (error) {
          debugLogger.error(`Anthropic reasoning error: ${error.message}`);
          return { success: false, error: error.message };
        }
      }
    );

    ipcMain.handle("check-local-reasoning-available", async () => {
      try {
        const LocalReasoningService = require("../services/localReasoningBridge").default;
        return await LocalReasoningService.isAvailable();
      } catch (error) {
        return false;
      }
    });

    ipcMain.handle("llama-cpp-check", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const isInstalled = await llamaCppInstaller.isInstalled();
        const version = isInstalled ? await llamaCppInstaller.getVersion() : null;
        return { isInstalled, version };
      } catch (error) {
        return { isInstalled: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-install", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.install();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-cpp-uninstall", async () => {
      try {
        const llamaCppInstaller = require("./llamaCppInstaller").default;
        const result = await llamaCppInstaller.uninstall();
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-start", async (event, modelId) => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        modelManager.ensureInitialized();
        const modelInfo = modelManager.findModelById(modelId);
        if (!modelInfo) {
          return { success: false, error: `Model "${modelId}" not found` };
        }

        const modelPath = require("path").join(modelManager.modelsDir, modelInfo.model.fileName);

        await modelManager.serverManager.start(modelPath, { threads: 4 });
        modelManager.currentServerModelId = modelId;

        this.environmentManager.saveAllKeysToEnvFile().catch(() => {});
        return { success: true, port: modelManager.serverManager.port };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-stop", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        await modelManager.stopServer();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("llama-server-status", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        return modelManager.getServerStatus();
      } catch (error) {
        return { available: false, running: false, error: error.message };
      }
    });

    ipcMain.handle("llama-gpu-reset", async () => {
      try {
        const modelManager = require("./modelManagerBridge").default;
        const previousModelId = modelManager.currentServerModelId;
        modelManager.serverManager.resetGpuDetection();
        await modelManager.stopServer();

        // Restart server with previous model so Vulkan binary is picked up
        if (previousModelId) {
          modelManager.prewarmServer(previousModelId).catch(() => {});
        }

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("detect-vulkan-gpu", async () => {
      try {
        const { detectVulkanGpu } = require("../utils/vulkanDetection");
        return await detectVulkanGpu();
      } catch (error) {
        return { available: false, error: error.message };
      }
    });

    ipcMain.handle("get-llama-vulkan-status", async () => {
      try {
        if (!this._llamaVulkanManager) {
          const LlamaVulkanManager = require("./llamaVulkanManager");
          this._llamaVulkanManager = new LlamaVulkanManager();
        }
        return this._llamaVulkanManager.getStatus();
      } catch (error) {
        return { supported: false, downloaded: false, error: error.message };
      }
    });

    ipcMain.handle("download-llama-vulkan-binary", async (event) => {
      try {
        if (!this._llamaVulkanManager) {
          const LlamaVulkanManager = require("./llamaVulkanManager");
          this._llamaVulkanManager = new LlamaVulkanManager();
        }

        const result = await this._llamaVulkanManager.download((downloaded, total) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("llama-vulkan-download-progress", {
              downloaded,
              total,
              percentage: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
          }
        });

        if (result.success) {
          process.env.LLAMA_VULKAN_ENABLED = "true";
          delete process.env.LLAMA_GPU_BACKEND;
          const modelManager = require("./modelManagerBridge").default;
          modelManager.serverManager.cachedServerBinaryPaths = null;
          await this.environmentManager.saveAllKeysToEnvFile().catch(() => {});
          // Restart llama server so it picks up the Vulkan binary
          await modelManager.stopServer().catch(() => {});
        }

        return result;
      } catch (error) {
        debugLogger.error("Vulkan binary download failed", {
          error: error.message,
          stack: error.stack,
        });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cancel-llama-vulkan-download", async () => {
      if (this._llamaVulkanManager) {
        return { success: this._llamaVulkanManager.cancelDownload() };
      }
      return { success: false };
    });

    ipcMain.handle("delete-llama-vulkan-binary", async () => {
      try {
        if (!this._llamaVulkanManager) {
          const LlamaVulkanManager = require("./llamaVulkanManager");
          this._llamaVulkanManager = new LlamaVulkanManager();
        }

        const modelManager = require("./modelManagerBridge").default;
        if (modelManager.serverManager.activeBackend === "vulkan") {
          await modelManager.stopServer();
        }

        const result = await this._llamaVulkanManager.deleteBinary();

        delete process.env.LLAMA_VULKAN_ENABLED;
        delete process.env.LLAMA_GPU_BACKEND;
        modelManager.serverManager.cachedServerBinaryPaths = null;
        this.environmentManager.saveAllKeysToEnvFile().catch(() => {});

        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-log-level", async () => {
      return debugLogger.getLevel();
    });

    ipcMain.handle("app-log", async (event, entry) => {
      debugLogger.logEntry(entry);
      return { success: true };
    });

    const SYSTEM_SETTINGS_URLS = {
      darwin: {
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        sound: "x-apple.systempreferences:com.apple.preference.sound?input",
        accessibility:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        systemAudio:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      },
      win32: {
        microphone: "ms-settings:privacy-microphone",
        sound: "ms-settings:sound",
      },
    };

    const openSystemSettings = async (settingType) => {
      const platform = process.platform;
      const urls = SYSTEM_SETTINGS_URLS[platform];
      const url = urls?.[settingType];

      if (!url) {
        // Platform doesn't support this settings URL
        const messages = {
          microphone: i18nMain.t("systemSettings.microphone"),
          sound: i18nMain.t("systemSettings.sound"),
          accessibility: i18nMain.t("systemSettings.accessibility"),
          systemAudio: i18nMain.t("systemSettings.systemAudio"),
        };
        return {
          success: false,
          error:
            messages[settingType] || `${settingType} settings are not available on this platform.`,
        };
      }

      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to open ${settingType} settings:`, error);
        return { success: false, error: error.message };
      }
    };

    ipcMain.handle("open-microphone-settings", () => openSystemSettings("microphone"));
    ipcMain.handle("open-sound-input-settings", () => openSystemSettings("sound"));
    ipcMain.handle("open-accessibility-settings", () => openSystemSettings("accessibility"));
    ipcMain.handle("open-system-audio-settings", () => openSystemSettings("systemAudio"));

    ipcMain.handle("toggle-media-playback", () => {
      const mediaPlayer = require("./mediaPlayer");
      return mediaPlayer.toggleMedia();
    });

    ipcMain.handle("pause-media-playback", () => {
      const mediaPlayer = require("./mediaPlayer");
      return mediaPlayer.pauseMedia();
    });

    ipcMain.handle("resume-media-playback", () => {
      const mediaPlayer = require("./mediaPlayer");
      return mediaPlayer.resumeMedia();
    });

    ipcMain.handle("request-microphone-access", async () => {
      if (process.platform !== "darwin") {
        return { granted: true, status: "granted" };
      }
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return { granted };
    });

    ipcMain.handle("check-microphone-access", () => {
      if (process.platform !== "darwin") {
        return { granted: true, status: "granted" };
      }
      const status = systemPreferences.getMediaAccessStatus("microphone");
      return { granted: status === "granted", status };
    });

    ipcMain.handle("check-system-audio-access", () => {
      if (process.platform !== "darwin") {
        return { granted: true, status: "granted", mode: "unsupported" };
      }

      if (!this.audioTapManager?.isSupported()) {
        return { granted: false, status: "unsupported", mode: "unsupported" };
      }

      const screenStatus = systemPreferences.getMediaAccessStatus("screen");
      const tapStatus = this.audioTapManager.getPermissionStatus();
      const granted = screenStatus === "granted" || tapStatus === "granted";
      return { granted, status: granted ? "granted" : screenStatus, mode: "native" };
    });

    ipcMain.handle("request-system-audio-access", async () => {
      if (process.platform !== "darwin") {
        return { granted: true, status: "granted", mode: "unsupported" };
      }

      if (!this.audioTapManager?.isSupported()) {
        return { granted: false, status: "unsupported", mode: "unsupported" };
      }

      const screenStatus = systemPreferences.getMediaAccessStatus("screen");
      if (screenStatus === "granted") {
        return { granted: true, status: "granted", mode: "native" };
      }

      // Probe the binary — AudioHardwareCreateProcessTap triggers the native consent dialog
      try {
        const result = await this.audioTapManager.requestAccess();
        if (result.granted) {
          return { granted: true, status: "granted", mode: "native" };
        }
      } catch {
        // Falls through to opening System Settings
      }

      // Fallback for older macOS or if the native prompt was denied
      await openSystemSettings("systemAudio");
      return { granted: false, status: screenStatus, mode: "native" };
    });

    // Auth: clear all session cookies for sign-out.
    // This clears every cookie in the renderer session rather than targeting
    // individual auth cookies, which is acceptable because the app only sets
    // cookies for Neon Auth. Avoids CSRF/Origin header issues that occur when
    // the renderer tries to call the server-side sign-out endpoint directly.
    ipcMain.handle("auth-clear-session", async (event) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
          await win.webContents.session.clearStorageData({ storages: ["cookies"] });
        }
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to clear auth session: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    // In production, VITE_* env vars aren't available in the main process because
    // Vite only inlines them into the renderer bundle at build time. Load the
    // runtime-env.json that the Vite build writes to src/dist/ as a fallback.
    const runtimeEnv = (() => {
      const fs = require("fs");
      const envPath = path.join(__dirname, "..", "dist", "runtime-env.json");
      try {
        if (fs.existsSync(envPath)) return JSON.parse(fs.readFileSync(envPath, "utf8"));
      } catch {}
      return {};
    })();

    const getApiUrl = () =>
      process.env.OPENWHISPR_API_URL ||
      process.env.VITE_OPENWHISPR_API_URL ||
      runtimeEnv.VITE_OPENWHISPR_API_URL ||
      "";

    const getAuthUrl = () =>
      process.env.NEON_AUTH_URL ||
      process.env.VITE_NEON_AUTH_URL ||
      runtimeEnv.VITE_NEON_AUTH_URL ||
      "";

    const getSessionCookiesFromWindow = async (win) => {
      const scopedUrls = [getAuthUrl(), getApiUrl()].filter(Boolean);
      const cookiesByName = new Map();

      for (const url of scopedUrls) {
        try {
          const scopedCookies = await win.webContents.session.cookies.get({ url });
          for (const cookie of scopedCookies) {
            if (!cookiesByName.has(cookie.name)) {
              cookiesByName.set(cookie.name, cookie.value);
            }
          }
        } catch (error) {
          debugLogger.warn("Failed to read scoped auth cookies", {
            url,
            error: error.message,
          });
        }
      }

      // Fallback for older sessions where cookies are not URL-scoped as expected.
      if (cookiesByName.size === 0) {
        const allCookies = await win.webContents.session.cookies.get({});
        for (const cookie of allCookies) {
          if (!cookiesByName.has(cookie.name)) {
            cookiesByName.set(cookie.name, cookie.value);
          }
        }
      }

      const cookieHeader = [...cookiesByName.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");

      debugLogger.debug(
        "Resolved auth cookies for cloud request",
        {
          cookieCount: cookiesByName.size,
          scopedUrls,
        },
        "auth"
      );

      return cookieHeader;
    };

    const getSessionCookies = async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return "";
      return getSessionCookiesFromWindow(win);
    };

    ipcMain.handle("cloud-transcribe", async (event, audioBuffer, opts = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const audioData = Buffer.from(audioBuffer);
        const { body, boundary } = buildMultipartBody(audioData, "audio.webm", "audio/webm", {
          language: opts.language,
          prompt: opts.prompt,
          sendLogs: opts.sendLogs,
          clientType: "desktop",
          appVersion: app.getVersion(),
          clientVersion: app.getVersion(),
          sessionId: this.sessionId,
        });

        debugLogger.debug(
          "Cloud transcribe request",
          { audioSize: audioData.length, bodySize: body.length },
          "cloud-api"
        );

        const url = new URL(`${apiUrl}/api/transcribe`);
        const data = await postMultipart(url, body, boundary, { Cookie: cookieHeader });

        debugLogger.debug(
          "Cloud transcribe response",
          { statusCode: data.statusCode },
          "cloud-api"
        );

        if (data.statusCode === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        if (data.statusCode === 429) {
          return {
            success: false,
            error: "Daily word limit reached",
            code: "LIMIT_REACHED",
            limitReached: true,
            ...data.data,
          };
        }
        if (data.statusCode !== 200) {
          throw new Error(data.data?.error || `API error: ${data.statusCode}`);
        }

        return {
          success: true,
          text: data.data.text,
          wordsUsed: data.data.wordsUsed,
          wordsRemaining: data.data.wordsRemaining,
          plan: data.data.plan,
          limitReached: data.data.limitReached || false,
          sttProvider: data.data.sttProvider,
          sttModel: data.data.sttModel,
          sttProcessingMs: data.data.sttProcessingMs,
          sttWordCount: data.data.sttWordCount,
          sttLanguage: data.data.sttLanguage,
          audioDurationMs: data.data.audioDurationMs,
        };
      } catch (error) {
        debugLogger.error("Cloud transcription error", { error: error.message }, "cloud-api");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("meeting-transcribe-chain", async (event, blobUrl, opts = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const response = await fetch(`${apiUrl}/api/transcribe-chain`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            mediaUrl: blobUrl,
            skipCleanup: opts.skipCleanup ?? false,
            agentName: opts.agentName,
            customDictionary: opts.customDictionary,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `Chain failed: ${response.status}`);
        }

        fetch(`${apiUrl}/api/delete-audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify({ url: blobUrl }),
        }).catch((err) => debugLogger.warn("Blob cleanup failed", { error: err.message }));

        return {
          success: true,
          text: data.text,
          rawText: data.rawText,
          cleanedText: data.cleanedText,
          processingDurationSec: data.processingDurationSec,
          speedupFactor: data.speedupFactor,
        };
      } catch (error) {
        debugLogger.error("Meeting chain transcription error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("retry-transcription", async (event, id) => {
      const buffer = this.audioStorageManager.getAudioBuffer(id);
      if (!buffer) return { success: false, error: "Audio file not found. The original recording may have been deleted by retention policy." };
      try {
        let result;

        // WhisperWoof: Clear cached binary path so freshly downloaded binaries are detected
        if (this.whisperManager?.serverManager) {
          this.whisperManager.serverManager.cachedServerBinaryPath = null;
        }

        // Try local engines first — check binary availability fresh each time
        if (this.parakeetManager?.serverManager?.isAvailable?.()) {
          result = await this.parakeetManager.transcribeLocalParakeet(buffer, {});
        } else if (this.whisperManager?.serverManager?.isAvailable?.()) {
          // Find a model that's actually downloaded
          const modelDir = path.join(app.getPath("userData"), "models");
          let modelPath = null;
          try {
            if (fs.existsSync(modelDir)) {
              const models = fs.readdirSync(modelDir).filter((f) => f.endsWith(".bin"));
              if (models.length > 0) {
                // Prefer the user's configured model, fall back to any available
                const preferred = getSettings().whisperModel || "base";
                const match = models.find((m) => m.includes(preferred)) || models[0];
                modelPath = path.join(modelDir, match);
              }
            }
          } catch { /* */ }

          if (!modelPath) {
            return { success: false, error: "No Whisper model downloaded. Go to Settings → Transcription to download a model, then retry." };
          }

          result = await this.whisperManager.transcribeLocalWhisper(buffer, { model: modelPath });
        } else {
          // Binary still not available — maybe auto-download was skipped
          return { success: false, error: "Whisper server binary not found. Restart the app to trigger auto-download, or run: npm run download:whisper-cpp" };
        }

        // Fall back to cloud transcription
        if (!result?.text) {
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) {
            const cookieHeader = await getSessionCookiesFromWindow(win);
            if (cookieHeader) {
              const apiUrl = getApiUrl();
              if (apiUrl) {
                const { body, boundary } = buildMultipartBody(buffer, "audio.webm", "audio/webm", {
                  clientType: "desktop",
                  appVersion: app.getVersion(),
                  sessionId: this.sessionId,
                });
                const url = new URL(`${apiUrl}/api/transcribe`);
                const data = await postMultipart(url, body, boundary, {
                  Cookie: cookieHeader,
                });
                if (data.statusCode === 200 && data.data?.text) {
                  result = { text: data.data.text, source: "openwhispr", model: "cloud" };
                }
              }
            }
          }
        }

        if (!result?.text) {
          return { success: false, error: "No transcription engine available" };
        }

        this.databaseManager.updateTranscriptionText(id, result.text, result.text);
        this.databaseManager.updateTranscriptionStatus(id, "completed");
        const provider = result.source || "local";
        const model = result.model || null;
        this.databaseManager.updateTranscriptionAudio(id, {
          hasAudio: 1,
          audioDurationMs: null,
          provider,
          model,
        });
        const updated = this.databaseManager.getTranscriptionById(id);
        if (updated) {
          setImmediate(() => {
            this.broadcastToWindows("transcription-updated", updated);
          });
        }
        return { success: true, transcription: updated };
      } catch (error) {
        debugLogger.error(
          "Retry transcription failed",
          { id, error: error.message },
          "audio-storage"
        );
        return { success: false, error: error.message };
      }
    });

    let meetingTranscriptionStartInProgress = false;
    let meetingTranscriptionPrepareInProgress = false;
    let meetingTranscriptionPreparePromise = null;

    let meetingSegmentCounter = 0;

    // Store on `this` so reconnection methods can access it
    this._attachMeetingStreamingHandlers = (streaming, win, source) => {
      attachMeetingStreamingHandlers(streaming, win, source);
    };

    const attachMeetingStreamingHandlers = (streaming, win, source) => {
      const send = (channel, data) => {
        if (!win || win.isDestroyed()) {
          debugLogger.error("Meeting segment send failed: window unavailable", {
            channel,
            source,
            winExists: !!win,
          });
          return;
        }
        win.webContents.send(channel, data);
      };

      streaming.onPartialTranscript = (text) => {
        send("meeting-transcription-segment", { text, source, type: "partial" });
      };
      streaming.onFinalTranscript = (text, timestamp) => {
        const segments = streaming.completedSegments;
        const latestSegment = segments.length > 0 ? segments[segments.length - 1] : text;
        debugLogger.debug("Meeting segment sending to renderer", {
          source,
          text: latestSegment.slice(0, 80),
          segmentCount: segments.length,
        });
        send("meeting-transcription-segment", {
          text: latestSegment,
          source,
          type: "final",
          timestamp,
        });

        // Feed transcript checkpoint for crash safety
        if (this._meetingTranscriptCheckpoint.isActive) {
          this._meetingTranscriptCheckpoint.addSegment({
            id: `seg-${++meetingSegmentCounter}`,
            text: latestSegment,
            source,
            timestamp,
          });
        }
      };
      streaming.onError = (error) => {
        send("meeting-transcription-error", error.message);
      };
      streaming.onSessionEnd = (data) => {
        // Unexpected disconnect — attempt reconnection
        if (!this._meetingReconnecting[source]) {
          debugLogger.log("Meeting stream ended unexpectedly, attempting reconnect", { source });
          send("meeting-transcription-error", `Connection lost for ${source} — reconnecting...`);
          this._attemptMeetingReconnect(source, win, streaming);
        }
      };
    };

    const fetchRealtimeToken = async (event, options, { streams } = {}) => {
      if (options.mode === "byok") {
        const apiKey = this.environmentManager.getOpenAIKey();
        if (!apiKey) throw new Error("No OpenAI API key configured. Add your key in Settings.");
        return streams === 2 ? [apiKey, apiKey] : apiKey;
      }

      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) throw new Error("No session cookies available");

      const tokenResponse = await fetch(`${apiUrl}/api/openai-realtime-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({
          model: options.model,
          language: options.language,
          streams: streams || 1,
        }),
      });

      if (!tokenResponse.ok) {
        const err = await tokenResponse.json().catch(() => ({}));
        throw new Error(err.error || `Token request failed: ${tokenResponse.status}`);
      }

      const data = await tokenResponse.json();
      if (streams === 2) {
        if (!data.clientSecrets || data.clientSecrets.length < 2) {
          throw new Error("Expected two client secrets for dual-stream");
        }
        return data.clientSecrets;
      }
      if (!data.clientSecret) throw new Error("No client secret received");
      return data.clientSecret;
    };

    const getMeetingSystemAudioMode = () =>
      this.audioTapManager?.isSupported() ? "native" : "unsupported";

    const hasNativeMeetingSystemAudio = () => getMeetingSystemAudioMode() === "native";

    const isMeetingStreamingConnected = () =>
      !!this._meetingMicStreaming?.isConnected &&
      (!hasNativeMeetingSystemAudio() || !!this._meetingSystemStreaming?.isConnected);

    const connectRealtimeStreaming = async (event, options) => {
      if (this._meetingMicStreaming?.isConnected) {
        await this._meetingMicStreaming.disconnect();
      }
      if (this._meetingSystemStreaming?.isConnected) {
        await this._meetingSystemStreaming.disconnect();
      }
      this._meetingMicStreaming = null;
      this._meetingSystemStreaming = null;
      const win = BrowserWindow.fromWebContents(event.sender);

      const connectOpts = {
        model: options.model,
        language: options.language,
        preconfigured: options.mode !== "byok",
      };
      let pairs;
      if (hasNativeMeetingSystemAudio()) {
        const secrets = await fetchRealtimeToken(event, options, { streams: 2 });
        pairs = [
          { ref: "_meetingMicStreaming", secret: secrets[0], source: "mic" },
          { ref: "_meetingSystemStreaming", secret: secrets[1], source: "system" },
        ];
      } else {
        pairs = [
          {
            ref: "_meetingMicStreaming",
            secret: await fetchRealtimeToken(event, options),
            source: "mic",
          },
        ];
      }

      for (const { ref, source } of pairs) {
        this[ref] = new OpenAIRealtimeStreaming();
        attachMeetingStreamingHandlers(this[ref], win, source);
      }

      await Promise.all(
        pairs.map(({ ref, secret }) => this[ref].connect({ apiKey: secret, ...connectOpts }))
      );

      return win;
    };

    let meetingSendCounts = { mic: 0, system: 0 };

    const resetMeetingStreamingState = () => {
      this._meetingMicStreaming = null;
      this._meetingSystemStreaming = null;
      meetingSendCounts = { mic: 0, system: 0 };
    };

    const disconnectMeetingStreaming = async () => {
      const results = await Promise.all([
        this._meetingMicStreaming
          ? this._meetingMicStreaming.disconnect().catch(() => ({ text: "" }))
          : Promise.resolve({ text: "" }),
        this._meetingSystemStreaming
          ? this._meetingSystemStreaming.disconnect().catch(() => ({ text: "" }))
          : Promise.resolve({ text: "" }),
      ]);

      resetMeetingStreamingState();
      return results;
    };

    const rollbackMeetingTranscriptionStart = async () => {
      if (this.audioTapManager) {
        await this.audioTapManager.stop().catch(() => {});
      }
      await disconnectMeetingStreaming().catch(() => {});
    };

    const setupDictationCallbacks = (streaming, event) => {
      streaming.onPartialTranscript = (text) =>
        event.sender.send("dictation-realtime-partial", text);
      streaming.onFinalTranscript = (text) => event.sender.send("dictation-realtime-final", text);
      streaming.onError = (err) => event.sender.send("dictation-realtime-error", err.message);
      streaming.onSessionEnd = (data) =>
        event.sender.send("dictation-realtime-session-end", data || {});
    };

    const connectDictationStreaming = async (event, options) => {
      if (this._dictationStreaming) {
        await this._dictationStreaming.disconnect().catch(() => {});
        this._dictationStreaming = null;
      }
      const isCloud = options.mode !== "byok";
      const apiKey = await fetchRealtimeToken(event, { mode: options.mode });
      const streaming = new OpenAIRealtimeStreaming();
      setupDictationCallbacks(streaming, event);
      await streaming.connect({
        apiKey,
        model: options.model || "gpt-4o-mini-transcribe",
        preconfigured: isCloud,
      });
      this._dictationStreaming = streaming;
    };

    // Pre-warm: fetch tokens + connect WebSockets before user hits record
    ipcMain.handle("meeting-transcription-prepare", async (event, options = {}) => {
      if (meetingTranscriptionPrepareInProgress || meetingTranscriptionStartInProgress) {
        debugLogger.debug("Meeting transcription prepare already in progress, ignoring");
        return { success: false, error: "Operation in progress" };
      }

      if (isMeetingStreamingConnected()) {
        debugLogger.debug("Meeting transcription already prepared (warm connections)");
        return { success: true, alreadyPrepared: true };
      }

      if (options.provider !== "openai-realtime") {
        return { success: false, error: `Unsupported provider: ${options.provider}` };
      }

      meetingTranscriptionPrepareInProgress = true;
      meetingTranscriptionPreparePromise = (async () => {
        try {
          await connectRealtimeStreaming(event, options);
          debugLogger.debug("Meeting transcription prepared (meeting streams warm)");
          return { success: true };
        } catch (error) {
          debugLogger.error("Meeting transcription prepare error", { error: error.message });
          return { success: false, error: error.message };
        } finally {
          meetingTranscriptionPrepareInProgress = false;
          meetingTranscriptionPreparePromise = null;
        }
      })();

      return meetingTranscriptionPreparePromise;
    });

    ipcMain.handle("meeting-transcription-start", async (event, options = {}) => {
      // Wait for any in-flight prepare to finish before starting
      if (meetingTranscriptionPreparePromise) {
        debugLogger.debug("Meeting transcription start: waiting for in-flight prepare");
        await meetingTranscriptionPreparePromise;
      }

      if (meetingTranscriptionStartInProgress) {
        debugLogger.debug("Meeting transcription start already in progress, ignoring");
        return { success: false, error: "Operation in progress" };
      }

      meetingTranscriptionStartInProgress = true;
      meetingSegmentCounter = 0;
      try {
        const systemAudioMode = getMeetingSystemAudioMode();

        // Start local audio buffer for crash safety
        this._meetingAudioBuffer.start();

        // Start transcript checkpoint if we have a noteId from the renderer
        if (options.noteId) {
          this._meetingTranscriptCheckpoint.start(options.noteId, {
            audioBufferDir: this._meetingAudioBuffer.getSessionDir(),
          });
        }

        // Start session rotation timer (rotate at 25min to avoid OpenAI's 30min limit)
        this._startMeetingSessionRotation(event, options);

        // If already prepared (warm connections from prepare), just re-attach handlers
        if (isMeetingStreamingConnected()) {
          debugLogger.debug("Meeting transcription start: reusing warm connections");
          const win = BrowserWindow.fromWebContents(event.sender);
          attachMeetingStreamingHandlers(this._meetingMicStreaming, win, "mic");
          if (systemAudioMode === "native") {
            attachMeetingStreamingHandlers(this._meetingSystemStreaming, win, "system");
            await startNativeMeetingSystemAudio(event);
          }
          return { success: true, systemAudioMode };
        }

        if (options.provider !== "openai-realtime") {
          return { success: false, error: `Unsupported provider: ${options.provider}` };
        }

        await connectRealtimeStreaming(event, options);
        if (systemAudioMode === "native") {
          await startNativeMeetingSystemAudio(event);
        }
        return { success: true, systemAudioMode };
      } catch (error) {
        await rollbackMeetingTranscriptionStart();
        this._meetingAudioBuffer.stop({ keepFiles: true }); // keep files for recovery
        this._meetingTranscriptCheckpoint.stop();
        this._stopMeetingSessionRotation();
        debugLogger.error("Meeting transcription start error", { error: error.message });
        return { success: false, error: error.message };
      } finally {
        meetingTranscriptionStartInProgress = false;
      }
    });

    const sendMeetingAudio = (audioBuffer, source) => {
      const streaming = source === "mic" ? this._meetingMicStreaming : this._meetingSystemStreaming;
      const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

      // Always write to local audio buffer for crash safety
      if (this._meetingAudioBuffer.isActive) {
        this._meetingAudioBuffer.writeChunk(buf, source);
      }

      if (!streaming) {
        if (meetingSendCounts[source] === 0) {
          debugLogger.error("Meeting audio send: no streaming instance", { source });
        }
        return;
      }
      const sent = streaming.sendAudio(buf);
      meetingSendCounts[source]++;
      if (meetingSendCounts[source] <= 5 || meetingSendCounts[source] % 100 === 0) {
        debugLogger.debug("Meeting audio send", {
          source,
          bytes: buf.length,
          sent,
          wsReady: streaming.ws?.readyState,
          totalSent: streaming.audioBytesSent,
          count: meetingSendCounts[source],
        });
      }
    };

    const startNativeMeetingSystemAudio = async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      await this.audioTapManager.start({
        onChunk: (chunk) => {
          sendMeetingAudio(chunk, "system");
        },
        onError: (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("meeting-transcription-error", error.message);
          }
        },
      });
    };

    ipcMain.on("meeting-transcription-send", (_event, audioBuffer, source) => {
      sendMeetingAudio(audioBuffer, source);
    });

    ipcMain.handle("meeting-transcription-stop", async () => {
      try {
        this._stopMeetingSessionRotation();

        if (this.audioTapManager) {
          await this.audioTapManager.stop();
        }

        // Force a final transcript checkpoint before disconnecting
        this._meetingTranscriptCheckpoint.forceCheckpoint();

        const results = await disconnectMeetingStreaming();

        // Stop audio buffer — keep files until cleanup is explicitly requested
        const audioResult = this._meetingAudioBuffer.stop({ keepFiles: true });
        const checkpointResult = this._meetingTranscriptCheckpoint.stop();

        return {
          success: true,
          transcript: [results[0]?.text, results[1]?.text].filter(Boolean).join(" "),
          audioBufferDir: audioResult.dir,
          audioFiles: audioResult.files,
          checkpointedSegments: checkpointResult.savedSegments,
        };
      } catch (error) {
        debugLogger.error("Meeting transcription stop error", { error: error.message });
        // Still try to stop buffer/checkpoint on error
        this._meetingAudioBuffer.stop({ keepFiles: true });
        this._meetingTranscriptCheckpoint.stop();
        this._stopMeetingSessionRotation();
        return { success: false, error: error.message };
      }
    });

    // Cleanup audio buffer files after they're no longer needed
    ipcMain.handle("meeting-audio-cleanup", async (_event, dir) => {
      try {
        this._meetingAudioBuffer.cleanupFiles(dir);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Start transcript checkpoint for a meeting note
    ipcMain.handle("meeting-checkpoint-start", async (_event, noteId) => {
      if (!noteId) return { success: false, error: "noteId required" };
      this._meetingTranscriptCheckpoint.start(noteId, {
        audioBufferDir: this._meetingAudioBuffer.getSessionDir(),
      });
      return { success: true };
    });

    ipcMain.handle("dictation-realtime-warmup", async (event, options = {}) => {
      try {
        await connectDictationStreaming(event, options);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle("dictation-realtime-start", async (event, options = {}) => {
      try {
        if (!this._dictationStreaming?.isConnected) await connectDictationStreaming(event, options);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.on("dictation-realtime-send", (_event, buffer) => {
      this._dictationStreaming?.sendAudio(Buffer.from(buffer));
    });

    ipcMain.handle("dictation-realtime-stop", async () => {
      if (!this._dictationStreaming) {
        return { success: true, text: "" };
      }
      const result = await this._dictationStreaming.disconnect().catch(() => ({ text: "" }));
      this._dictationStreaming = null;
      return { success: true, text: result.text || "" };
    });

    ipcMain.handle("update-transcription-text", async (_event, id, text, rawText) => {
      try {
        this.databaseManager.updateTranscriptionText(id, text, rawText);
        const updated = this.databaseManager.getTranscriptionById(id);
        return { success: true, transcription: updated };
      } catch (error) {
        debugLogger.error(
          "Failed to update transcription text",
          { id, error: error.message },
          "audio-storage"
        );
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cloud-reason", async (event, text, opts = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        debugLogger.debug(
          "Cloud reason request",
          {
            model: opts.model || "(default)",
            agentName: opts.agentName || "(none)",
            textLength: text?.length || 0,
          },
          "cloud-api"
        );

        const response = await fetch(`${apiUrl}/api/reason`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            text,
            model: opts.model,
            agentName: opts.agentName,
            customDictionary: opts.customDictionary,
            customPrompt: opts.customPrompt,
            systemPrompt: opts.systemPrompt,
            language: opts.language,
            locale: opts.locale,
            sessionId: this.sessionId,
            clientType: "desktop",
            appVersion: app.getVersion(),
            clientVersion: app.getVersion(),
            sttProvider: opts.sttProvider,
            sttModel: opts.sttModel,
            sttProcessingMs: opts.sttProcessingMs,
            sttWordCount: opts.sttWordCount,
            sttLanguage: opts.sttLanguage,
            audioDurationMs: opts.audioDurationMs,
            audioSizeBytes: opts.audioSizeBytes,
            audioFormat: opts.audioFormat,
            clientTotalMs: opts.clientTotalMs,
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `API error: ${response.status}`);
        }

        const data = await response.json();
        debugLogger.debug(
          "Cloud reason response",
          {
            model: data.model,
            provider: data.provider,
            resultLength: data.text?.length || 0,
            promptMode: data.promptMode,
            matchType: data.matchType,
          },
          "cloud-api"
        );
        return {
          success: true,
          text: data.text,
          model: data.model,
          provider: data.provider,
          promptMode: data.promptMode,
          matchType: data.matchType,
        };
      } catch (error) {
        debugLogger.error(`Cloud reasoning error: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cloud-agent-stream", async (event, messages, opts = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        debugLogger.debug(
          "Cloud agent stream request",
          { messageCount: messages?.length || 0 },
          "cloud-api"
        );

        const response = await fetch(`${apiUrl}/api/agent/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({
            messages,
            systemPrompt: opts.systemPrompt,
            sessionId: this.sessionId,
            clientType: "desktop",
            appVersion: app.getVersion(),
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          const errorData = await response.json().catch(() => ({}));
          return {
            success: false,
            error: errorData.error || `API error: ${response.status}`,
          };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            if (text) event.sender.send("agent-stream-chunk", text);
          }
        } finally {
          reader.releaseLock();
        }

        event.sender.send("agent-stream-done");
        return { success: true };
      } catch (error) {
        debugLogger.error(`Cloud agent stream error: ${error.message}`);
        event.sender.send("agent-stream-done");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle(
      "cloud-streaming-usage",
      async (event, text, audioDurationSeconds, opts = {}) => {
        try {
          const apiUrl = getApiUrl();
          if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

          const cookieHeader = await getSessionCookies(event);
          if (!cookieHeader) throw new Error("No session cookies available");

          const response = await fetch(`${apiUrl}/api/streaming-usage`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              text,
              audioDurationSeconds,
              sessionId: this.sessionId,
              clientType: "desktop",
              appVersion: app.getVersion(),
              clientVersion: app.getVersion(),
              sttProvider: opts.sttProvider,
              sttModel: opts.sttModel,
              sttProcessingMs: opts.sttProcessingMs,
              sttLanguage: opts.sttLanguage,
              audioSizeBytes: opts.audioSizeBytes,
              audioFormat: opts.audioFormat,
              clientTotalMs: opts.clientTotalMs,
              sendLogs: opts.sendLogs,
            }),
          });

          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }

          const data = await response.json();
          return { success: true, ...data };
        } catch (error) {
          debugLogger.error("Cloud streaming usage error", { error: error.message }, "cloud-api");
          return { success: false, error: error.message };
        }
      }
    );

    ipcMain.handle("cloud-usage", async (event) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const response = await fetch(`${apiUrl}/api/usage`, {
          headers: { Cookie: cookieHeader },
        });

        if (!response.ok) {
          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return { success: true, ...data };
      } catch (error) {
        debugLogger.error(`Cloud usage fetch error: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    const fetchStripeUrl = async (event, endpoint, errorPrefix, body) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const headers = { Cookie: cookieHeader };
        const fetchOpts = { method: "POST", headers };
        if (body) {
          headers["Content-Type"] = "application/json";
          fetchOpts.body = JSON.stringify(body);
        }

        const response = await fetch(`${apiUrl}${endpoint}`, fetchOpts);

        if (!response.ok) {
          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `API error: ${response.status}`);
        }

        const data = await response.json();
        return { success: true, url: data.url };
      } catch (error) {
        debugLogger.error(`${errorPrefix}: ${error.message}`);
        return { success: false, error: error.message };
      }
    };

    ipcMain.handle("cloud-checkout", (event, opts) =>
      fetchStripeUrl(event, "/api/stripe/checkout", "Cloud checkout error", opts || undefined)
    );

    ipcMain.handle("cloud-billing-portal", (event) =>
      fetchStripeUrl(event, "/api/stripe/portal", "Cloud billing portal error")
    );

    ipcMain.handle("cloud-switch-plan", async (event, opts) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const response = await fetch(`${apiUrl}/api/stripe/switch-plan`, {
          method: "POST",
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        });

        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }

        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || "Failed to switch plan" };
        }
        return data;
      } catch (error) {
        debugLogger.error(`Cloud switch plan error: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("cloud-preview-switch", async (event, opts) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const response = await fetch(`${apiUrl}/api/stripe/preview-switch`, {
          method: "POST",
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        });

        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }

        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || "Failed to preview plan change" };
        }
        return { success: true, ...data };
      } catch (error) {
        debugLogger.error(`Cloud preview switch error: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-stt-config", async (event) => {
      // WhisperWoof is local-first: most users won't be signed into
      // OpenWhispr cloud, so "not configured" / "no session" are
      // expected states, not errors. Return a clean not-configured
      // result without logging noise. Only real network / HTTP failures
      // are logged, and we log error.message (Error objects don't
      // JSON-serialize, so the old `error` arg rendered as "{}").
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        return { success: false, error: "not-configured", code: "NO_API_URL" };
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        return { success: false, error: "not-configured", code: "NO_SESSION" };
      }

      try {
        const response = await fetch(`${apiUrl}/api/stt-config`, {
          headers: { Cookie: cookieHeader },
        });

        if (!response.ok) {
          if (response.status === 401) {
            return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
          }
          debugLogger.error(`STT config fetch failed: HTTP ${response.status}`);
          return { success: false, error: `HTTP ${response.status}`, code: "HTTP_ERROR" };
        }

        const data = await response.json();
        return { success: true, ...data };
      } catch (error) {
        debugLogger.error(`STT config fetch error: ${error.message}`);
        return { success: false, error: error.message, code: "FETCH_ERROR" };
      }
    });

    ipcMain.handle("transcribe-audio-file-cloud", async (event, filePath) => {
      const fs = require("fs");
      const os = require("os");
      const { splitAudioFile } = require("./ffmpegUtils");
      const FILE_SIZE_LIMIT = 25 * 1024 * 1024;
      const CONCURRENCY_LIMIT = 5;
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) throw new Error("No session cookies available");

        const fileSize = fs.statSync(filePath).size;

        if (fileSize > FILE_SIZE_LIMIT) {
          debugLogger.debug("Large file detected, using client-side chunking", {
            fileSize,
            filePath: path.basename(filePath),
          });

          const chunkDir = path.join(os.tmpdir(), `ow-chunks-${Date.now()}`);
          fs.mkdirSync(chunkDir, { recursive: true });

          try {
            event.sender.send("upload-transcription-progress", {
              stage: "splitting",
              chunksTotal: 0,
              chunksCompleted: 0,
            });

            const chunkPaths = await splitAudioFile(filePath, chunkDir, {
              segmentDuration: 240, // ~3.75 MB/chunk, under Vercel's 4.5 MB payload limit
            });
            const totalChunks = chunkPaths.length;

            debugLogger.debug("Audio split into chunks", { totalChunks });

            event.sender.send("upload-transcription-progress", {
              stage: "transcribing",
              chunksTotal: totalChunks,
              chunksCompleted: 0,
            });

            const results = new Array(totalChunks).fill(null);
            let completedCount = 0;

            const transcribeChunk = async (index) => {
              const chunkBuffer = fs.readFileSync(chunkPaths[index]);
              const chunkName = path.basename(chunkPaths[index]);

              const { body, boundary } = buildMultipartBody(chunkBuffer, chunkName, "audio/mpeg", {
                source: "file_upload",
                clientType: "desktop",
                appVersion: app.getVersion(),
                clientVersion: app.getVersion(),
                sessionId: this.sessionId,
              });

              const url = new URL(`${apiUrl}/api/transcribe`);
              const data = await postMultipart(url, body, boundary, { Cookie: cookieHeader });

              if (data.statusCode === 401) {
                throw Object.assign(new Error("Session expired"), { code: "AUTH_EXPIRED" });
              }
              if (data.statusCode === 429) {
                throw Object.assign(new Error("Daily word limit reached"), {
                  code: "LIMIT_REACHED",
                  ...data.data,
                });
              }
              if (data.statusCode !== 200) {
                throw new Error(data.data?.error || `API error: ${data.statusCode}`);
              }

              results[index] = data.data;
              completedCount++;

              event.sender.send("upload-transcription-progress", {
                stage: "transcribing",
                chunksTotal: totalChunks,
                chunksCompleted: completedCount,
              });
            };

            const indices = Array.from({ length: totalChunks }, (_, i) => i);
            const executing = new Set();

            for (const index of indices) {
              const p = transcribeChunk(index).then(
                () => executing.delete(p),
                (err) => {
                  executing.delete(p);
                  if (err.code === "AUTH_EXPIRED" || err.code === "LIMIT_REACHED") throw err;
                  debugLogger.warn(`Chunk ${index} failed`, { error: err.message });
                }
              );
              executing.add(p);
              if (executing.size >= CONCURRENCY_LIMIT) {
                await Promise.race(executing);
              }
            }
            await Promise.all(executing);

            const succeeded = results.filter((r) => r !== null);
            if (succeeded.length === 0) {
              throw new Error("All chunks failed to transcribe");
            }

            const fullText = results
              .filter((r) => r !== null)
              .map((r) => r.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();

            const failed = results.filter((r) => r === null).length;
            if (failed > 0) {
              debugLogger.warn("Some chunks failed", { failed, total: totalChunks });
            }

            return {
              success: true,
              text: fullText,
              ...(failed > 0 ? { warning: `${failed} of ${totalChunks} chunks failed` } : {}),
            };
          } finally {
            try {
              fs.rmSync(chunkDir, { recursive: true, force: true });
            } catch (cleanupErr) {
              debugLogger.warn("Failed to cleanup chunk dir", { error: cleanupErr.message });
            }
          }
        }

        const audioBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase().replace(".", "");
        const contentType = AUDIO_MIME_TYPES[ext] || "audio/mpeg";
        const fileName = path.basename(filePath);

        const { body, boundary } = buildMultipartBody(audioBuffer, fileName, contentType, {
          source: "file_upload",
          clientType: "desktop",
          appVersion: app.getVersion(),
          clientVersion: app.getVersion(),
          sessionId: this.sessionId,
        });

        const url = new URL(`${apiUrl}/api/transcribe`);
        const data = await postMultipart(url, body, boundary, { Cookie: cookieHeader });

        if (data.statusCode === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        if (data.statusCode === 429) {
          return {
            success: false,
            error: "Daily word limit reached",
            code: "LIMIT_REACHED",
            ...data.data,
          };
        }
        if (data.statusCode !== 200) {
          throw new Error(data.data?.error || `API error: ${data.statusCode}`);
        }

        return { success: true, text: data.data.text };
      } catch (error) {
        debugLogger.error("Cloud audio file transcription error", { error: error.message });
        if (error.code === "AUTH_EXPIRED" || error.code === "LIMIT_REACHED") {
          return { success: false, error: error.message, code: error.code, ...error };
        }
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle(
      "transcribe-audio-file-byok",
      async (event, { filePath, apiKey, baseUrl, model }) => {
        const fs = require("fs");
        const BYOK_FILE_SIZE_LIMIT = 25 * 1024 * 1024; // 25 MB
        try {
          if (!apiKey) throw new Error("No API key configured. Add your key in Settings.");
          if (!baseUrl) throw new Error("No transcription endpoint configured.");

          const fileSize = fs.statSync(filePath).size;
          if (fileSize > BYOK_FILE_SIZE_LIMIT) {
            return {
              success: false,
              error: "File too large. Maximum size for bring-your-own-key is 25 MB.",
            };
          }

          const audioBuffer = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase().replace(".", "");
          const contentType = AUDIO_MIME_TYPES[ext] || "audio/mpeg";
          const fileName = path.basename(filePath);

          let transcriptionUrl = baseUrl.replace(/\/+$/, "");
          if (!transcriptionUrl.endsWith("/audio/transcriptions")) {
            transcriptionUrl += "/audio/transcriptions";
          }

          const { body, boundary } = buildMultipartBody(audioBuffer, fileName, contentType, {
            model: model || "whisper-1",
          });

          const url = new URL(transcriptionUrl);
          const data = await postMultipart(url, body, boundary, {
            Authorization: `Bearer ${apiKey}`,
          });

          if (data.statusCode === 401) {
            return { success: false, error: "Invalid API key. Check your key in Settings." };
          }
          if (data.statusCode === 429) {
            return { success: false, error: "Rate limit exceeded. Please try again later." };
          }
          if (data.statusCode !== 200) {
            throw new Error(
              data.data?.error?.message || data.data?.error || `API error: ${data.statusCode}`
            );
          }

          return { success: true, text: data.data.text };
        } catch (error) {
          debugLogger.error("BYOK audio file transcription error", { error: error.message });
          return { success: false, error: error.message };
        }
      }
    );

    ipcMain.handle("get-referral-stats", async (event) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          throw new Error("OpenWhispr API URL not configured");
        }

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }

        const response = await fetch(`${apiUrl}/api/referrals/stats`, {
          headers: {
            Cookie: cookieHeader,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Unauthorized - please sign in");
          }
          throw new Error(`Failed to fetch referral stats: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        debugLogger.error(`Error fetching referral stats: ${error.message}`);
        throw error;
      }
    });

    ipcMain.handle("send-referral-invite", async (event, email) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          throw new Error("OpenWhispr API URL not configured");
        }

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }

        const response = await fetch(`${apiUrl}/api/referrals/invite`, {
          method: "POST",
          headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to send invite: ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData.error) errorMessage = errorData.error;
          } catch (_) {}
          throw new Error(errorMessage);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        debugLogger.error(`Error sending referral invite: ${error.message}`);
        throw error;
      }
    });

    ipcMain.handle("get-referral-invites", async (event) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          throw new Error("OpenWhispr API URL not configured");
        }

        const cookieHeader = await getSessionCookies(event);
        if (!cookieHeader) {
          throw new Error("No session cookies available");
        }

        const response = await fetch(`${apiUrl}/api/referrals/invites`, {
          headers: {
            Cookie: cookieHeader,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Unauthorized - please sign in");
          }
          throw new Error(`Failed to fetch referral invites: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } catch (error) {
        debugLogger.error(`Error fetching referral invites: ${error.message}`);
        throw error;
      }
    });

    ipcMain.handle("open-whisper-models-folder", async () => {
      try {
        const modelsDir = this.whisperManager.getModelsDir();
        await shell.openPath(modelsDir);
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to open whisper models folder: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-ydotool-status", () => {
      const { getYdotoolStatus } = require("./ensureYdotool");
      const { execFileSync } = require("child_process");
      const status = getYdotoolStatus();
      const isKde = (process.env.XDG_CURRENT_DESKTOP || "").toLowerCase().includes("kde");
      let hasXclip = false;
      let hasXsel = false;
      if (isKde) {
        try {
          execFileSync("which", ["xclip"], { timeout: 1000 });
          hasXclip = true;
        } catch {}
        try {
          execFileSync("which", ["xsel"], { timeout: 1000 });
          hasXsel = true;
        } catch {}
      }
      return { ...status, isKde, hasXclip, hasXsel };
    });

    ipcMain.handle("get-debug-state", async () => {
      try {
        return {
          enabled: debugLogger.isEnabled(),
          logPath: debugLogger.getLogPath(),
          logLevel: debugLogger.getLevel(),
        };
      } catch (error) {
        debugLogger.error(`Failed to get debug state: ${error.message}`);
        return { enabled: false, logPath: null, logLevel: "info" };
      }
    });

    ipcMain.handle("set-debug-logging", async (event, enabled) => {
      try {
        const path = require("path");
        const fs = require("fs");
        const envPath = path.join(app.getPath("userData"), ".env");

        // Read current .env content
        let envContent = "";
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf8");
        }

        // Parse lines
        const lines = envContent.split("\n");
        const logLevelIndex = lines.findIndex((line) =>
          line.trim().startsWith("OPENWHISPR_LOG_LEVEL=")
        );

        if (enabled) {
          // Set to debug
          if (logLevelIndex !== -1) {
            lines[logLevelIndex] = "OPENWHISPR_LOG_LEVEL=debug";
          } else {
            // Add new line
            if (lines.length > 0 && lines[lines.length - 1] !== "") {
              lines.push("");
            }
            lines.push("# Debug logging setting");
            lines.push("OPENWHISPR_LOG_LEVEL=debug");
          }
        } else {
          // Remove or set to info
          if (logLevelIndex !== -1) {
            lines[logLevelIndex] = "OPENWHISPR_LOG_LEVEL=info";
          }
        }

        // Write back
        fs.writeFileSync(envPath, lines.join("\n"), "utf8");

        // Update environment variable
        process.env.OPENWHISPR_LOG_LEVEL = enabled ? "debug" : "info";

        // Refresh logger state
        debugLogger.refreshLogLevel();

        return {
          success: true,
          enabled: debugLogger.isEnabled(),
          logPath: debugLogger.getLogPath(),
        };
      } catch (error) {
        debugLogger.error(`Failed to set debug logging: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("open-logs-folder", async () => {
      try {
        const logsDir = path.join(app.getPath("userData"), "logs");
        await shell.openPath(logsDir);
        return { success: true };
      } catch (error) {
        debugLogger.error(`Failed to open logs folder: ${error.message}`);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("check-for-updates", async () => {
      return this.updateManager.checkForUpdates();
    });

    ipcMain.handle("download-update", async () => {
      return this.updateManager.downloadUpdate();
    });

    ipcMain.handle("install-update", async () => {
      return this.updateManager.installUpdate();
    });

    ipcMain.handle("get-app-version", async () => {
      return this.updateManager.getAppVersion();
    });

    ipcMain.handle("get-update-status", async () => {
      return this.updateManager.getUpdateStatus();
    });

    ipcMain.handle("get-update-info", async () => {
      return this.updateManager.getUpdateInfo();
    });

    const fetchStreamingToken = async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("OpenWhispr API URL not configured");
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await fetch(`${apiUrl}/api/streaming-token`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to get streaming token: ${tokenResponse.status}`
        );
      }

      const { token } = await tokenResponse.json();
      if (!token) {
        throw new Error("No token received from API");
      }

      return token;
    };

    ipcMain.handle("assemblyai-streaming-warmup", async (event, options = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        if (!this.assemblyAiStreaming) {
          this.assemblyAiStreaming = new AssemblyAiStreaming();
        }

        if (this.assemblyAiStreaming.hasWarmConnection()) {
          debugLogger.debug("AssemblyAI connection already warm", {}, "streaming");
          return { success: true, alreadyWarm: true };
        }

        let token = this.assemblyAiStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching new streaming token for warmup", {}, "streaming");
          token = await fetchStreamingToken(event);
        }

        await this.assemblyAiStreaming.warmup({ ...options, token });
        debugLogger.debug("AssemblyAI connection warmed up", {}, "streaming");

        return { success: true };
      } catch (error) {
        debugLogger.error("AssemblyAI warmup error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      }
    });

    let streamingStartInProgress = false;

    ipcMain.handle("assemblyai-streaming-start", async (event, options = {}) => {
      if (streamingStartInProgress) {
        debugLogger.debug("Streaming start already in progress, ignoring", {}, "streaming");
        return { success: false, error: "Operation in progress" };
      }

      streamingStartInProgress = true;
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);

        if (!this.assemblyAiStreaming) {
          this.assemblyAiStreaming = new AssemblyAiStreaming();
        }

        // Clean up any stale active connection (shouldn't happen normally)
        if (this.assemblyAiStreaming.isConnected) {
          debugLogger.debug(
            "AssemblyAI cleaning up stale connection before start",
            {},
            "streaming"
          );
          await this.assemblyAiStreaming.disconnect(false);
        }

        const hasWarm = this.assemblyAiStreaming.hasWarmConnection();
        debugLogger.debug(
          "AssemblyAI streaming start",
          { hasWarmConnection: hasWarm },
          "streaming"
        );

        let token = this.assemblyAiStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching streaming token from API", {}, "streaming");
          token = await fetchStreamingToken(event);
          this.assemblyAiStreaming.cacheToken(token);
        } else {
          debugLogger.debug("Using cached streaming token", {}, "streaming");
        }

        // Set up callbacks to forward events to renderer
        this.assemblyAiStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-partial-transcript", text);
          }
        };

        this.assemblyAiStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-final-transcript", text);
          }
        };

        this.assemblyAiStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-error", error.message);
          }
        };

        this.assemblyAiStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("assemblyai-session-end", data);
          }
        };

        await this.assemblyAiStreaming.connect({ ...options, token });
        debugLogger.debug("AssemblyAI streaming started", {}, "streaming");

        return {
          success: true,
          usedWarmConnection: this.assemblyAiStreaming.hasWarmConnection() === false,
        };
      } catch (error) {
        debugLogger.error("AssemblyAI streaming start error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      } finally {
        streamingStartInProgress = false;
      }
    });

    ipcMain.on("assemblyai-streaming-send", (event, audioBuffer) => {
      try {
        if (!this.assemblyAiStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        this.assemblyAiStreaming.sendAudio(buffer);
      } catch (error) {
        debugLogger.error("AssemblyAI streaming send error", { error: error.message });
      }
    });

    ipcMain.on("assemblyai-streaming-force-endpoint", () => {
      this.assemblyAiStreaming?.forceEndpoint();
    });

    ipcMain.handle("assemblyai-streaming-stop", async () => {
      try {
        let result = { text: "" };
        if (this.assemblyAiStreaming) {
          result = await this.assemblyAiStreaming.disconnect(true);
          this.assemblyAiStreaming.cleanupAll();
          this.assemblyAiStreaming = null;
        }

        return { success: true, text: result?.text || "" };
      } catch (error) {
        debugLogger.error("AssemblyAI streaming stop error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("assemblyai-streaming-status", async () => {
      if (!this.assemblyAiStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.assemblyAiStreaming.getStatus();
    });

    let deepgramTokenWindowId = null;

    const fetchDeepgramStreamingTokenFromWindow = async (windowId) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("OpenWhispr API URL not configured");

      const win = BrowserWindow.fromId(windowId);
      if (!win || win.isDestroyed()) throw new Error("Window not available for token refresh");

      const cookieHeader = await getSessionCookiesFromWindow(win);
      if (!cookieHeader) throw new Error("No session cookies available");

      const tokenResponse = await fetch(`${apiUrl}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        throw new Error(`Failed to get Deepgram streaming token: ${tokenResponse.status}`);
      }

      const { token } = await tokenResponse.json();
      if (!token) throw new Error("No token received from API");
      return token;
    };

    const fetchDeepgramStreamingToken = async (event) => {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("OpenWhispr API URL not configured");
      }

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await fetch(`${apiUrl}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        const errorData = await tokenResponse.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to get Deepgram streaming token: ${tokenResponse.status}`
        );
      }

      const { token } = await tokenResponse.json();
      if (!token) {
        throw new Error("No token received from API");
      }

      return token;
    };

    ipcMain.handle("deepgram-streaming-warmup", async (event, options = {}) => {
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          deepgramTokenWindowId = win.id;
        }

        if (!this.deepgramStreaming) {
          this.deepgramStreaming = new DeepgramStreaming();
        }

        this.deepgramStreaming.setTokenRefreshFn(async () => {
          if (!deepgramTokenWindowId) throw new Error("No window reference");
          return fetchDeepgramStreamingTokenFromWindow(deepgramTokenWindowId);
        });

        if (this.deepgramStreaming.hasWarmConnection()) {
          debugLogger.debug("Deepgram connection already warm", {}, "streaming");
          return { success: true, alreadyWarm: true };
        }

        let token = this.deepgramStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching new Deepgram streaming token for warmup", {}, "streaming");
          token = await fetchDeepgramStreamingToken(event);
        }

        await this.deepgramStreaming.warmup({ ...options, token });
        debugLogger.debug("Deepgram connection warmed up", {}, "streaming");

        return { success: true };
      } catch (error) {
        debugLogger.error("Deepgram warmup error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      }
    });

    let deepgramStreamingStartInProgress = false;
    let sendDropCount = 0;

    ipcMain.handle("deepgram-streaming-start", async (event, options = {}) => {
      if (deepgramStreamingStartInProgress) {
        debugLogger.debug(
          "Deepgram streaming start already in progress, ignoring",
          {},
          "streaming"
        );
        return { success: false, error: "Operation in progress" };
      }

      deepgramStreamingStartInProgress = true;
      try {
        const apiUrl = getApiUrl();
        if (!apiUrl) {
          return { success: false, error: "API not configured", code: "NO_API" };
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          deepgramTokenWindowId = win.id;
        }

        if (!this.deepgramStreaming) {
          this.deepgramStreaming = new DeepgramStreaming();
        }

        this.deepgramStreaming.setTokenRefreshFn(async () => {
          if (!deepgramTokenWindowId) throw new Error("No window reference");
          return fetchDeepgramStreamingTokenFromWindow(deepgramTokenWindowId);
        });

        if (this.deepgramStreaming.isConnected) {
          debugLogger.debug("Deepgram cleaning up stale connection before start", {}, "streaming");
          await this.deepgramStreaming.disconnect(false);
        }

        const hasWarm = this.deepgramStreaming.hasWarmConnection();
        debugLogger.debug("Deepgram streaming start", { hasWarmConnection: hasWarm }, "streaming");

        let token = this.deepgramStreaming.getCachedToken();
        if (!token) {
          debugLogger.debug("Fetching Deepgram streaming token from API", {}, "streaming");
          token = await fetchDeepgramStreamingToken(event);
          this.deepgramStreaming.cacheToken(token);
        } else {
          debugLogger.debug("Using cached Deepgram streaming token", {}, "streaming");
        }

        this.deepgramStreaming.onPartialTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-partial-transcript", text);
          }
        };

        this.deepgramStreaming.onFinalTranscript = (text) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-final-transcript", text);
          }
        };

        this.deepgramStreaming.onError = (error) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-error", error.message);
          }
        };

        this.deepgramStreaming.onSessionEnd = (data) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("deepgram-session-end", data);
          }
        };

        sendDropCount = 0;
        await this.deepgramStreaming.connect({ ...options, token });
        debugLogger.debug(
          "Deepgram streaming started",
          {
            isConnected: this.deepgramStreaming.isConnected,
            hasWs: !!this.deepgramStreaming.ws,
            wsReadyState: this.deepgramStreaming.ws?.readyState,
            forceNew: !!options.forceNew,
          },
          "streaming"
        );

        return {
          success: true,
          usedWarmConnection: hasWarm && !options.forceNew,
        };
      } catch (error) {
        debugLogger.error("Deepgram streaming start error", { error: error.message });
        if (error.code === "AUTH_EXPIRED") {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        return { success: false, error: error.message };
      } finally {
        deepgramStreamingStartInProgress = false;
      }
    });

    ipcMain.on("deepgram-streaming-send", (event, audioBuffer) => {
      try {
        if (!this.deepgramStreaming) return;
        const buffer = Buffer.from(audioBuffer);
        const sent = this.deepgramStreaming.sendAudio(buffer);
        if (!sent) {
          sendDropCount++;
          if (sendDropCount <= 3 || sendDropCount % 50 === 0) {
            debugLogger.warn(
              "Deepgram audio send dropped",
              {
                dropCount: sendDropCount,
                hasWs: !!this.deepgramStreaming.ws,
                isConnected: this.deepgramStreaming.isConnected,
                wsReadyState: this.deepgramStreaming.ws?.readyState,
              },
              "streaming"
            );
          }
        } else {
          if (sendDropCount > 0) {
            debugLogger.debug(
              "Deepgram audio send resumed after drops",
              {
                previousDrops: sendDropCount,
              },
              "streaming"
            );
            sendDropCount = 0;
          }
        }
      } catch (error) {
        debugLogger.error("Deepgram streaming send error", { error: error.message });
      }
    });

    ipcMain.on("deepgram-streaming-finalize", () => {
      this.deepgramStreaming?.finalize();
    });

    ipcMain.handle("deepgram-streaming-stop", async () => {
      try {
        const model = this.deepgramStreaming?.currentModel || "nova-3";
        const audioBytesSent = this.deepgramStreaming?.audioBytesSent || 0;
        let result = { text: "" };
        if (this.deepgramStreaming) {
          result = await this.deepgramStreaming.disconnect(true);
        }

        return { success: true, text: result?.text || "", model, audioBytesSent };
      } catch (error) {
        debugLogger.error("Deepgram streaming stop error", { error: error.message });
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("deepgram-streaming-status", async () => {
      if (!this.deepgramStreaming) {
        return { isConnected: false, sessionId: null };
      }
      return this.deepgramStreaming.getStatus();
    });

    // Agent mode handlers
    ipcMain.handle("update-agent-hotkey", async (_event, hotkey) => {
      const hotkeyManager = this.windowManager.hotkeyManager;
      const agentCallback = this.windowManager._agentHotkeyCallback;
      if (!agentCallback) {
        return { success: false, message: "Agent hotkey callback not initialized" };
      }

      if (!hotkey) {
        hotkeyManager.unregisterSlot("agent");
        this.environmentManager.saveAgentKey?.("");
        return { success: true, message: "Agent hotkey cleared" };
      }

      const result = await hotkeyManager.registerSlot("agent", hotkey, agentCallback);
      if (result.success) {
        this.environmentManager.saveAgentKey?.(hotkey);
        return { success: true, message: `Agent hotkey updated to: ${hotkey}` };
      }

      return {
        success: false,
        message: result.error || `Failed to update agent hotkey to: ${hotkey}`,
      };
    });

    ipcMain.handle("get-agent-key", async () => {
      return this.environmentManager.getAgentKey?.() || "";
    });

    ipcMain.handle("save-agent-key", async (_event, key) => {
      return this.environmentManager.saveAgentKey?.(key) || { success: true };
    });

    ipcMain.handle("toggle-agent-overlay", async () => {
      this.windowManager.toggleAgentOverlay();
      return { success: true };
    });

    ipcMain.handle("hide-agent-overlay", async () => {
      this.windowManager.hideAgentOverlay();
      return { success: true };
    });

    ipcMain.handle("resize-agent-window", async (_event, width, height) => {
      this.windowManager.resizeAgentWindow(width, height);
      return { success: true };
    });

    ipcMain.handle("get-agent-window-bounds", async () => {
      return this.windowManager.getAgentWindowBounds();
    });

    ipcMain.handle("set-agent-window-bounds", async (_event, x, y, width, height) => {
      this.windowManager.setAgentWindowBounds(x, y, width, height);
      return { success: true };
    });

    ipcMain.handle("acquire-recording-lock", async (_event, pipeline) => {
      if (this._activeRecordingPipeline && this._activeRecordingPipeline !== pipeline) {
        return { success: false, holder: this._activeRecordingPipeline };
      }
      this._activeRecordingPipeline = pipeline;
      return { success: true };
    });

    ipcMain.handle("release-recording-lock", async (_event, pipeline) => {
      if (this._activeRecordingPipeline === pipeline) {
        this._activeRecordingPipeline = null;
      }
      return { success: true };
    });

    // Google Calendar
    ipcMain.handle("gcal-start-oauth", async () => {
      try {
        return await this.googleCalendarManager.startOAuth();
      } catch (error) {
        debugLogger.error("Google Calendar OAuth failed", { error: error.message }, "calendar");
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("gcal-disconnect", async () => {
      try {
        this.googleCalendarManager.disconnect();
        return { success: true };
      } catch (error) {
        debugLogger.error(
          "Google Calendar disconnect failed",
          { error: error.message },
          "calendar"
        );
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("gcal-get-connection-status", async () => {
      try {
        return this.googleCalendarManager.getConnectionStatus();
      } catch (error) {
        return { connected: false, email: null };
      }
    });

    ipcMain.handle("gcal-get-calendars", async () => {
      try {
        return { success: true, calendars: this.googleCalendarManager.getCalendars() };
      } catch (error) {
        return { success: false, calendars: [] };
      }
    });

    ipcMain.handle("gcal-set-calendar-selection", async (_event, calendarId, isSelected) => {
      try {
        await this.googleCalendarManager.setCalendarSelection(calendarId, isSelected);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("gcal-sync-events", async () => {
      try {
        await this.googleCalendarManager.syncEvents();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("gcal-get-upcoming-events", async (_event, windowMinutes) => {
      try {
        return {
          success: true,
          events: await this.googleCalendarManager.getUpcomingEvents(windowMinutes),
        };
      } catch (error) {
        return { success: false, events: [] };
      }
    });

    ipcMain.handle("meeting-detection-get-preferences", async () => {
      try {
        return { success: true, preferences: this.meetingDetectionEngine.getPreferences() };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("meeting-detection-set-preferences", async (_event, prefs) => {
      try {
        this.meetingDetectionEngine.setPreferences(prefs);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("meeting-detection-respond", async (_event, detectionId, action) => {
      try {
        this.meetingDetectionEngine.handleUserResponse(detectionId, action);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("meeting-notification-respond", async (_event, detectionId, action) => {
      try {
        await this.meetingDetectionEngine.handleNotificationResponse(detectionId, action);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-meeting-notification-data", async () => {
      return this.windowManager?._pendingNotificationData ?? null;
    });

    ipcMain.handle("meeting-notification-ready", async () => {
      this.windowManager?.showNotificationWindow();
    });

    ipcMain.handle("get-update-notification-data", async () => {
      return this.windowManager?._pendingUpdateNotificationData ?? null;
    });

    ipcMain.handle("update-notification-ready", async () => {
      this.windowManager?.showUpdateNotificationWindow();
    });

    ipcMain.handle("update-notification-respond", async (_event, action) => {
      this.windowManager?.dismissUpdateNotification();
      if (action === "update") {
        try {
          await this.updateManager?.downloadUpdate();
        } catch (error) {
          console.error("Failed to start update download from notification:", error);
        }
      }
      return { success: true };
    });

    // --- Storage Manager ---

    ipcMain.handle("whisperwoof-storage-usage", async () => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.getStorageUsage();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-usage failed: ${error.message}`);
        return null;
      }
    });

    ipcMain.handle("whisperwoof-storage-entries", async (_event, options) => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.getEntriesForStorageView(options);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-entries failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-storage-delete-batch", async (_event, ids) => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.deleteEntriesWithCleanup(ids);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-delete-batch failed: ${error.message}`);
        return { deleted: 0, filesRemoved: 0 };
      }
    });

    ipcMain.handle("whisperwoof-storage-delete-by-source", async (_event, source) => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.deleteEntriesBySource(source);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-delete-by-source failed: ${error.message}`);
        return { deleted: 0, filesRemoved: 0 };
      }
    });

    ipcMain.handle("whisperwoof-storage-delete-older", async (_event, days) => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.deleteEntriesOlderThan(days);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-delete-older failed: ${error.message}`);
        return { deleted: 0, filesRemoved: 0 };
      }
    });

    ipcMain.handle("whisperwoof-storage-export", async (_event, ids) => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.exportEntries(ids);
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-export failed: ${error.message}`);
        return [];
      }
    });

    ipcMain.handle("whisperwoof-storage-cleanup-orphans", async () => {
      try {
        const sm = require("../whisperwoof/bridge/storage-manager");
        sm.setDatabase(require("../whisperwoof/bridge/app-init").getWhisperWoofDb());
        return sm.cleanupOrphanedFiles();
      } catch (error) {
        debugLogger.log(`[WhisperWoof] storage-cleanup-orphans failed: ${error.message}`);
        return { removed: 0, bytes: 0 };
      }
    });

    // --- Eval Dataset ---

    ipcMain.handle("whisperwoof-rate-transcription", async (_event, params) => {
      try {
        const { rateTranscription } = require("../whisperwoof/bridge/eval-dataset");
        return rateTranscription(params);
      } catch (error) {
        debugLogger.log(`[EvalDataset] rate failed: ${error.message}`);
        return null;
      }
    });

    ipcMain.handle("whisperwoof-get-eval-entries", async (_event, filter) => {
      try {
        const { getEvalEntries } = require("../whisperwoof/bridge/eval-dataset");
        return getEvalEntries(filter || {});
      } catch (error) { return []; }
    });

    ipcMain.handle("whisperwoof-get-eval-stats", async () => {
      try {
        const { getEvalStats } = require("../whisperwoof/bridge/eval-dataset");
        return getEvalStats();
      } catch (error) { return { total: 0, good: 0, bad: 0, withAudio: 0 }; }
    });

    ipcMain.handle("whisperwoof-delete-eval-entry", async (_event, id) => {
      try {
        const { deleteEvalEntry } = require("../whisperwoof/bridge/eval-dataset");
        deleteEvalEntry(id);
        return { success: true };
      } catch (error) { return { success: false }; }
    });

    // --- STT Model Comparison ---

    ipcMain.handle("whisperwoof-transcribe-with-model", async (_event, audioBlob, modelName) => {
      try {
        if (!this.whisperManager) return { success: false, error: "Whisper not available" };
        const result = await this.whisperManager.transcribeLocalWhisper(audioBlob, { model: modelName });
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  broadcastToWindows(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }

  // --- Meeting session rotation & reconnection ---

  _startMeetingSessionRotation(event, options) {
    this._stopMeetingSessionRotation();

    this._meetingStreamingStartedAt = Date.now();
    this._meetingStreamingEvent = event;
    this._meetingStreamingOptions = options;

    // Check every 30s if sessions need rotation
    this._meetingSessionRotationTimer = setInterval(() => {
      this._checkMeetingSessionRotation();
    }, 30_000);
  }

  _stopMeetingSessionRotation() {
    if (this._meetingSessionRotationTimer) {
      clearInterval(this._meetingSessionRotationTimer);
      this._meetingSessionRotationTimer = null;
    }
    this._meetingStreamingStartedAt = null;
    this._meetingStreamingEvent = null;
    this._meetingStreamingOptions = null;
    this._meetingReconnecting = {};
  }

  async _checkMeetingSessionRotation() {
    if (!this._meetingStreamingStartedAt) return;

    const SESSION_MAX_AGE_MS = 25 * 60 * 1000; // 25min (5min before OpenAI's ~30min limit)
    const age = Date.now() - this._meetingStreamingStartedAt;

    if (age < SESSION_MAX_AGE_MS) return;

    debugLogger.log("Meeting session rotation triggered", { ageMs: age });

    const event = this._meetingStreamingEvent;
    const options = this._meetingStreamingOptions;
    if (!event || !options) return;

    try {
      // Force checkpoint before rotation
      this._meetingTranscriptCheckpoint.forceCheckpoint();

      // Disconnect old streams
      const oldMicStreaming = this._meetingMicStreaming;
      const oldSystemStreaming = this._meetingSystemStreaming;

      // Create new connections
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) return;

      // Fetch new tokens and reconnect
      // (reuse the existing connectRealtimeStreaming which is closure-scoped in setupHandlers)
      // Instead, we'll use the reconnect method which has access to the closures
      this._meetingStreamingStartedAt = Date.now();

      // Notify renderer about rotation
      win.webContents.send("meeting-transcription-error", "Session rotating for stability...");

      // Disconnect old streams gracefully (they'll produce final transcript)
      if (oldMicStreaming) await oldMicStreaming.disconnect().catch(() => {});
      if (oldSystemStreaming) await oldSystemStreaming.disconnect().catch(() => {});

      // The onSessionEnd handler will trigger reconnection automatically
    } catch (err) {
      debugLogger.error("Meeting session rotation failed", { error: err.message });
    }
  }

  async _attemptMeetingReconnect(source, win, _oldStreaming) {
    const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

    if (this._meetingReconnecting[source]) return;
    this._meetingReconnecting[source] = true;

    // Force checkpoint immediately on disconnect
    this._meetingTranscriptCheckpoint.forceCheckpoint();

    const options = this._meetingStreamingOptions;
    const event = this._meetingStreamingEvent;
    if (!options || !event) {
      this._meetingReconnecting[source] = false;
      return;
    }

    for (let attempt = 0; attempt < RECONNECT_DELAYS.length; attempt++) {
      const delay = RECONNECT_DELAYS[attempt];
      debugLogger.log("Meeting reconnect attempt", { source, attempt, delayMs: delay });

      await new Promise((resolve) => setTimeout(resolve, delay));

      if (!this._meetingAudioBuffer.isActive) {
        debugLogger.log("Meeting stopped during reconnect, aborting", { source });
        break;
      }

      try {
        const OpenAIRealtimeStreaming = require("./openaiRealtimeStreaming");
        const streaming = new OpenAIRealtimeStreaming();

        // Fetch a fresh token
        let token;
        if (options.mode === "byok") {
          token = this.environmentManager.getOpenAIKey();
        } else {
          const apiUrl = this.environmentManager.getApiUrl?.() || "";
          const cookieHeader = await this._getSessionCookiesForEvent?.(event);
          // Simplified: reuse existing token fetch via IPC re-invocation pattern
          // For byok mode, just use the stored key
          token = this.environmentManager.getOpenAIKey();
        }

        if (!token) {
          debugLogger.error("Meeting reconnect: no token available", { source });
          continue;
        }

        this._attachMeetingStreamingHandlers(streaming, win, source);

        await streaming.connect({
          apiKey: token,
          model: options.model || "gpt-4o-mini-transcribe",
          preconfigured: options.mode !== "byok",
        });

        // Swap the streaming instance
        if (source === "mic") {
          this._meetingMicStreaming = streaming;
        } else {
          this._meetingSystemStreaming = streaming;
        }

        debugLogger.log("Meeting reconnected", { source, attempt });

        if (win && !win.isDestroyed()) {
          win.webContents.send("meeting-transcription-error", `${source} reconnected`);
        }

        this._meetingReconnecting[source] = false;
        return;
      } catch (err) {
        debugLogger.error("Meeting reconnect failed", {
          source,
          attempt,
          error: err.message,
        });
      }
    }

    debugLogger.error("Meeting reconnect exhausted all attempts", { source });
    if (win && !win.isDestroyed()) {
      win.webContents.send(
        "meeting-transcription-error",
        `${source} connection lost. Audio is saved locally for recovery.`
      );
    }
    this._meetingReconnecting[source] = false;
  }
}

module.exports = IPCHandlers;
