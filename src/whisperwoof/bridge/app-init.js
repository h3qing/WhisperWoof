/**
 * WhisperWoof App Initialization (CommonJS — loaded by main.js)
 *
 * This is the main-process entry point for WhisperWoof.
 * TypeScript modules in src/whisperwoof/core/ are used for the renderer
 * and test builds (via Vite/Vitest). This JS file bridges the main process.
 *
 * Phase 0: Logs initialization only.
 * Phase 1a: StorageProvider wired up — creates WhisperWoof tables in OpenWhispr DB.
 */

const crypto = require("crypto");
const fs = require("fs");
const { app, clipboard, nativeImage } = require("electron");
const Database = require("better-sqlite3");
const path = require("path");
const debugLogger = require("../../helpers/debugLogger");
const clipboardPure = require("./clipboard-pure");

let initialized = false;
let whisperwoofDb = null;
let clipboardInterval = null;
let lastClipboardText = "";

// Dedup: track recent voice transcriptions so clipboard monitor skips them.
// When voice text is pasted at cursor, it appears on clipboard — we don't want
// to capture it again as a "clipboard" entry.
const recentVoiceTexts = new Set();
const VOICE_DEDUP_TTL_MS = 10000; // forget after 10 seconds (was 5s, too short for rapid dictation)

function markAsVoiceTranscription(text) {
  if (!text) return;
  const trimmed = text.trim();
  recentVoiceTexts.add(trimmed);
  setTimeout(() => recentVoiceTexts.delete(trimmed), VOICE_DEDUP_TTL_MS);
}

function createWhisperWoofTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bf_entries (
      id TEXT PRIMARY KEY,
      created_at TEXT,
      source TEXT CHECK(source IN ('voice','clipboard','meeting','import')),
      raw_text TEXT,
      polished TEXT,
      routed_to TEXT,
      hotkey_used TEXT,
      duration_ms INTEGER,
      project_id TEXT,
      audio_path TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS bf_projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT,
      integration_target TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS bf_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      action TEXT,
      entity_id TEXT,
      detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_bf_entries_created_at ON bf_entries(created_at);
    CREATE INDEX IF NOT EXISTS idx_bf_entries_source ON bf_entries(source);
    CREATE INDEX IF NOT EXISTS idx_bf_entries_project_id ON bf_entries(project_id);
  `);
}

function createFtsTables(db) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS bf_entries_fts USING fts5(
      raw_text,
      polished,
      content=bf_entries
    );
  `);

  // FTS triggers: keep bf_entries_fts in sync with bf_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS bf_entries_fts_insert
    AFTER INSERT ON bf_entries BEGIN
      INSERT INTO bf_entries_fts(rowid, raw_text, polished)
      VALUES (NEW.rowid, NEW.raw_text, NEW.polished);
    END;

    CREATE TRIGGER IF NOT EXISTS bf_entries_fts_delete
    AFTER DELETE ON bf_entries BEGIN
      INSERT INTO bf_entries_fts(bf_entries_fts, rowid, raw_text, polished)
      VALUES ('delete', OLD.rowid, OLD.raw_text, OLD.polished);
    END;

    CREATE TRIGGER IF NOT EXISTS bf_entries_fts_update
    AFTER UPDATE ON bf_entries BEGIN
      INSERT INTO bf_entries_fts(bf_entries_fts, rowid, raw_text, polished)
      VALUES ('delete', OLD.rowid, OLD.raw_text, OLD.polished);
      INSERT INTO bf_entries_fts(rowid, raw_text, polished)
      VALUES (NEW.rowid, NEW.raw_text, NEW.polished);
    END;
  `);
}

// Best-effort capture of the app that was frontmost when the clipboard changed
// (a reliable proxy for "where this was copied from"). Only called on an actual
// new capture, so the ~50ms NSWorkspace lookup doesn't run on every poll tick.
async function captureSourceApp() {
  try {
    const { detectActiveApp } = require("./context-detector");
    const app = await detectActiveApp();
    if (!app || !app.name) return undefined;
    return { name: app.name, bundleId: app.bundleId || "" };
  } catch {
    return undefined;
  }
}

// ── Clipboard monitor ─────────────────────────────────────────────────────
// Polls every 500ms. Text is cheap to read. Images are noticed by a key made
// from the pasteboard's raw bytes, so an image that sits on the clipboard is
// never decoded again (reading it as a NativeImage every tick decoded e.g. a
// 5K screenshot twice a second for as long as it stayed there). A Finder copy
// of photos is captured as the photos themselves, not as their file names and
// Finder icon. Copying something again moves its entry to the top instead of
// adding a duplicate.

const CLIPBOARD_POLL_MS = 500;
const IMAGE_KEY_SAMPLE_BYTES = 256 * 1024;
const THUMB_WIDTH = 480;
const MAX_CAPTURED_FILE_BYTES = 200 * 1024 * 1024;
let lastImageKey = "";

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

function clipboardImagesDir() {
  const dir = path.join(app.getPath("userData"), "whisperwoof-images");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Image bytes as the copying app put them on the pasteboard, without decoding (macOS). */
function readRawImage() {
  for (const format of ["public.png", "public.tiff"]) {
    try {
      const bytes = clipboard.readBuffer(format);
      if (bytes && bytes.length > 0) return { bytes, format };
    } catch {
      // format not on the pasteboard
    }
  }
  return null;
}

/** Files copied in Finder, in copy order ([] when the copy isn't files). */
function readCopiedFiles() {
  let paths = [];
  try {
    paths = clipboardPure.parseFilenamesPlist(clipboard.read("NSFilenamesPboardType"));
  } catch {
    // not a file copy
  }
  if (paths.length === 0) {
    try {
      const one = clipboardPure.fileUrlToPath(clipboard.read("public.file-url"));
      if (one) paths = [one];
    } catch {
      // not a file copy
    }
  }
  return paths;
}

/** What image the clipboard holds right now, as a cheap comparison key ("" = none). */
function readClipboardImage() {
  const copied = readCopiedFiles();
  // A file copy also carries the Finder icon as image data: only the photos
  // among the files count. Other files stay text (their names), as before.
  if (copied.length > 0 && !copied.some(clipboardPure.isImageFile)) return { key: "" };
  const files = copied.filter(clipboardPure.isImageFile).slice(0, clipboardPure.MAX_FILES_PER_COPY);
  if (files.length > 0) {
    const parts = files.map((file) => {
      try {
        const stat = fs.statSync(file);
        return `${file}:${stat.size}:${stat.mtimeMs}`;
      } catch {
        return file;
      }
    });
    return { key: `files:${parts.join("|")}`, files };
  }
  const raw = readRawImage();
  if (raw) {
    return { key: `raw:${raw.bytes.length}:${sha1(raw.bytes.subarray(0, IMAGE_KEY_SAMPLE_BYTES))}`, raw };
  }
  // Other platforms (or unusual pasteboard types): only the decoded image is readable.
  const formats = clipboard.availableFormats();
  if (formats.some((f) => f.startsWith("image/"))) {
    return { key: `formats:${formats.join(",")}:${clipboard.readText() || ""}`, decode: true };
  }
  return { key: "" };
}

/** Take whatever is on the clipboard now as already seen (startup, and after the app writes it). */
function adoptCurrentClipboard() {
  lastClipboardText = clipboard.readText() || "";
  lastImageKey = readClipboardImage().key;
}

function bumpClipboardEntry(id) {
  whisperwoofDb?.prepare("UPDATE bf_entries SET created_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

/** Same pixels regardless of how an app encoded them: size plus a tiny downscaled bitmap. */
function imageFingerprint(image) {
  const { width, height } = image.getSize();
  return `${width}x${height}:${sha1(image.resize({ width: 32 }).toBitmap())}`;
}

async function storeClipboardImage({ image, bytes, ext, fileName }) {
  if (!whisperwoofDb || image.isEmpty()) return;
  const fingerprint = imageFingerprint(image);
  const existing = whisperwoofDb
    .prepare("SELECT id FROM bf_entries WHERE source = 'clipboard' AND metadata LIKE ? LIMIT 1")
    .get(`%"fingerprint":"${fingerprint}"%`);
  if (existing) {
    bumpClipboardEntry(existing.id);
    return;
  }

  const { width, height } = image.getSize();
  const id = crypto.randomUUID();
  const dir = clipboardImagesDir();
  const imagePath = path.join(dir, `${id}${ext}`);
  fs.writeFileSync(imagePath, bytes);
  const thumb = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH }) : image;
  const thumbBytes = thumb.toPNG();
  const thumbPath = path.join(dir, `${id}_thumb.png`);
  fs.writeFileSync(thumbPath, thumbBytes);

  const sourceApp = await captureSourceApp();
  saveWhisperWoofEntry({
    source: "clipboard",
    rawText: clipboardPure.imageEntryText({ width, height, fileName }),
    polished: null,
    routedTo: null,
    hotkeyUsed: null,
    durationMs: null,
    projectId: null,
    audioPath: imagePath,
    metadata: {
      type: "image",
      width,
      height,
      thumbPath,
      sourceApp,
      fingerprint,
      bytes: bytes.length + thumbBytes.length,
      ...(fileName ? { fileName } : {}),
    },
  });
  debugLogger.debug("[WhisperWoof] Clipboard image captured", { width, height, fromFile: Boolean(fileName) });
}

async function captureCopiedImageFile(filePath) {
  try {
    if (fs.statSync(filePath).size > MAX_CAPTURED_FILE_BYTES) return;
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return; // a format macOS can't read
    await storeClipboardImage({
      image,
      bytes: fs.readFileSync(filePath),
      ext: clipboardPure.extensionOf(filePath) || ".png",
      fileName: path.basename(filePath),
    });
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Copied photo not captured", { error: err.message });
  }
}

async function captureClipboardImageData(found) {
  let image;
  let bytes;
  if (found.raw?.format === "public.png") {
    bytes = found.raw.bytes; // stored as the app wrote it: no re-encode
    image = nativeImage.createFromBuffer(bytes);
  } else {
    image = found.raw ? nativeImage.createFromBuffer(found.raw.bytes) : clipboard.readImage();
    if (image.isEmpty()) image = clipboard.readImage();
    bytes = image.toPNG();
  }
  await storeClipboardImage({ image, bytes, ext: ".png", fileName: null });
}

function afterClipboardChange({ imageAdded = false } = {}) {
  try {
    const store = require("./clipboard-store");
    if (imageAdded) store.prune();
    store.notifyChanged();
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Clipboard follow-up failed", { error: err.message });
  }
}

async function pollClipboard() {
  const found = readClipboardImage();
  if (found.key) {
    if (found.key === lastImageKey) return;
    lastImageKey = found.key;
    // The file name or alt text that came with it belongs to this copy.
    lastClipboardText = clipboard.readText() || "";
    if (found.files) {
      for (const file of found.files) await captureCopiedImageFile(file);
    } else {
      await captureClipboardImageData(found);
    }
    afterClipboardChange({ imageAdded: true });
    return;
  }
  lastImageKey = "";

  const currentText = clipboard.readText() || "";
  if (currentText === lastClipboardText) return;
  lastClipboardText = currentText;
  // Skip empty and very short text (likely accidental)
  if (currentText.trim().length < 2) return;
  // WhisperWoof dedup: skip if this text was just voice-transcribed
  // (pasting voice text puts it on clipboard — don't double-capture)
  if (recentVoiceTexts.has(currentText.trim())) return;
  if (!whisperwoofDb) return;

  const existing = whisperwoofDb
    .prepare(
      "SELECT id FROM bf_entries WHERE source = 'clipboard' AND raw_text = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(currentText);
  if (existing) {
    bumpClipboardEntry(existing.id);
  } else {
    const sourceApp = await captureSourceApp();
    saveWhisperWoofEntry({
      source: "clipboard",
      rawText: currentText,
      polished: null,
      routedTo: null,
      hotkeyUsed: null,
      durationMs: null,
      projectId: null,
      audioPath: null,
      metadata: { sourceApp },
    });
    debugLogger.debug("[WhisperWoof] Clipboard entry captured", { length: currentText.length });
  }
  afterClipboardChange();
}

function startClipboardMonitor() {
  if (clipboardInterval) return;
  adoptCurrentClipboard();
  let polling = false;
  clipboardInterval = setInterval(async () => {
    if (polling) return; // a slow capture (big photo) must not overlap the next tick
    polling = true;
    try {
      await pollClipboard();
    } catch (err) {
      // Never crash the poll loop
      debugLogger.debug("[WhisperWoof] Clipboard poll error", { error: err.message });
    } finally {
      polling = false;
    }
  }, CLIPBOARD_POLL_MS);

  debugLogger.log("[WhisperWoof] Clipboard monitoring started");
}

function stopClipboardMonitor() {
  if (clipboardInterval) {
    clearInterval(clipboardInterval);
    clipboardInterval = null;
    debugLogger.log("[WhisperWoof] Clipboard monitoring stopped");
  }
}

async function initializeWhisperWoof() {
  if (initialized) return;

  debugLogger.log("[WhisperWoof] Initializing...");

  // Open the same database that OpenWhispr uses
  try {
    const dbFileName =
      process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";
    const dbPath = path.join(app.getPath("userData"), dbFileName);

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    createWhisperWoofTables(db);
    createFtsTables(db);

    // Migration: add favorite column (idempotent)
    try {
      db.exec("ALTER TABLE bf_entries ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
    } catch (err) {
      // Column already exists — ignore
      if (!err.message.includes("duplicate column")) throw err;
    }

    // Create tag tables for entry labeling
    try {
      const { createTagTables, setDatabase: setTagDb } = require("./entry-tags");
      createTagTables(db);
      setTagDb(db);
    } catch (err) {
      debugLogger.debug("[WhisperWoof] Tag tables init skipped", { error: err.message });
    }

    // Create entry chain table
    try {
      const { createChainTable, setDatabase: setChainDb } = require("./entry-chains");
      createChainTable(db);
      setChainDb(db);
    } catch (err) {
      debugLogger.debug("[WhisperWoof] Chain table init skipped", { error: err.message });
    }

    whisperwoofDb = db;

    debugLogger.log("[WhisperWoof] Database tables initialized");

    // Dedup cleanup: remove clipboard entries that duplicate voice entries
    // (voice text gets auto-pasted to clipboard, creating duplicates)
    try {
      const result = db.prepare(`
        DELETE FROM bf_entries WHERE id IN (
          SELECT c.id FROM bf_entries c
          INNER JOIN bf_entries v ON c.raw_text = v.raw_text
          WHERE c.source = 'clipboard'
            AND v.source = 'voice'
            AND abs(julianday(c.created_at) - julianday(v.created_at)) * 86400 < 10
        )
      `).run();
      if (result.changes > 0) {
        debugLogger.log(`[WhisperWoof] Dedup cleanup: removed ${result.changes} duplicate clipboard entries`);
      }
    } catch (err) {
      debugLogger.debug("[WhisperWoof] Dedup cleanup skipped", { error: err.message });
    }
  } catch (error) {
    debugLogger.log(`[WhisperWoof] Database initialization failed: ${error.message}`);
    throw error;
  }

  // TODO: Start OllamaService (detect, auto-start)
  // TODO: Register WhisperWoof hotkey routes

  startClipboardMonitor();
  // Apply the clipboard retention the user chose (images over the space cap, old items).
  try {
    require("./clipboard-store").prune();
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Clipboard retention skipped", { error: err.message });
  }

  // Start Telegram companion sync (polls inbox file for mobile-captured entries)
  try {
    const { startTelegramSync } = require("./telegram-sync");
    startTelegramSync(saveWhisperWoofEntry);
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Telegram sync init skipped", { error: err.message });
  }

  // Initialize analytics with database reference
  try {
    const { setDatabase } = require("./analytics");
    setDatabase(whisperwoofDb);
  } catch (err) {
    debugLogger.debug("[WhisperWoof] Analytics init skipped", { error: err.message });
  }

  initialized = true;
  debugLogger.log("[WhisperWoof] Initialized (Phase 1a — StorageProvider ready, clipboard monitoring active)");
}

async function shutdownWhisperWoof() {
  if (!initialized) return;

  debugLogger.log("[WhisperWoof] Shutting down...");

  stopClipboardMonitor();

  // Stop Telegram sync
  try {
    const { stopTelegramSync } = require("./telegram-sync");
    stopTelegramSync();
  } catch {
    // Ignore — may not have started
  }

  // Close the WhisperWoof database connection
  if (whisperwoofDb) {
    try {
      whisperwoofDb.close();
      debugLogger.log("[WhisperWoof] Database connection closed");
    } catch (error) {
      debugLogger.log(`[WhisperWoof] Database close failed: ${error.message}`);
    }
    whisperwoofDb = null;
  }

  initialized = false;
  debugLogger.log("[WhisperWoof] Shutdown complete");
}

function saveWhisperWoofEntry({ source, rawText, polished, routedTo, hotkeyUsed, durationMs, projectId, audioPath, metadata }) {
  if (!whisperwoofDb) return null;

  // Dedup: mark voice text so clipboard monitor skips it
  if (source === "voice") {
    if (polished) markAsVoiceTranscription(polished);
    if (rawText) markAsVoiceTranscription(rawText);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    const insertEntry = whisperwoofDb.prepare(`
      INSERT INTO bf_entries (id, created_at, source, raw_text, polished, routed_to, hotkey_used, duration_ms, project_id, audio_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertEntry.run(id, createdAt, source, rawText, polished, routedTo, hotkeyUsed, durationMs, projectId, audioPath, JSON.stringify(metadata ?? {}));

    const insertAudit = whisperwoofDb.prepare(`
      INSERT INTO bf_audit_log (action, entity_id, detail)
      VALUES (?, ?, ?)
    `);
    insertAudit.run("entry_created", id, `source=${source}`);

    debugLogger.log(`[WhisperWoof] Entry saved: ${id} (source=${source})`);
    return { id, createdAt };
  } catch (error) {
    debugLogger.log(`[WhisperWoof] Failed to save entry: ${error.message}`);
    return null;
  }
}

// Map SQLite snake_case columns to camelCase for the renderer
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    rawText: row.raw_text,
    polished: row.polished,
    routedTo: row.routed_to,
    hotkeyUsed: row.hotkey_used,
    durationMs: row.duration_ms,
    projectId: row.project_id,
    audioPath: row.audio_path,
    metadata: row.metadata,
    favorite: row.favorite || 0,
  };
}

function getWhisperWoofEntries(limit = 50, offset = 0) {
  if (!whisperwoofDb) return [];
  const rows = whisperwoofDb.prepare(
    'SELECT * FROM bf_entries ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  return rows.map(mapRow);
}

function getWhisperWoofEntriesBySource(source, limit = 50, offset = 0) {
  if (!whisperwoofDb) return [];
  const rows = whisperwoofDb.prepare(
    'SELECT * FROM bf_entries WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(source, limit, offset);
  return rows.map(mapRow);
}

function searchWhisperWoofEntries(query, limit = 50) {
  if (!whisperwoofDb) return [];
  const rows = whisperwoofDb.prepare(
    `SELECT e.* FROM bf_entries e
     INNER JOIN bf_entries_fts fts ON e.rowid = fts.rowid
     WHERE bf_entries_fts MATCH ?
     ORDER BY e.created_at DESC LIMIT ?`
  ).all(query, limit);
  return rows.map(mapRow);
}

function deleteWhisperWoofEntry(id) {
  if (!whisperwoofDb) return;
  const row = whisperwoofDb.prepare("SELECT source, audio_path, metadata FROM bf_entries WHERE id = ?").get(id);
  whisperwoofDb.prepare('DELETE FROM bf_entries WHERE id = ?').run(id);
  // A clipboard image's files go with it (they used to stay on disk forever).
  const meta = row ? clipboardPure.parseMetadata(row.metadata) : {};
  if (row?.source === "clipboard" && meta.type === "image") {
    for (const file of [row.audio_path, meta.thumbPath]) {
      try {
        if (file) fs.rmSync(file, { force: true });
      } catch {
        // best effort
      }
    }
  }
}

function toggleWhisperWoofFavorite(id) {
  if (!whisperwoofDb) return false;
  const entry = whisperwoofDb.prepare('SELECT * FROM bf_entries WHERE id = ?').get(id);
  if (!entry) return false;
  const newValue = entry.favorite ? 0 : 1;
  whisperwoofDb.prepare('UPDATE bf_entries SET favorite = ? WHERE id = ?').run(newValue, id);
  return newValue === 1;
}

function getWhisperWoofEntryRow(id) {
  if (!whisperwoofDb) return null;
  return whisperwoofDb.prepare("SELECT * FROM bf_entries WHERE id = ?").get(id) ?? null;
}

/**
 * Legacy voice rows (saved before metadata.transcriptionId existed) can still
 * find their audio: the upstream `transcriptions` row written for the same
 * dictation lives in this same SQLite file, with the same text. Text equality
 * and timestamp proximity are decided in regenerate-entry-pure.js.
 */
function findUpstreamTranscriptionForEntry(row) {
  if (!whisperwoofDb || !row) return null;
  try {
    const { matchUpstreamTranscription } = require("./regenerate-entry-pure");
    const shown = row.polished ?? row.raw_text ?? "";
    const candidates = whisperwoofDb
      .prepare(
        "SELECT id, text, raw_text, timestamp, has_audio FROM transcriptions WHERE raw_text = ? OR text = ? ORDER BY id DESC LIMIT 20"
      )
      .all(row.raw_text ?? "", shown);
    return matchUpstreamTranscription(row, candidates);
  } catch (error) {
    debugLogger.log(`[WhisperWoof] upstream transcription lookup failed: ${error.message}`);
    return null;
  }
}

function setWhisperWoofEntryMetadata(id, metadata) {
  if (!whisperwoofDb) return null;
  whisperwoofDb
    .prepare("UPDATE bf_entries SET metadata = ? WHERE id = ?")
    .run(JSON.stringify(metadata ?? {}), id);
  return mapRow(getWhisperWoofEntryRow(id));
}

/** Regeneration / undo: the FTS update trigger keeps the search index in sync. */
function updateWhisperWoofEntryText(id, { rawText, polished, metadata }) {
  if (!whisperwoofDb) return null;
  whisperwoofDb
    .prepare("UPDATE bf_entries SET raw_text = ?, polished = ?, metadata = ? WHERE id = ?")
    .run(rawText ?? null, polished ?? null, JSON.stringify(metadata ?? {}), id);
  return mapRow(getWhisperWoofEntryRow(id));
}

function getWhisperWoofFavorites(limit = 50) {
  if (!whisperwoofDb) return [];
  return whisperwoofDb.prepare('SELECT * FROM bf_entries WHERE favorite = 1 ORDER BY created_at DESC LIMIT ?').all(limit).map(mapRow);
}

function createWhisperWoofProject(name) {
  if (!whisperwoofDb) return null;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  whisperwoofDb.prepare(
    'INSERT INTO bf_projects (id, name, created_at, integration_target, metadata) VALUES (?, ?, ?, NULL, NULL)'
  ).run(id, name, createdAt);
  // audit log
  whisperwoofDb.prepare(
    'INSERT INTO bf_audit_log (action, entity_id, detail) VALUES (?, ?, ?)'
  ).run('project_created', id, JSON.stringify({ name }));
  return { id, name, createdAt };
}

function getWhisperWoofProjects() {
  if (!whisperwoofDb) return [];
  return whisperwoofDb.prepare('SELECT * FROM bf_projects ORDER BY created_at DESC').all();
}

function renameWhisperWoofProject(id, name) {
  if (!whisperwoofDb) return null;
  whisperwoofDb.prepare('UPDATE bf_projects SET name = ? WHERE id = ?').run(name, id);
  return whisperwoofDb.prepare('SELECT * FROM bf_projects WHERE id = ?').get(id) ?? null;
}

function deleteWhisperWoofProject(id) {
  if (!whisperwoofDb) return;
  // Set entries' project_id to null (don't delete entries)
  whisperwoofDb.prepare('UPDATE bf_entries SET project_id = NULL WHERE project_id = ?').run(id);
  whisperwoofDb.prepare('DELETE FROM bf_projects WHERE id = ?').run(id);
}

function getProjectEntries(projectId, limit = 50) {
  if (!whisperwoofDb) return [];
  return whisperwoofDb.prepare(
    'SELECT * FROM bf_entries WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(projectId, limit).map(mapRow);
}

/** Put a dictation into a project (null takes it out). */
function setEntryProject(entryId, projectId) {
  if (!whisperwoofDb) return false;
  const result = whisperwoofDb
    .prepare('UPDATE bf_entries SET project_id = ? WHERE id = ?')
    .run(projectId ?? null, entryId);
  return result.changes > 0;
}

/**
 * Bind a project to an MCP plugin (integration_target).
 * Pass null to unbind.
 */
function updateProjectIntegration(projectId, pluginId) {
  if (!whisperwoofDb) return null;
  const project = whisperwoofDb.prepare('SELECT * FROM bf_projects WHERE id = ?').get(projectId);
  if (!project) return null;
  whisperwoofDb.prepare('UPDATE bf_projects SET integration_target = ? WHERE id = ?').run(pluginId, projectId);
  whisperwoofDb.prepare(
    'INSERT INTO bf_audit_log (action, entity_id, detail) VALUES (?, ?, ?)'
  ).run('project_integration_updated', projectId, JSON.stringify({ pluginId }));
  return { ...project, integration_target: pluginId };
}

/**
 * Get integration targets for all projects in a single query.
 * Returns a map of projectId → integration_target (string | null).
 */
function getProjectIntegrations() {
  if (!whisperwoofDb) return {};
  const rows = whisperwoofDb
    .prepare('SELECT id, integration_target FROM bf_projects')
    .all();
  const result = {};
  for (const row of rows) {
    result[row.id] = row.integration_target ?? null;
  }
  return result;
}


module.exports = {
  initializeWhisperWoof,
  shutdownWhisperWoof,
  saveWhisperWoofEntry,
  getWhisperWoofEntries,
  getWhisperWoofEntriesBySource,
  searchWhisperWoofEntries,
  deleteWhisperWoofEntry,
  toggleWhisperWoofFavorite,
  getWhisperWoofFavorites,
  getWhisperWoofEntryRow,
  findUpstreamTranscriptionForEntry,
  setWhisperWoofEntryMetadata,
  updateWhisperWoofEntryText,
  startClipboardMonitor,
  stopClipboardMonitor,
  adoptCurrentClipboard,
  createWhisperWoofProject,
  getWhisperWoofProjects,
  deleteWhisperWoofProject,
  renameWhisperWoofProject,
  getProjectEntries,
  setEntryProject,
  updateProjectIntegration,
  getProjectIntegrations,
  // Database access (for storage-manager + other bridge modules)
  getWhisperWoofDb: () => whisperwoofDb,
  // Smart Clipboard
};
