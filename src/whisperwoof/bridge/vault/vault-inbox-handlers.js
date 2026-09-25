/**
 * How each sealed-inbox op is applied after unlock — through the same code
 * the app uses when unlocked. Transcription inserts are recorded in
 * bf_vault_applied inside the same transaction, so a crash mid-replay can't
 * duplicate a row; the other ops are idempotent by themselves (fixed entry
 * ids with INSERT OR IGNORE, overwriting the same audio file, setting the
 * same frontmatter field).
 */

const { isProvisionalId, remapEntry } = require("./inbox-pure");

const APPLIED_TABLE = `CREATE TABLE IF NOT EXISTS bf_vault_applied (
  op_id TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/** "2026-09-25T10:00:00.000Z" → "2026-09-25 10:00:00" (SQLite's CURRENT_TIMESTAMP format). */
const sqliteTime = (iso) => new Date(iso).toISOString().replace("T", " ").slice(0, 19);

/**
 * deps: { databaseManager, audioStorageManager, appInit, projectNotes,
 *         learnCorrections(data), broadcast(channel, payload) }
 */
function createInboxHandlers(deps) {
  const { databaseManager, audioStorageManager, appInit, projectNotes } = deps;

  function realTranscriptionId(pid, idMap) {
    if (!isProvisionalId(pid)) return pid;
    if (!idMap.has(pid)) throw new Error("Its transcription hasn't been imported yet");
    return idMap.get(pid);
  }

  return {
    "transcription.save": ({ pid, text, rawText, options }, { idMap, item }) => {
      const db = databaseManager.db;
      if (!db) throw new Error("Database is closed");
      db.exec(APPLIED_TABLE);
      const done = db.prepare("SELECT result FROM bf_vault_applied WHERE op_id = ?").get(item.id);
      if (done) {
        idMap.set(pid, JSON.parse(done.result).id);
        return;
      }
      const saved = db.transaction(() => {
        const result = databaseManager.saveTranscription(text, rawText, options ?? undefined);
        const at = sqliteTime(item.createdAt);
        db.prepare("UPDATE transcriptions SET timestamp = ?, created_at = ? WHERE id = ?").run(at, at, result.id);
        db.prepare("INSERT INTO bf_vault_applied (op_id, result) VALUES (?, ?)").run(item.id, JSON.stringify({ id: result.id }));
        return result;
      })();
      idMap.set(pid, Number(saved.id));
      deps.broadcast("transcription-added", databaseManager.getTranscriptionById(saved.id));
    },

    "transcription.audio": ({ pid, audio, metadata }, { idMap }) => {
      const id = realTranscriptionId(pid, idMap);
      const transcription = databaseManager.getTranscriptionById(id);
      const result = audioStorageManager.saveAudio(id, Buffer.from(audio, "base64"), transcription?.timestamp || null);
      if (!result.success) throw new Error("Couldn't save the recording");
      databaseManager.updateTranscriptionAudio(id, {
        hasAudio: 1,
        audioDurationMs: metadata?.durationMs || null,
        provider: metadata?.provider || null,
        model: metadata?.model || null,
      });
    },

    "entry.save": ({ entry }, { idMap }) => {
      const saved = appInit.saveWhisperWoofEntry(remapEntry(entry, idMap));
      if (!saved || saved.sealed) throw new Error("Database is closed");
      deps.broadcast("whisperwoof-entry-saved", { id: saved.id, source: entry.source });
    },

    "note.linkEntry": ({ name, entryId }) => {
      projectNotes.linkNoteToEntry(name, entryId);
    },

    "note.fileInDefaultProject": ({ name }) => {
      projectNotes.setNoteProject(name, projectNotes.getDefaultProject().id);
    },

    "vocab.correction": (data) => {
      deps.learnCorrections(data);
    },
  };
}

module.exports = { createInboxHandlers, APPLIED_TABLE };
