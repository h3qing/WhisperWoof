/**
 * Turning encryption on / off (and converting notes alone), crash-safe.
 * What to do next is always decided from what's on disk
 * (migration-plan-pure), so the runner can be re-run from any point; the
 * journal (vault-journal, signed with the master key) only remembers the
 * direction and phase.
 *
 * The caller closes the app's database connections before calling and
 * reopens them after; the runner never holds the app database open.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ww = require("./wwenc-pure");
const plan = require("./migration-plan-pure");
const vault = require("./vault-service");
const journalStore = require("./vault-journal");
const { applyKey } = require("./vault-db");
const {
  SEALED_EXT,
  SEALED_JSON_STORES: JSON_STORES,
  SEALED_DIR_STORES: DIR_STORES,
  sealedPath,
  listNames,
} = require("./vault-files");
const {
  vaultPaths,
  writeFileAtomic,
  writeTempAsync,
  commitIfUnchanged,
  removeIfUnchanged,
  syncDirAsync,
  inGroups,
  CONVERT_BATCH,
  CONVERT_PARALLEL,
  keepTimes,
  removeIfExists,
  removeStaleTemps,
} = require("./vault-paths");

const WORK_EXT = ".vault-work";
const OLD_EXT = ".vault-old";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

// ---------- database ----------

function readHead(file) {
  if (!fs.existsSync(file)) return null;
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    const n = fs.readSync(fd, head, 0, 16, 0);
    return head.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function dbFacts(file) {
  return {
    main: plan.sqliteState(readHead(file)),
    work: fs.existsSync(file + WORK_EXT),
    old: fs.existsSync(file + OLD_EXT),
  };
}

function openAs(Database, file, encrypted, keyHex) {
  const db = new Database(file);
  try {
    if (encrypted) applyKey(db, keyHex);
    else db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

function tableCounts(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name)
    .sort();
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT count(*) AS n FROM "${t.replace(/"/g, '""')}"`).get().n]));
}

/** Fold the WAL into the main file and switch to a rollback journal (rekey needs it). */
function settle(Database, file, encrypted, keyHex) {
  const db = openAs(Database, file, encrypted, keyHex);
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
    return tableCounts(db);
  } finally {
    db.close();
  }
}

function convertDatabase(Database, file, direction, keyHex) {
  const toEncrypted = direction === "enable";
  const work = file + WORK_EXT;
  removeIfExists(work);
  const expected = settle(Database, file, !toEncrypted, keyHex);
  fs.copyFileSync(file, work);

  const db = openAs(Database, work, !toEncrypted, keyHex);
  try {
    if (toEncrypted) {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma(`hexrekey = '${keyHex}'`);
    } else {
      db.pragma("rekey = ''");
    }
  } finally {
    db.close();
  }

  const check = openAs(Database, work, toEncrypted, keyHex);
  try {
    const ok = check.pragma("integrity_check", { simple: true }) === "ok";
    if (!ok || JSON.stringify(tableCounts(check)) !== JSON.stringify(expected)) {
      throw new Error("The converted database didn't match the original");
    }
  } finally {
    check.close();
  }
  const fd = fs.openSync(work, "r+");
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  removeIfExists(`${file}-wal`);
  removeIfExists(`${file}-shm`);
  fs.renameSync(file, file + OLD_EXT);
  fs.renameSync(work, file);
}

function migrateDatabase(Database, file, direction, keyHex) {
  for (let guard = 0; guard < 6; guard += 1) {
    const step = plan.planDatabaseStep(direction, dbFacts(file));
    if (step === "done") {
      removeIfExists(file + WORK_EXT);
      return;
    }
    if (step === "convert") convertDatabase(Database, file, direction, keyHex);
    if (step === "finish-swap") fs.renameSync(file + WORK_EXT, file);
    if (step === "restore-old") fs.renameSync(file + OLD_EXT, file);
    if (step === "cleanup") {
      for (const suffix of ["", "-wal", "-shm"]) removeIfExists(file + OLD_EXT + suffix);
    }
  }
  throw new Error("Database migration didn't settle");
}

// ---------- files ----------

function sealBytes(bytes, kind) {
  return ww.encrypt(bytes, vault.sealPublicRaw(), { kind });
}

function openBytes(sealed) {
  return vault.openSealed(sealed).plaintext;
}

function migrateFile(direction, { file, kind, mode }) {
  const sealed = sealedPath(file);
  const step = plan.planFileStep(direction, { plain: fs.existsSync(file), sealed: fs.existsSync(sealed) });
  if (step === "done") return false;
  if (direction === "enable") {
    const original = fs.statSync(file);
    const plain = fs.readFileSync(file);
    if (step === "convert") writeFileAtomic(sealed, sealBytes(plain, kind));
    if (!sha256(openBytes(fs.readFileSync(sealed))).equals(sha256(plain))) {
      writeFileAtomic(sealed, sealBytes(plain, kind));
      if (!sha256(openBytes(fs.readFileSync(sealed))).equals(sha256(plain))) throw new Error(`Couldn't verify ${file}`);
    }
    keepTimes(sealed, original);
    removeIfExists(file);
  } else {
    const original = fs.statSync(sealed);
    const plain = openBytes(fs.readFileSync(sealed));
    if (step === "convert" || !sha256(fs.readFileSync(file)).equals(sha256(plain))) writeFileAtomic(file, plain, mode);
    keepTimes(file, original);
    removeIfExists(sealed);
  }
  return true;
}

/** Deleted while we worked (clipboard retention, the user): nothing left to convert. */
const isMissing = (err) => err && err.code === "ENOENT";

/**
 * First half of converting one file in a batch: write the converted copy
 * (fsynced; its folder isn't synced yet). null when there's nothing to do, or
 * when the file changed or went away meanwhile (the last pass redoes it).
 */
async function stageFile(direction, target) {
  const { file, kind, mode } = target;
  const sealed = sealedPath(file);
  const step = plan.planFileStep(direction, { plain: fs.existsSync(file), sealed: fs.existsSync(sealed) });
  if (step === "done") return null;
  const [source, written] = direction === "enable" ? [file, sealed] : [sealed, file];
  try {
    const original = await fs.promises.stat(source);
    const bytes = await fs.promises.readFile(source);
    const plain = direction === "enable" ? bytes : openBytes(bytes);
    const alreadyThere =
      direction === "enable" ? step !== "convert" : step !== "convert" && sha256(await fs.promises.readFile(file)).equals(sha256(plain));
    if (!alreadyThere) {
      const converted = direction === "enable" ? sealBytes(plain, kind) : plain;
      const tmp = await writeTempAsync(written, converted, direction === "enable" ? 0o600 : mode, original);
      if (!commitIfUnchanged(tmp, written, source, original)) return null;
    }
    return { target, source, written, original, hash: sha256(plain) };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** Second half, after the batch's folders are synced: check the copy, then remove the original. */
async function finishFile(direction, staged) {
  try {
    if (direction === "enable" && !sha256(openBytes(await fs.promises.readFile(staged.written))).equals(staged.hash)) {
      // A copy left by an interrupted run that doesn't match: redo this one the careful way.
      migrateFile(direction, staged.target);
      return;
    }
    await fs.promises.utimes(staged.written, staged.original.atime, staged.original.mtime);
    // Only if the original is still what was converted; otherwise the last pass redoes it.
    removeIfUnchanged(staged.source, staged.original);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

async function namingErrors(target, fn) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`Couldn't convert ${path.basename(target.file)}: ${err.message}`);
  }
}

/** Convert `targets` in batches; the event loop gets a turn at every await. */
async function convertInBatches(direction, targets, onDone) {
  for (let start = 0; start < targets.length; start += CONVERT_BATCH) {
    const batch = targets.slice(start, start + CONVERT_BATCH);
    const staged = (
      await inGroups(batch, CONVERT_PARALLEL, (target) => namingErrors(target, () => stageFile(direction, target)))
    ).filter(Boolean);
    await Promise.all([...new Set(staged.map((s) => path.dirname(s.written)))].map(syncDirAsync));
    await inGroups(staged, CONVERT_PARALLEL, (s) => namingErrors(s.target, () => finishFile(direction, s)));
    onDone(Math.min(start + CONVERT_BATCH, targets.length));
  }
}

function convertNow(direction, target) {
  try {
    migrateFile(direction, target);
  } catch (err) {
    throw new Error(`Couldn't convert ${path.basename(target.file)}: ${err.message}`);
  }
}

// ---------- what gets encrypted ----------
// JSON_STORES and DIR_STORES live in vault-files, which refuses their plain
// form while encryption is on.

function isNoteName(name) {
  return name.endsWith(".md") && !name.startsWith(".") && !name.includes("/");
}

/** Logical names of the regular files (not folders) in `dir`, sealed or plain. */
function filesIn(dir) {
  return listNames(dir).filter((name) => {
    if (name.startsWith(".")) return false;
    const plain = path.join(dir, name);
    for (const candidate of [plain, sealedPath(plain)]) {
      try {
        if (fs.statSync(candidate).isFile()) return true;
      } catch {
        // not this form
      }
    }
    return false;
  });
}

function subfolders(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Notes, and the images and files they link to in `attachments/`. */
function noteTargets(notesDir) {
  if (!notesDir || !fs.existsSync(notesDir)) return [];
  const notes = filesIn(notesDir)
    .filter(isNoteName)
    .map((name) => ({ file: path.join(notesDir, name), kind: "note", mode: 0o644 }));
  const attachDir = path.join(notesDir, "attachments");
  const attachments = filesIn(attachDir).map((name) => ({ file: path.join(attachDir, name), kind: "attachment", mode: 0o644 }));
  return [...notes, ...attachments];
}

function userDataTargets(userData) {
  const jsons = JSON_STORES.map((name) => ({ file: path.join(userData, name), kind: "json", mode: 0o600 }));
  const dirs = DIR_STORES.flatMap(({ dir, kind }) => {
    const base = path.join(userData, dir);
    // Kept clipboard files live one folder down (whisperwoof-images/<id>/<name>).
    return [base, ...subfolders(base)].flatMap((folder) =>
      filesIn(folder).map((name) => ({ file: path.join(folder, name), kind, mode: 0o600 }))
    );
  });
  return [...jsons, ...dirs];
}

// ---------- cleanup of plaintext left behind ----------

/** Debug logs (can hold transcript snippets) and old meeting crash buffers in the temp folder. */
function removePlaintextLeftovers(userData) {
  const logs = path.join(userData, "logs");
  if (fs.existsSync(logs)) {
    for (const name of fs.readdirSync(logs)) {
      if (/^debug-.*\.log$/.test(name)) removeIfExists(path.join(logs, name));
    }
  }
  const tmp = os.tmpdir();
  for (const name of fs.existsSync(tmp) ? fs.readdirSync(tmp) : []) {
    if (/^meeting-audio-[0-9a-f-]{36}$/.test(name)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

// ---------- runner ----------

/**
 * Turning off, last pass: decrypt anything written sealed after the files
 * phase (dictation keeps working while it runs). Idempotent.
 */
function decryptRemaining(userData, notesDir) {
  sweep("disable", { userData, notesDir });
}

/**
 * Run (or resume) a migration.
 * opts: { Database, userData, notesDir, sealNotes, onProgress({direction, phase, done, total}) }
 */
async function run(direction, opts) {
  const {
    Database,
    userData,
    notesDir,
    sealNotes,
    onProgress = () => {},
    // The app keeps its databases open while files convert (so what you
    // dictate or copy lands in history); only the database step closes them.
    closeDatabases = async () => {},
    openDatabases = async () => {},
  } = opts;
  const existing = journalStore.read();
  let journal = existing && existing.direction === direction ? existing : journalStore.write(plan.startJournal(direction));
  const keyHex = vault.requireKeys().dbKeyHex;
  const report = (done, total) => onProgress({ direction, phase: journal.phase, done, total });

  const listTargets = () => targetsFor(direction, { userData, notesDir, sealNotes });
  // Files the app rewrites in place (Memory and the other stores, notes).
  // They're converted in one go before the app gets a turn, so a save can't
  // land between reading a file and replacing it.
  const rewritten = (target) => target.kind === "json" || target.kind === "note";

  const steps = {
    db: async () => {
      report(0, 1);
      await closeDatabases();
      migrateDatabase(Database, vaultPaths.dbFile(), direction, keyHex);
      await openDatabases();
    },
    files: async () => {
      const targets = listTargets();
      for (const dir of new Set(targets.map((t) => path.dirname(t.file)))) removeStaleTemps(dir);
      const first = targets.filter(rewritten);
      first.forEach((target) => convertNow(direction, target));
      report(first.length, targets.length);
      await convertInBatches(direction, targets.filter((t) => !rewritten(t)), (done) =>
        report(first.length + done, targets.length)
      );
      // Whatever the app saved meanwhile. While turning encryption off it still
      // writes encrypted copies, and those must not be left behind.
      sweep(direction, { userData, notesDir, sealNotes });
    },
    cleanup: () => {
      if (direction === "enable") removePlaintextLeftovers(userData);
      fs.rmSync(vaultPaths.tmpDir(), { recursive: true, force: true });
    },
  };
  while (journal.phase !== "done") {
    if (journal.phase !== "db") await openDatabases();
    await steps[journal.phase]();
    journal = journalStore.write(plan.advanceJournal(journal));
  }

  // Turning off keeps its (finished) journal until the caller has forgotten
  // the keys: a crash before that resumes turning off, and the now-plain
  // database stays openable (vault-db allows it only with that signed journal).
  if (direction !== "disable") journalStore.remove();
  report(1, 1);
}

function targetsFor(direction, { userData, notesDir, sealNotes }) {
  return [...userDataTargets(userData), ...(direction === "disable" || sealNotes ? noteTargets(notesDir) : [])];
}

/** Convert, in one go, anything not yet converted (what the app saved meanwhile). */
function sweep(direction, { userData, notesDir, sealNotes }) {
  targetsFor(direction, { userData, notesDir, sealNotes }).forEach((target) => convertNow(direction, target));
}

/** Sealed files still on disk among what turning off decrypts, plus the sealed inbox. */
function sealedLeftovers(userData, notesDir) {
  const targets = [...userDataTargets(userData), ...noteTargets(notesDir)]
    .map((t) => sealedPath(t.file))
    .filter((file) => fs.existsSync(file));
  const inboxDir = vaultPaths.inboxDir();
  const inbox = fs.existsSync(inboxDir)
    ? fs.readdirSync(inboxDir).filter((n) => n.endsWith(SEALED_EXT)).map((n) => path.join(inboxDir, n))
    : [];
  return [...targets, ...inbox];
}

/**
 * Whether the disk shows encryption is really off: the database is plain (or
 * absent) with no encrypted original left beside it, and nothing sealed
 * remains. Only then may the vault (and with it the keys) be forgotten.
 */
function isTurnedOff(userData, notesDir) {
  const file = vaultPaths.dbFile();
  return (
    plan.sqliteState(readHead(file)) !== "encrypted" &&
    !fs.existsSync(file + OLD_EXT) &&
    sealedLeftovers(userData, notesDir).length === 0
  );
}

/**
 * Unseal the notes (and attachments) this vault can open, skipping any it
 * can't (another Mac's). For notes sealed only because "keep notes readable"
 * hadn't been checked yet when they were written.
 */
function unsealOpenableNotes(notesDir) {
  let unsealed = 0;
  for (const target of noteTargets(notesDir)) {
    if (!fs.existsSync(sealedPath(target.file))) continue;
    try {
      if (migrateFile("disable", target)) unsealed += 1;
    } catch {
      // Not this vault's (or damaged): it stays as it is.
    }
  }
  return unsealed;
}

/** Seal (seal=true) or unseal every note in the folder — for the "keep notes readable" switch. */
function convertNotes(notesDir, seal, onProgress = () => {}) {
  const targets = noteTargets(notesDir);
  if (notesDir) removeStaleTemps(notesDir);
  targets.forEach((target, i) => {
    migrateFile(seal ? "enable" : "disable", target);
    onProgress({ direction: "notes", phase: "files", done: i + 1, total: targets.length });
  });
}

module.exports = {
  run,
  sweep,
  openAs,
  settle,
  tableCounts,
  noteTargets,
  isTurnedOff,
  decryptRemaining,
  sealedLeftovers,
  unsealOpenableNotes,
  convertNotes,
  migrateDatabase,
  userDataTargets,
  JSON_STORES,
  SEALED_EXT,
  WORK_EXT,
  OLD_EXT,
};
