/**
 * Turning encryption on or off — what to do next, decided only from what is
 * on disk, so a crash or quit at any point resumes safely. Pure: callers
 * gather the facts, these functions decide.
 *
 * Database: copy → convert the copy (".vault-work") → verify → rename the
 * original to ".vault-old" → rename the copy into place → delete the old one.
 * Files: write "x.wwenc.tmp" → fsync → rename → verify → delete the source.
 * A source is deleted only after its converted copy is on disk and checked.
 */

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
// "rotate" (new recovery phrase) has its own steps in vault-rotate.js; it only shares the journal.
const DIRECTIONS = Object.freeze(["enable", "disable"]);
const JOURNAL_DIRECTIONS = Object.freeze([...DIRECTIONS, "rotate"]);
const PHASES = Object.freeze(["db", "files", "cleanup", "done"]);
// Turning encryption off decrypts files first: if one can't be opened, the
// database is still encrypted and still matches the vault, so nothing breaks.
const PHASE_ORDER = Object.freeze({
  enable: Object.freeze(["db", "files", "cleanup", "done"]),
  disable: Object.freeze(["files", "db", "cleanup", "done"]),
  rotate: Object.freeze(["db", "files", "cleanup", "done"]),
});

function assertDirection(direction) {
  if (!DIRECTIONS.includes(direction)) throw new Error(`Unknown direction: ${direction}`);
}

/** "missing" | "plain" | "encrypted" from the first 16 bytes of a database file. */
function sqliteState(head) {
  if (!Buffer.isBuffer(head)) return "missing";
  if (head.length === 0) return "plain";
  return head.length >= SQLITE_MAGIC.length && head.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
    ? "plain"
    : "encrypted";
}

/**
 * facts: { main: "missing"|"plain"|"encrypted", work: boolean, old: boolean }
 * → "convert" | "finish-swap" | "restore-old" | "cleanup" | "done"
 */
function planDatabaseStep(direction, { main, work, old }) {
  assertDirection(direction);
  const source = direction === "enable" ? "plain" : "encrypted";
  const target = direction === "enable" ? "encrypted" : "plain";
  if (main === source) return "convert";
  if (main === "missing" && old) return work ? "finish-swap" : "restore-old";
  if (main === target && old) return "cleanup";
  return "done";
}

/**
 * facts: { plain: boolean, sealed: boolean } for one file (tmp files are
 * always discarded first by the runner).
 * → "convert" | "verify-and-remove-source" | "done"
 */
function planFileStep(direction, { plain, sealed }) {
  assertDirection(direction);
  const [source, target] = direction === "enable" ? [plain, sealed] : [sealed, plain];
  if (source && target) return "verify-and-remove-source";
  if (source) return "convert";
  return "done";
}

function startJournal(direction, now = new Date()) {
  if (!JOURNAL_DIRECTIONS.includes(direction)) throw new Error(`Unknown direction: ${direction}`);
  return { v: 1, direction, startedAt: now.toISOString(), phase: PHASE_ORDER[direction][0] };
}

function advanceJournal(journal) {
  const order = PHASE_ORDER[journal.direction];
  const next = order[Math.min(order.indexOf(journal.phase) + 1, order.length - 1)];
  return { ...journal, phase: next };
}

function parseJournal(json) {
  const ok =
    json &&
    json.v === 1 &&
    JOURNAL_DIRECTIONS.includes(json.direction) &&
    PHASES.includes(json.phase) &&
    typeof json.startedAt === "string";
  if (!ok) throw new Error("Migration journal is damaged");
  return { v: 1, direction: json.direction, startedAt: json.startedAt, phase: json.phase };
}

module.exports = {
  PHASES,
  sqliteState,
  planDatabaseStep,
  planFileStep,
  startJournal,
  advanceJournal,
  parseJournal,
};
