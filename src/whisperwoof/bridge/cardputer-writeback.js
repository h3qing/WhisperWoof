/**
 * Writes into a Cardputer session folder (recording file contract v1 §7.7):
 * every file goes to a dot-prefixed temp file (0600, never through a
 * symlink), is fsynced, then renamed into place, and the folder is fsynced.
 * result.json is written last and never over an existing one: it is linked
 * into place, which fails if the name exists, so a result someone else wrote
 * (or the user's own) always wins.
 *
 * A session folder may disappear at any time (deleted, or moved to the
 * Trash): that cancels the session. Nothing here creates a folder, and once
 * it is gone every check and write says CARDPUTER_GONE instead of ENOENT.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
const RESULT = "result.json";
const MISSING = new Set(["ENOENT", "ENOTDIR"]);

function takenError() {
  const error = new Error("result.json already exists");
  error.code = "CARDPUTER_TAKEN";
  return error;
}

function isTaken(error) {
  return error?.code === "CARDPUTER_TAKEN";
}

function goneError() {
  const error = new Error("The session folder is gone");
  error.code = "CARDPUTER_GONE";
  return error;
}

function isGone(error) {
  return error?.code === "CARDPUTER_GONE";
}

/** True once dir is no longer a real folder: deleted, moved away, or replaced. */
function folderGone(dir) {
  try {
    return !fs.lstatSync(dir).isDirectory();
  } catch (error) {
    return MISSING.has(error.code);
  }
}

/**
 * Throws CARDPUTER_TAKEN once result.json exists (the folder is no longer
 * ours to write) and CARDPUTER_GONE once the folder itself is gone.
 */
function assertOpen(dir) {
  try {
    fs.lstatSync(path.join(dir, RESULT));
  } catch (error) {
    if (!MISSING.has(error.code)) throw error;
    if (folderGone(dir)) throw goneError();
    return;
  }
  throw takenError();
}

function fsyncDir(dir) {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeTemp(dir, name, bytes) {
  const tmp = path.join(
    dir,
    `.${name}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  const fd = fs.openSync(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  return tmp;
}

// Volumes without hard links (exFAT, some network shares) answer link(2) with these.
const NO_HARD_LINKS = new Set(["ENOTSUP", "EOPNOTSUPP", "EPERM", "ENOSYS"]);

/** link(2) fails if the name exists: a result.json someone else wrote always wins. */
function placeWithoutReplacing(tmp, target, dir) {
  try {
    fs.linkSync(tmp, target);
    fs.unlinkSync(tmp);
  } catch (error) {
    if (!NO_HARD_LINKS.has(error.code)) throw error;
    assertOpen(dir); // no atomic no-replace here: check, then rename
    fs.renameSync(tmp, target);
  }
}

function writeInPlace(dir, name, bytes) {
  const tmp = writeTemp(dir, name, bytes);
  const target = path.join(dir, name);
  try {
    if (name === RESULT) placeWithoutReplacing(tmp, target, dir);
    else fs.renameSync(tmp, target);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error.code === "EEXIST" ? takenError() : error;
  }
  fsyncDir(dir);
}

/**
 * Atomically writes `data` (string or Buffer) as dir/name. → sha256 (hex) of
 * the bytes written. result.json is never replaced (CARDPUTER_TAKEN); a
 * folder that is gone is never recreated (CARDPUTER_GONE).
 */
function writeAtomic(dir, name, data) {
  if (path.basename(name) !== name || name.startsWith(".")) throw new Error("Bad file name");
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  try {
    writeInPlace(dir, name, bytes);
  } catch (error) {
    throw MISSING.has(error.code) && folderGone(dir) ? goneError() : error;
  }
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

module.exports = {
  writeAtomic,
  assertOpen,
  isTaken,
  takenError,
  isGone,
  folderGone,
  RESULT,
};
