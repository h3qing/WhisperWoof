/**
 * Storage Manager — Disk usage stats, batch operations, file cleanup
 *
 * Provides the backend for the Storage Manager UI:
 * - Disk usage breakdown (database, images, audio, notes)
 * - Batch delete with file cleanup (images, imported files)
 * - Export entries as JSON
 * - Entry listing with sort/filter for storage management
 * - Retention policy (auto-delete old entries)
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("../../helpers/debugLogger");
// Entries keep logical paths; with encryption on the bytes are in "<path>.wwenc".
const vaultFiles = require("./vault/vault-files");

let db = null;

function setDatabase(database) {
  db = database;
}

// --- Disk Usage ---

function getDirSize(dirPath) {
  let total = 0;
  let fileCount = 0;
  try {
    if (!fs.existsSync(dirPath)) return { bytes: 0, files: 0 };
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          total += stat.size;
          fileCount++;
        } else if (stat.isDirectory()) {
          const sub = getDirSize(fullPath);
          total += sub.bytes;
          fileCount += sub.files;
        }
      } catch { /* skip inaccessible files */ }
    }
  } catch { /* dir doesn't exist */ }
  return { bytes: total, files: fileCount };
}

function getStorageUsage() {
  const userData = app.getPath("userData");

  // Database file size
  let dbBytes = 0;
  try {
    const dbPath = path.join(userData, "database.sqlite");
    if (fs.existsSync(dbPath)) dbBytes = fs.statSync(dbPath).size;
  } catch { /* */ }

  // Images directory
  const imagesDir = path.join(userData, "whisperwoof-images");
  const images = getDirSize(imagesDir);

  // Audio directory (OpenWhispr audio files)
  const audioDir = path.join(userData, "audio");
  const audio = getDirSize(audioDir);

  // Notes directory
  let notesDir = "";
  try {
    const settingsStr = fs.readFileSync(path.join(userData, "whisperwoof-settings.json"), "utf-8");
    const settings = JSON.parse(settingsStr);
    notesDir = settings.notesDirectory || "";
  } catch { /* */ }
  const notes = notesDir ? getDirSize(notesDir) : { bytes: 0, files: 0 };

  // Entry counts by source
  let entryCounts = { voice: 0, clipboard: 0, meeting: 0, import: 0, total: 0 };
  if (db) {
    try {
      const rows = db.prepare("SELECT source, COUNT(*) as cnt FROM bf_entries GROUP BY source").all();
      for (const row of rows) entryCounts[row.source] = row.cnt;
      entryCounts.total = rows.reduce((sum, r) => sum + r.cnt, 0);
    } catch { /* */ }
  }

  // Image entries specifically
  let imageEntryCount = 0;
  if (db) {
    try {
      imageEntryCount = db.prepare("SELECT COUNT(*) as cnt FROM bf_entries WHERE metadata LIKE '%\"type\":\"image\"%'").get().cnt;
    } catch { /* */ }
  }

  return {
    database: { bytes: dbBytes, label: "Database" },
    images: { bytes: images.bytes, files: images.files, label: "Clipboard Images" },
    audio: { bytes: audio.bytes, files: audio.files, label: "Audio Recordings" },
    notes: { bytes: notes.bytes, files: notes.files, label: "Markdown Notes" },
    total: dbBytes + images.bytes + audio.bytes + notes.bytes,
    entryCounts,
    imageEntryCount,
  };
}

// --- Entry Listing for Storage Management ---

function getEntriesForStorageView(options = {}) {
  if (!db) return [];

  const { sortBy = "date", order = "desc", source, limit = 100, offset = 0 } = options;

  let sql = "SELECT * FROM bf_entries";
  const params = [];

  if (source) {
    sql += " WHERE source = ?";
    params.push(source);
  }

  // Sort options
  if (sortBy === "size") {
    sql += " ORDER BY LENGTH(COALESCE(polished, raw_text, '')) " + (order === "asc" ? "ASC" : "DESC");
  } else {
    sql += " ORDER BY created_at " + (order === "asc" ? "ASC" : "DESC");
  }

  sql += " LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  // Map rows and add file size info
  return rows.map((row) => {
    let fileSize = 0;
    if (row.audio_path) {
      try {
        if (fs.existsSync(row.audio_path)) fileSize = fs.statSync(row.audio_path).size;
      } catch { /* */ }
    }

    const meta = row.metadata ? JSON.parse(row.metadata) : {};

    return {
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      text: row.polished || row.raw_text || "",
      textLength: (row.polished || row.raw_text || "").length,
      isImage: meta.type === "image",
      imageWidth: meta.width || null,
      imageHeight: meta.height || null,
      thumbPath: meta.thumbPath || null,
      filePath: row.audio_path,
      fileSize,
      favorite: row.favorite || 0,
      projectId: row.project_id,
    };
  });
}

// --- Batch Delete with File Cleanup ---

function deleteEntriesWithCleanup(ids) {
  if (!db || !Array.isArray(ids) || ids.length === 0) return { deleted: 0, filesRemoved: 0 };

  let filesRemoved = 0;

  for (const id of ids) {
    try {
      // Get entry to find associated files
      const entry = db.prepare("SELECT audio_path, metadata FROM bf_entries WHERE id = ?").get(id);
      if (!entry) continue;

      // Delete associated files
      if (entry.audio_path) {
        try {
          if (vaultFiles.exists(entry.audio_path)) { vaultFiles.unlink(entry.audio_path); filesRemoved++; }
        } catch { /* */ }
      }

      // Delete thumbnail if it's an image entry
      const meta = entry.metadata ? JSON.parse(entry.metadata) : {};
      if (meta.thumbPath) {
        try {
          if (vaultFiles.exists(meta.thumbPath)) { vaultFiles.unlink(meta.thumbPath); filesRemoved++; }
        } catch { /* */ }
      }

      // Delete the database entry
      db.prepare("DELETE FROM bf_entries WHERE id = ?").run(id);
    } catch (err) {
      debugLogger.debug("[StorageManager] Delete entry failed", { id, error: err.message });
    }
  }

  debugLogger.log(`[StorageManager] Batch deleted ${ids.length} entries, removed ${filesRemoved} files`);
  return { deleted: ids.length, filesRemoved };
}

// --- Delete by Source Type ---

function deleteEntriesBySource(source) {
  if (!db) return { deleted: 0, filesRemoved: 0 };

  // Get all entries of this source to clean up files
  const entries = db.prepare("SELECT id, audio_path, metadata FROM bf_entries WHERE source = ?").all(source);
  const ids = entries.map((e) => e.id);

  return deleteEntriesWithCleanup(ids);
}

// --- Delete Entries Older Than ---

function deleteEntriesOlderThan(days) {
  if (!db || days <= 0) return { deleted: 0, filesRemoved: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  const entries = db.prepare(
    "SELECT id, audio_path, metadata FROM bf_entries WHERE created_at < ? AND favorite = 0"
  ).all(cutoffStr);

  const ids = entries.map((e) => e.id);
  return deleteEntriesWithCleanup(ids);
}

// --- Export ---

function exportEntries(ids) {
  if (!db) return [];

  let rows;
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    rows = db.prepare(`SELECT * FROM bf_entries WHERE id IN (${placeholders}) ORDER BY created_at DESC`).all(...ids);
  } else {
    rows = db.prepare("SELECT * FROM bf_entries ORDER BY created_at DESC").all();
  }

  return rows.map((row) => ({
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
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    favorite: row.favorite || 0,
  }));
}

// --- Cleanup Orphaned Files ---

function cleanupOrphanedFiles() {
  if (!db) return { removed: 0, bytes: 0 };

  const imagesDir = path.join(app.getPath("userData"), "whisperwoof-images");
  if (!fs.existsSync(imagesDir)) return { removed: 0, bytes: 0 };

  // Get all image paths referenced by entries
  const referencedPaths = new Set();
  try {
    const entries = db.prepare("SELECT audio_path, metadata FROM bf_entries WHERE audio_path IS NOT NULL").all();
    for (const entry of entries) {
      referencedPaths.add(entry.audio_path);
      const meta = entry.metadata ? JSON.parse(entry.metadata) : {};
      if (meta.thumbPath) referencedPaths.add(meta.thumbPath);
    }
  } catch { /* */ }

  // Find files not referenced by any entry
  let removed = 0;
  let bytesFreed = 0;
  try {
    const files = fs.readdirSync(imagesDir);
    for (const file of files) {
      const fullPath = path.join(imagesDir, file);
      // "x.png.wwenc" is the sealed form of "x.png", which is what entries reference.
      if (!referencedPaths.has(path.join(imagesDir, vaultFiles.logicalName(file)))) {
        try {
          const stat = fs.statSync(fullPath);
          fs.unlinkSync(fullPath);
          removed++;
          bytesFreed += stat.size;
        } catch { /* */ }
      }
    }
  } catch { /* */ }

  debugLogger.log(`[StorageManager] Cleaned up ${removed} orphaned files (${Math.round(bytesFreed / 1024)}KB freed)`);
  return { removed, bytes: bytesFreed };
}

// --- Audit Log Cleanup ---

function cleanupAuditLog(keepDays = 30) {
  if (!db) return 0;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const result = db.prepare("DELETE FROM bf_audit_log WHERE timestamp < ?").run(cutoff.toISOString());
    return result.changes;
  } catch { return 0; }
}

module.exports = {
  setDatabase,
  getStorageUsage,
  getEntriesForStorageView,
  deleteEntriesWithCleanup,
  deleteEntriesBySource,
  deleteEntriesOlderThan,
  exportEntries,
  cleanupOrphanedFiles,
  cleanupAuditLog,
};
