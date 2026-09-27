/**
 * Deleting must erase. SQLite leaves deleted rows in free pages and old
 * page images in the WAL, and FTS5 keeps deleted words in its index until a
 * merge: without this, a clipboard password the user deleted can still be
 * read out of transcriptions.db with `strings` (encryption off, the default).
 *
 * No electron; the caller passes an open better-sqlite3 connection.
 */

/**
 * Turn erasing on for this connection (`secure_delete` is per connection)
 * and for each FTS5 table (stored in the table's config). The first time a
 * table gets it, its index is rebuilt once and the file is vacuumed, so
 * what was deleted before this existed goes too. Returns whether that
 * one-time cleanup ran.
 */
function enableSecureDelete(db, ftsTables = []) {
  db.pragma("secure_delete = ON");
  let cleaned = false;
  for (const table of ftsTables) {
    const config = db.prepare(`SELECT v FROM "${table}_config" WHERE k = 'secure-delete'`).get();
    if (config && Number(config.v) === 1) continue;
    db.exec(`INSERT INTO "${table}"("${table}", rank) VALUES('secure-delete', 1)`);
    db.exec(`INSERT INTO "${table}"("${table}") VALUES('optimize')`);
    cleaned = true;
  }
  if (cleaned) {
    try {
      db.exec("VACUUM");
    } catch {
      // Another connection is mid-read: free pages are scrubbed on the next delete.
    }
    checkpoint(db);
  }
  return cleaned;
}

/** Drop old page images from the WAL after deleting what the user asked to delete. */
function checkpoint(db) {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // Busy: SQLite checkpoints on its own later.
  }
}

module.exports = { enableSecureDelete, checkpoint };
