/**
 * bf_image_text — the words read from clipboard images: one row per image
 * read ("done", with empty text when it had none, or "failed"). It lives in
 * the history database, so it's encrypted exactly when the history is, and
 * a trigger removes a row with its entry however the entry is deleted.
 *
 * Plain SQL on a better-sqlite3-style handle (prepare → get/all/run), shared
 * by the reader (clipboard-image-text.js) and the Clipboard store.
 *
 * Secret-shaped words (keys, tokens, card numbers, recovery phrases,
 * password-like words) are stored as "•••••", so a screenshot of one doesn't
 * make it searchable. `redacted` marks rows stored that way; rows read
 * before it existed are redacted once, at the next start.
 */

const { redactSecrets } = require("./clipboard-pure");

const IMAGE_ENTRY = `e.source = 'clipboard' AND e.metadata LIKE '%"type":"image"%'`;

function createImageTextTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bf_image_text (
      entry_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('done','failed')),
      text TEXT NOT NULL DEFAULT '',
      read_at TEXT NOT NULL,
      redacted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TRIGGER IF NOT EXISTS bf_image_text_entry_deleted
    AFTER DELETE ON bf_entries BEGIN
      DELETE FROM bf_image_text WHERE entry_id = OLD.id;
    END;
  `);
  // Tables made before words were redacted (v2.4.0).
  const columns = db.prepare("PRAGMA table_info(bf_image_text)").all();
  if (!columns.some((column) => column.name === "redacted")) {
    db.exec("ALTER TABLE bf_image_text ADD COLUMN redacted INTEGER NOT NULL DEFAULT 0");
  }
}

/** Redact the rows stored before redaction existed. → rows whose text changed */
function redactStoredImageText(db) {
  const rows = db.prepare("SELECT entry_id, text FROM bf_image_text WHERE redacted = 0 AND text <> ''").all();
  const update = db.prepare("UPDATE bf_image_text SET text = ? WHERE entry_id = ?");
  let changed = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const { text, redacted } = redactSecrets(row.text);
      if (redacted === 0) continue;
      update.run(text, row.entry_id);
      changed += 1;
    }
    db.prepare("UPDATE bf_image_text SET redacted = 1 WHERE redacted = 0").run();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return changed;
}

/** Clipboard images not read yet, newest first: [{ id, audio_path }]. */
function unreadImages(db, limit) {
  return db
    .prepare(
      `SELECT e.id, e.audio_path FROM bf_entries e
       LEFT JOIN bf_image_text t ON t.entry_id = e.id
       WHERE ${IMAGE_ENTRY} AND t.entry_id IS NULL
       ORDER BY e.created_at DESC LIMIT ?`
    )
    .all(limit);
}

/** The image entry `id` if it's a clipboard image not read yet, else undefined. */
function unreadImage(db, id) {
  return db
    .prepare(
      `SELECT e.id, e.audio_path FROM bf_entries e
       LEFT JOIN bf_image_text t ON t.entry_id = e.id
       WHERE e.id = ? AND ${IMAGE_ENTRY} AND t.entry_id IS NULL`
    )
    .get(id);
}

/** Store what reading found (secrets redacted). Skipped when the entry was deleted meanwhile. → true if stored */
function recordImageText(db, id, { text = "", failed = false } = {}) {
  const result = db
    .prepare(
      `INSERT OR REPLACE INTO bf_image_text (entry_id, status, text, read_at, redacted)
       SELECT ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM bf_entries WHERE id = ? AND source = 'clipboard')`
    )
    .run(id, failed ? "failed" : "done", failed ? "" : redactSecrets(String(text)).text, new Date().toISOString(), id);
  return result.changes > 0;
}

/** { total, read, withText } over the clipboard images. */
function countImageText(db) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COUNT(t.entry_id) AS done_count,
              COALESCE(SUM(CASE WHEN t.text <> '' THEN 1 ELSE 0 END), 0) AS with_text
       FROM bf_entries e LEFT JOIN bf_image_text t ON t.entry_id = e.id
       WHERE ${IMAGE_ENTRY}`
    )
    .get();
  return { total: Number(row.total), read: Number(row.done_count), withText: Number(row.with_text) };
}

/** What was read from one image: { status: "unread" | "done" | "failed", text }. */
function imageTextFor(db, id) {
  const row = db.prepare("SELECT status, text FROM bf_image_text WHERE entry_id = ?").get(id);
  return row ? { status: row.status, text: row.text ?? "" } : { status: "unread", text: "" };
}

/** Texts of several images at once (a page of search results): Map id → text. */
function textsFor(db, ids) {
  const out = new Map();
  if (!Array.isArray(ids) || ids.length === 0) return out;
  const rows = db
    .prepare(`SELECT entry_id, text FROM bf_image_text WHERE entry_id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);
  for (const row of rows) out.set(row.entry_id, row.text ?? "");
  return out;
}

/** Forget every word read (turning the feature off). → rows removed */
function deleteAllImageText(db) {
  return db.prepare("DELETE FROM bf_image_text").run().changes;
}

/** Search condition on bf_entries: the image's words contain the `?` LIKE pattern. */
const TEXT_MATCH_SQL = "id IN (SELECT entry_id FROM bf_image_text WHERE text LIKE ? ESCAPE '\\')";

module.exports = {
  createImageTextTable,
  redactStoredImageText,
  unreadImages,
  unreadImage,
  recordImageText,
  countImageText,
  imageTextFor,
  textsFor,
  deleteAllImageText,
  TEXT_MATCH_SQL,
};
