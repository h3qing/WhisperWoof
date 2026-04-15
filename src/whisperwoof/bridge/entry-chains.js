/**
 * Entry Chaining — Link related entries into threads
 *
 * Connects entries that are part of the same conversation or topic
 * across multiple days. Like email threads but for voice notes.
 *
 * Uses a bf_entry_chains junction table (parent → child links).
 * An entry can belong to one chain (one parent), forming a tree.
 *
 * Features:
 * - Link/unlink entries
 * - Get chain (all entries in a thread)
 * - Auto-suggest chains based on semantic similarity
 * - Chain summary (LLM summarizes the full thread)
 */

const debugLogger = require("../../helpers/debugLogger");
const pure = require("./entry-chains-pure");

let db = null;

function setDatabase(database) {
  db = database;
}

/**
 * Create the chain table (called during app init).
 */
function createChainTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bf_entry_chains (
      child_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      PRIMARY KEY (child_id),
      FOREIGN KEY (child_id) REFERENCES bf_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES bf_entries(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bf_chains_parent ON bf_entry_chains(parent_id);
  `);
}

// --- Link/Unlink ---

/**
 * Link a child entry to a parent entry (add to chain).
 */
function linkEntries(childId, parentId) {
  if (!db) return { success: false, error: "Database not initialized" };
  if (childId === parentId) return { success: false, error: "Cannot link entry to itself" };

  // Verify both entries exist
  const child = db.prepare("SELECT id FROM bf_entries WHERE id = ?").get(childId);
  if (!child) return { success: false, error: "Child entry not found" };

  const parent = db.prepare("SELECT id FROM bf_entries WHERE id = ?").get(parentId);
  if (!parent) return { success: false, error: "Parent entry not found" };

  // Check if child already has a parent
  const existing = db.prepare("SELECT parent_id FROM bf_entry_chains WHERE child_id = ?").get(childId);
  if (existing) {
    return { success: false, error: "Entry already linked to another chain. Unlink first." };
  }

  // Prevent cycles: walk up from parentId to ensure childId isn't an ancestor
  if (isAncestor(childId, parentId)) {
    return { success: false, error: "Circular chain detected" };
  }

  db.prepare("INSERT INTO bf_entry_chains (child_id, parent_id, linked_at) VALUES (?, ?, ?)")
    .run(childId, parentId, new Date().toISOString());

  debugLogger.info("[WhisperWoof] Entries linked", { childId, parentId });
  return { success: true };
}

/**
 * Unlink an entry from its chain.
 */
function unlinkEntry(childId) {
  if (!db) return { success: false, error: "Database not initialized" };

  const result = db.prepare("DELETE FROM bf_entry_chains WHERE child_id = ?").run(childId);
  return { success: true, removed: result.changes > 0 };
}

function dbLookup() {
  return {
    findParent(childId) {
      const link = db.prepare("SELECT parent_id FROM bf_entry_chains WHERE child_id = ?").get(childId);
      return link ? link.parent_id : null;
    },
    findChildren(parentId) {
      return db.prepare("SELECT child_id FROM bf_entry_chains WHERE parent_id = ?")
        .all(parentId)
        .map((r) => r.child_id);
    },
  };
}

/**
 * Check if potentialAncestor is an ancestor of entryId (cycle detection).
 */
function isAncestor(potentialAncestor, entryId) {
  if (!db) return false;
  return pure.isAncestor(potentialAncestor, entryId, dbLookup());
}

// --- Chain traversal ---

/**
 * Get the root entry of a chain (walk up to the top).
 */
function getChainRoot(entryId) {
  if (!db) return entryId;
  return pure.getChainRoot(entryId, dbLookup());
}

/**
 * Get all entries in a chain (from root, depth-first).
 */
function getChain(entryId) {
  if (!db) return [];

  const lookup = dbLookup();
  const entryIds = pure.getChainEntries(entryId, lookup);

  return entryIds.map((id) => {
    const entry = db.prepare(
      "SELECT id, created_at, source, raw_text, polished FROM bf_entries WHERE id = ?"
    ).get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      createdAt: entry.created_at,
      source: entry.source,
      text: entry.polished || entry.raw_text || "",
    };
  }).filter(Boolean);
}

/**
 * Get the parent of an entry (null if root).
 */
function getParent(entryId) {
  if (!db) return null;
  return pure.getParent(entryId, dbLookup());
}

/**
 * Get direct children of an entry.
 */
function getChildren(entryId) {
  if (!db) return [];
  return pure.getChildren(entryId, dbLookup());
}

/**
 * Get chain stats.
 */
function getChainStats() {
  if (!db) return { totalChains: 0, totalLinks: 0, avgChainLength: 0 };

  const totalLinks = db.prepare("SELECT COUNT(*) as count FROM bf_entry_chains").get().count;

  // Count unique chains (entries with no parent that have children)
  const roots = db.prepare(`
    SELECT DISTINCT parent_id FROM bf_entry_chains
    WHERE parent_id NOT IN (SELECT child_id FROM bf_entry_chains)
  `).all();

  const chainLengths = roots.map((r) => getChain(r.parent_id).length);
  const avgLength = chainLengths.length > 0
    ? Math.round(chainLengths.reduce((a, b) => a + b, 0) / chainLengths.length)
    : 0;

  return {
    totalChains: roots.length,
    totalLinks: totalLinks,
    avgChainLength: avgLength,
  };
}

module.exports = {
  setDatabase,
  createChainTable,
  linkEntries,
  unlinkEntry,
  getChain,
  getChainRoot,
  getParent,
  getChildren,
  getChainStats,
  isAncestor,
};
