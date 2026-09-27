/**
 * Where the vault keeps its files, and small fs helpers they all share.
 * Everything under userData/vault/ is created 0700.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const userData = () => app.getPath("userData");
const vaultDir = () => path.join(userData(), "vault");

const vaultPaths = {
  dir: vaultDir,
  vaultFile: () => path.join(vaultDir(), "vault.json"),
  vaultBackup: () => path.join(vaultDir(), "vault.json.bak"),
  nextVaultFile: () => path.join(vaultDir(), "vault.next.json"),
  journal: () => path.join(vaultDir(), "migration.json"),
  inboxDir: () => path.join(vaultDir(), "inbox"),
  tmpDir: () => path.join(vaultDir(), "tmp"),
  dbFile: () =>
    path.join(userData(), process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"),
};

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * Write via a temp file + fsync + rename, so a crash leaves the old or the new
 * file, never half. `times` (a Stats) gives the new file those dates first.
 */
function writeFileAtomic(file, data, mode = 0o600, times = null) {
  const tmp = `${file}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (times) keepTimes(tmp, times);
  fs.renameSync(tmp, file);
  syncDir(path.dirname(file));
}

/**
 * Give a converted file its original's dates. Audio Retention ages recordings
 * by modified time and the Notes list sorts by it, so a conversion must not
 * make a file look new.
 */
function keepTimes(file, original) {
  fs.utimesSync(file, original.atime, original.mtime);
}

/**
 * writeFileAtomic for converting many files: the write and fsync run off the
 * main thread, and the folder isn't synced here. The caller syncs each folder
 * once per batch (syncDirAsync) before trusting the renames.
 */
async function writeFileAtomicAsync(file, data, mode = 0o600, times = null) {
  const tmp = `${file}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  const handle = await fs.promises.open(tmp, "w", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (times) await fs.promises.utimes(tmp, times.atime, times.mtime);
  await fs.promises.rename(tmp, file);
}

async function syncDirAsync(dir) {
  try {
    const handle = await fs.promises.open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Not every filesystem lets a directory be fsynced; the rename is still atomic.
  }
}

// Converting many files (turning encryption on/off, a new phrase) runs in
// batches so the app keeps working: each file's write and fsync happen off the
// main thread a few at a time, and each folder is synced once per batch.
const CONVERT_BATCH = 32;
const CONVERT_PARALLEL = 4;

/** Run `fn` over `items`, `size` at a time, keeping the results in order. */
async function inGroups(items, size, fn) {
  const groups = Array.from({ length: Math.ceil(items.length / size) }, (_, g) => items.slice(g * size, g * size + size));
  let results = [];
  for (const group of groups) results = [...results, ...(await Promise.all(group.map(fn)))];
  return results;
}

function syncDir(dir) {
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Not every filesystem lets a directory be fsynced; the rename is still atomic.
  }
}

function removeIfExists(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Already gone.
  }
}

/** Leftover "*.tmp-xxxx" files from an interrupted atomic write in `dir`. */
function removeStaleTemps(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (/\.tmp-[0-9a-f]{8}$/.test(name)) removeIfExists(path.join(dir, name));
  }
}

module.exports = {
  vaultPaths,
  ensurePrivateDir,
  writeFileAtomic,
  writeFileAtomicAsync,
  syncDirAsync,
  inGroups,
  CONVERT_BATCH,
  CONVERT_PARALLEL,
  keepTimes,
  syncDir,
  removeIfExists,
  removeStaleTemps,
};
