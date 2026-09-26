/**
 * How each sealed-inbox op is applied after unlock — through the same code
 * the app uses when unlocked. Transcription inserts are recorded in
 * bf_vault_applied (with their provisional id) inside the same transaction,
 * so a crash mid-replay can neither duplicate a row nor lose the link from
 * the provisional id to the real one. The other ops are idempotent by
 * themselves (fixed entry ids with INSERT OR IGNORE, overwriting the same
 * audio file, setting the same frontmatter field).
 */

const { isProvisionalId, remapEntry } = require("./inbox-pure");

const APPLIED_TABLE = `CREATE TABLE IF NOT EXISTS bf_vault_applied (
  op_id TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/** "2026-09-25T10:00:00.000Z" → "2026-09-25 10:00:00" (SQLite's CURRENT_TIMESTAMP format). */
const sqliteTime = (iso) => new Date(iso).toISOString().replace("T", " ").slice(0, 19);

class WaitingError extends Error {}

/** Ops about a note that has since been deleted (or an entry that never made it) have nothing left to do. */
const isGoneError = (err) => /Unknown entry|Invalid note name|ENOENT|no such file/i.test(err.message);

/**
 * deps: { databaseManager, audioStorageManager, appInit, projectNotes,
 *         learnCorrections(data), broadcast(channel, payload) }
 * → { handlers, loadIdMap }
 */
function createInboxHandlers(deps) {
  const { databaseManager, audioStorageManager, appInit, projectNotes } = deps;

  /** provisional id → real transcription id, for everything imported so far. */
  function loadIdMap() {
    const db = databaseManager.db;
    if (!db) return new Map();
    db.exec(APPLIED_TABLE);
    const rows = db.prepare("SELECT result FROM bf_vault_applied").all();
    return new Map(
      rows
        .map((row) => JSON.parse(row.result))
        .filter((r) => isProvisionalId(r.pid) && Number.isInteger(r.id))
        .map((r) => [r.pid, r.id])
    );
  }

  function realTranscriptionId(pid, { idMap, failedPids }) {
    if (!isProvisionalId(pid)) return pid;
    if (idMap.has(pid)) return idMap.get(pid);
    if (failedPids.has(pid)) throw new WaitingError("Its transcription hasn't been imported yet");
    return null; // there never was a transcription (history saving was off)
  }

  const handlers = {
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
        db.prepare("INSERT INTO bf_vault_applied (op_id, result) VALUES (?, ?)").run(
          item.id,
          JSON.stringify({ id: Number(result.id), pid })
        );
        return result;
      })();
      idMap.set(pid, Number(saved.id));
      deps.broadcast("transcription-added", databaseManager.getTranscriptionById(saved.id));
    },

    "transcription.audio": ({ pid, audio, metadata }, ctx) => {
      const id = realTranscriptionId(pid, ctx);
      if (id === null) return;
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

    "entry.save": ({ entry }, ctx) => {
      const tid = entry?.metadata?.transcriptionId;
      if (isProvisionalId(tid) && ctx.failedPids.has(tid)) {
        throw new WaitingError("Its transcription hasn't been imported yet");
      }
      const saved = appInit.saveWhisperWoofEntry(remapEntry(entry, ctx.idMap));
      if (!saved || saved.sealed) throw new Error("Database is closed");
      deps.broadcast("whisperwoof-entry-saved", { id: saved.id, source: entry.source });
    },

    "note.linkEntry": ({ name, entryId }) => {
      try {
        projectNotes.linkNoteToEntry(name, entryId);
      } catch (err) {
        if (!isGoneError(err)) throw err;
      }
    },

    "note.fileInDefaultProject": ({ name }) => {
      try {
        projectNotes.setNoteProject(name, projectNotes.getDefaultProject().id);
      } catch (err) {
        if (!isGoneError(err)) throw err;
      }
    },

    "vocab.correction": (data) => {
      deps.learnCorrections(data);
    },
  };

  return { handlers, loadIdMap };
}

module.exports = { createInboxHandlers, APPLIED_TABLE };
