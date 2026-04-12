/**
 * Entry Tagging — User-defined labels for bf_entries
 *
 * Many-to-many relationship: entries can have multiple tags,
 * tags can be on multiple entries. Stored in SQLite via
 * bf_tags and bf_entry_tags junction tables.
 *
 * Features:
 * - CRUD for tags (name + color)
 * - Add/remove tags from entries
 * - Bulk tag operations (tag multiple entries at once)
 * - Filter entries by tag
 * - Tag suggestions based on entry content
 * - Tag usage stats
 */

const debugLogger = require("../../helpers/debugLogger");
const {
  DEFAULT_TAG_COLOR,
  validateTagName,
} = require("./entry-tags-pure");

let db = null;

/**
 * Set the database reference (called from app-init).
 */
function setDatabase(database) {
  db = database;
}

/**
 * Create the tag tables (called during app init).
 */
function createTagTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bf_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color TEXT DEFAULT '#A06A3C',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bf_entry_tags (
      entry_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      tagged_at TEXT NOT NULL,
      PRIMARY KEY (entry_id, tag_id),
      FOREIGN KEY (entry_id) REFERENCES bf_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES bf_tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bf_entry_tags_entry ON bf_entry_tags(entry_id);
    CREATE INDEX IF NOT EXISTS idx_bf_entry_tags_tag ON bf_entry_tags(tag_id);
  `);
}

// --- Tag CRUD ---

function getAllTags() {
  if (!db) return [];
  const rows = db.prepare(`
    SELECT t.*, COUNT(et.entry_id) as entry_count
    FROM bf_tags t
    LEFT JOIN bf_entry_tags et ON t.id = et.tag_id
    GROUP BY t.id
    ORDER BY t.name ASC
  `).all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    createdAt: r.created_at,
    entryCount: r.entry_count,
  }));
}

function createTag(name, color) {
  if (!db) return { success: false, error: "Database not initialized" };

  const validationError = validateTagName(name);
  if (validationError) return { success: false, error: validationError };

  const trimmed = name.trim();

  // Check uniqueness
  const existing = db.prepare("SELECT id FROM bf_tags WHERE name = ? COLLATE NOCASE").get(trimmed);
  if (existing) return { success: false, error: `Tag "${trimmed}" already exists` };

  const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const tagColor = color || DEFAULT_TAG_COLOR;

  db.prepare("INSERT INTO bf_tags (id, name, color, created_at) VALUES (?, ?, ?, ?)").run(id, trimmed, tagColor, createdAt);

  debugLogger.info("[WhisperWoof] Tag created", { id, name: trimmed });
  return { success: true, tag: { id, name: trimmed, color: tagColor, createdAt, entryCount: 0 } };
}

function updateTag(id, updates) {
  if (!db) return { success: false, error: "Database not initialized" };

  const tag = db.prepare("SELECT * FROM bf_tags WHERE id = ?").get(id);
  if (!tag) return { success: false, error: "Tag not found" };

  if (updates.name !== undefined) {
    const validationError = validateTagName(updates.name);
    if (validationError) return { success: false, error: validationError };

    const trimmed = updates.name.trim();

    // Check uniqueness (excluding self)
    const existing = db.prepare("SELECT id FROM bf_tags WHERE name = ? COLLATE NOCASE AND id != ?").get(trimmed, id);
    if (existing) return { success: false, error: `Tag "${trimmed}" already exists` };

    db.prepare("UPDATE bf_tags SET name = ? WHERE id = ?").run(trimmed, id);
  }

  if (updates.color !== undefined) {
    db.prepare("UPDATE bf_tags SET color = ? WHERE id = ?").run(updates.color, id);
  }

  return { success: true };
}

function deleteTag(id) {
  if (!db) return { success: false, error: "Database not initialized" };

  // Junction table entries cascade-delete via FK
  db.prepare("DELETE FROM bf_entry_tags WHERE tag_id = ?").run(id);
  const result = db.prepare("DELETE FROM bf_tags WHERE id = ?").run(id);

  if (result.changes === 0) return { success: false, error: "Tag not found" };
  return { success: true };
}

// --- Entry-Tag operations ---

function addTagToEntry(entryId, tagId) {
  if (!db) return { success: false, error: "Database not initialized" };

  // Verify both exist
  const entry = db.prepare("SELECT id FROM bf_entries WHERE id = ?").get(entryId);
  if (!entry) return { success: false, error: "Entry not found" };

  const tag = db.prepare("SELECT id FROM bf_tags WHERE id = ?").get(tagId);
  if (!tag) return { success: false, error: "Tag not found" };

  // Check if already tagged
  const existing = db.prepare("SELECT 1 FROM bf_entry_tags WHERE entry_id = ? AND tag_id = ?").get(entryId, tagId);
  if (existing) return { success: true }; // Idempotent

  db.prepare("INSERT INTO bf_entry_tags (entry_id, tag_id, tagged_at) VALUES (?, ?, ?)").run(
    entryId, tagId, new Date().toISOString()
  );

  return { success: true };
}

function removeTagFromEntry(entryId, tagId) {
  if (!db) return { success: false, error: "Database not initialized" };

  db.prepare("DELETE FROM bf_entry_tags WHERE entry_id = ? AND tag_id = ?").run(entryId, tagId);
  return { success: true };
}

function getEntryTags(entryId) {
  if (!db) return [];

  return db.prepare(`
    SELECT t.id, t.name, t.color
    FROM bf_tags t
    INNER JOIN bf_entry_tags et ON t.id = et.tag_id
    WHERE et.entry_id = ?
    ORDER BY t.name ASC
  `).all(entryId);
}

function getEntriesByTag(tagId, limit = 50) {
  if (!db) return [];

  const rows = db.prepare(`
    SELECT e.*
    FROM bf_entries e
    INNER JOIN bf_entry_tags et ON e.id = et.entry_id
    WHERE et.tag_id = ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(tagId, limit);

  // Map snake_case to camelCase
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    source: r.source,
    rawText: r.raw_text,
    polished: r.polished,
    routedTo: r.routed_to,
    projectId: r.project_id,
    metadata: r.metadata,
  }));
}

// --- Bulk operations ---

function bulkTagEntries(entryIds, tagId) {
  if (!db) return { success: false, error: "Database not initialized" };
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return { success: false, error: "Entry IDs required" };
  }

  const tag = db.prepare("SELECT id FROM bf_tags WHERE id = ?").get(tagId);
  if (!tag) return { success: false, error: "Tag not found" };

  const insert = db.prepare(
    "INSERT OR IGNORE INTO bf_entry_tags (entry_id, tag_id, tagged_at) VALUES (?, ?, ?)"
  );
  const now = new Date().toISOString();

  const transaction = db.transaction((ids) => {
    let count = 0;
    for (const entryId of ids) {
      const result = insert.run(entryId, tagId, now);
      if (result.changes > 0) count++;
    }
    return count;
  });

  const tagged = transaction(entryIds);
  debugLogger.info("[WhisperWoof] Bulk tag applied", { tagId, requested: entryIds.length, tagged });

  return { success: true, tagged };
}

function bulkRemoveTag(entryIds, tagId) {
  if (!db) return { success: false, error: "Database not initialized" };

  const del = db.prepare("DELETE FROM bf_entry_tags WHERE entry_id = ? AND tag_id = ?");
  const transaction = db.transaction((ids) => {
    let count = 0;
    for (const entryId of ids) {
      const result = del.run(entryId, tagId);
      if (result.changes > 0) count++;
    }
    return count;
  });

  const removed = transaction(entryIds);
  return { success: true, removed };
}

// --- Stats ---

function getTagStats() {
  if (!db) return { totalTags: 0, totalTaggings: 0, topTags: [], untaggedCount: 0 };

  const totalTags = db.prepare("SELECT COUNT(*) as count FROM bf_tags").get().count;
  const totalTaggings = db.prepare("SELECT COUNT(*) as count FROM bf_entry_tags").get().count;
  const totalEntries = db.prepare("SELECT COUNT(*) as count FROM bf_entries").get().count;
  const taggedEntries = db.prepare("SELECT COUNT(DISTINCT entry_id) as count FROM bf_entry_tags").get().count;

  const topTags = db.prepare(`
    SELECT t.name, t.color, COUNT(et.entry_id) as count
    FROM bf_tags t
    INNER JOIN bf_entry_tags et ON t.id = et.tag_id
    GROUP BY t.id
    ORDER BY count DESC
    LIMIT 10
  `).all();

  return {
    totalTags,
    totalTaggings,
    taggedEntries,
    untaggedCount: totalEntries - taggedEntries,
    topTags: topTags.map((t) => ({ name: t.name, color: t.color, count: t.count })),
  };
}

module.exports = {
  setDatabase,
  createTagTables,
  getAllTags,
  createTag,
  updateTag,
  deleteTag,
  addTagToEntry,
  removeTagFromEntry,
  getEntryTags,
  getEntriesByTag,
  bulkTagEntries,
  bulkRemoveTag,
  getTagStats,
};
