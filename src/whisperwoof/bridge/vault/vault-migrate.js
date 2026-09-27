/**
 * Turning encryption on / off (and converting notes alone), crash-safe.
 * What to do next is always decided from what's on disk
 * (migration-plan-pure), so the runner can be re-run from any point; the
 * journal only remembers the direction and phase.
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
const { applyKey } = require("./vault-db");
const { SEALED_EXT, sealedPath, listNames } = require("./vault-files");
const {
  vaultPaths,
  ensurePrivateDir,
  writeFileAtomic,
  writeFileAtomicAsync,
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

// ---------- journal ----------

function readJournal() {
  try {
    return plan.parseJournal(JSON.parse(fs.readFileSync(vaultPaths.journal(), "utf8")));
  } catch {
    return null;
  }
}

function writeJournal(journal) {
  ensurePrivateDir(vaultPaths.dir());
  writeFileAtomic(vaultPaths.journal(), JSON.stringify(journal));
  return journal;
}

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
 * (fsynced; its folder isn't synced yet). null when there's nothing to do.
 */
async function stageFile(direction, target) {
  const { file, kind, mode } = target;
  const sealed = sealedPath(file);
  const step = plan.planFileStep(direction, { plain: fs.existsSync(file), sealed: fs.existsSync(sealed) });
  if (step === "done") return null;
  try {
    if (direction === "enable") {
      const original = await fs.promises.stat(file);
      const plain = await fs.promises.readFile(file);
      if (step === "convert") await writeFileAtomicAsync(sealed, sealBytes(plain, kind), 0o600, original);
      return { target, source: file, written: sealed, original, hash: sha256(plain) };
    }
    const original = await fs.promises.stat(sealed);
    const plain = openBytes(await fs.promises.readFile(sealed));
    const alreadyThere = step !== "convert" && sha256(await fs.promises.readFile(file)).equals(sha256(plain));
    if (!alreadyThere) await writeFileAtomicAsync(file, plain, mode, original);
    return { target, source: sealed, written: file, original, hash: sha256(plain) };
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
    await fs.promises.rm(staged.source, { force: true });
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

const JSON_STORES = [
  "whisperwoof-vocabulary.json",
  "whisperwoof-style-examples.json",
  "whisperwoof-focus-sessions.json",
  "whisperwoof-schedules.json",
  "whisperwoof-templates.json",
  "eval-dataset.json",
];

const DIR_STORES = [
  { dir: "audio", kind: "audio" },
  { dir: "whisperwoof-images", kind: "image" },
  { dir: "eval-audio", kind: "audio" },
];

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
 * Run (or resume) a migration.
 * opts: { Database, userData, notesDir, sealNotes, onProgress({direction, phase, done, total}) }
 */
async function run(direction, opts) {
  const { Database, userData, notesDir, sealNotes, onProgress = () => {} } = opts;
  const existing = readJournal();
  let journal = existing && existing.direction === direction ? existing : writeJournal(plan.startJournal(direction));
  const keyHex = vault.requireKeys().dbKeyHex;
  const report = (done, total) => onProgress({ direction, phase: journal.phase, done, total });

  const listTargets = () => [
    ...userDataTargets(userData),
    ...(direction === "disable" || sealNotes ? noteTargets(notesDir) : []),
  ];
  // Files the app rewrites in place (Memory and the other stores, notes).
  // They're converted in one go before the app gets a turn, so a save can't
  // land between reading a file and replacing it.
  const rewritten = (target) => target.kind === "json" || target.kind === "note";

  const steps = {
    db: () => {
      report(0, 1);
      migrateDatabase(Database, vaultPaths.dbFile(), direction, keyHex);
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
      listTargets().forEach((target) => convertNow(direction, target));
    },
    cleanup: () => {
      if (direction === "enable") removePlaintextLeftovers(userData);
      fs.rmSync(vaultPaths.tmpDir(), { recursive: true, force: true });
    },
  };
  while (journal.phase !== "done") {
    await steps[journal.phase]();
    journal = writeJournal(plan.advanceJournal(journal));
  }

  removeIfExists(vaultPaths.journal());
  report(1, 1);
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
  openAs,
  settle,
  tableCounts,
  noteTargets,
  readJournal,
  convertNotes,
  migrateDatabase,
  userDataTargets,
  JSON_STORES,
  SEALED_EXT,
  WORK_EXT,
  OLD_EXT,
};
