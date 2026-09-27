/**
 * Files that may be sealed. Callers keep their usual (logical) paths; when
 * encryption is on, the bytes live in "<path>.wwenc" instead.
 *
 * - Writing seals to the vault's public key, so it works while locked.
 * - Reading a sealed file needs the unlock (throws VaultLockedError).
 * - With encryption off, everything is a plain file, as before.
 * - With encryption on, the stores WhisperWoof keeps in userData (Memory,
 *   style examples, recordings, images…) are only ever read sealed. A plain
 *   copy there is either a migration still under way (read while its signed
 *   journal is there) or a file someone planted while WhisperWoof was locked
 *   (never read). Notes may be plain on purpose ("keep notes readable").
 */

const fs = require("fs");
const path = require("path");
const ww = require("./wwenc-pure");
const vault = require("./vault-service");
const debugLogger = require("../../../helpers/debugLogger");
const { vaultPaths, writeFileAtomic, removeIfExists } = require("./vault-paths");

const SEALED_EXT = ".wwenc";

// What turning encryption on seals in userData (vault-migrate converts these).
const SEALED_JSON_STORES = Object.freeze([
  "whisperwoof-vocabulary.json",
  "whisperwoof-style-examples.json",
  "whisperwoof-focus-sessions.json",
  "whisperwoof-schedules.json",
  "whisperwoof-templates.json",
  "eval-dataset.json",
]);
const SEALED_DIR_STORES = Object.freeze([
  Object.freeze({ dir: "audio", kind: "audio" }),
  Object.freeze({ dir: "whisperwoof-images", kind: "image" }),
  Object.freeze({ dir: "eval-audio", kind: "audio" }),
]);

const sealedPath = (p) => `${p}${SEALED_EXT}`;
const isSealedName = (name) => name.endsWith(SEALED_EXT);
const logicalName = (name) => (isSealedName(name) ? name.slice(0, -SEALED_EXT.length) : name);

/** One of the userData stores that encryption always seals. */
function mustBeSealed(p) {
  const rel = path.relative(path.dirname(vaultPaths.dir()), path.resolve(p));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const [top, ...rest] = rel.split(path.sep);
  return rest.length === 0 ? SEALED_JSON_STORES.includes(top) : SEALED_DIR_STORES.some((s) => s.dir === top);
}

/** A plain file under encryption: fine outside the sealed stores, or while a migration this vault started runs. */
function plainAllowed(p) {
  if (!mustBeSealed(p)) return true;
  const journal = require("./vault-journal").read();
  return Boolean(journal) && journal.direction !== "rotate";
}

/**
 * The file on disk for a logical path, or null. With encryption on the sealed
 * form wins, and a plain form of a sealed store counts only while a migration
 * runs; with encryption off the plain form wins (a stray sealed copy can't be read).
 */
function physicalPath(p) {
  if (!vault.isOn()) return [p, sealedPath(p)].find((candidate) => fs.existsSync(candidate)) ?? null;
  if (fs.existsSync(sealedPath(p))) return sealedPath(p);
  return fs.existsSync(p) && plainAllowed(p) ? p : null;
}

/** Whether either form is on disk (a refused plain copy still counts, so stores don't take it for empty). */
function exists(p) {
  return fs.existsSync(p) || fs.existsSync(sealedPath(p));
}

const refusedPaths = new Set();

function refusedPlainError(p) {
  if (!refusedPaths.has(p)) {
    refusedPaths.add(p);
    debugLogger.warn("[Vault] Didn't read a plain file where an encrypted one belongs", { file: path.basename(p) });
  }
  // Callers treat it like "locked": nothing read, and nothing written over it from an empty read.
  return new vault.VaultLockedError("This file should be encrypted but isn't, so it wasn't read");
}

function statFile(p) {
  const physical = physicalPath(p);
  return physical ? fs.statSync(physical) : null;
}

function openSealed(bytes) {
  return vault.openSealed(bytes).plaintext;
}

/**
 * Read a file's plaintext. Throws ENOENT like fs, or VaultLockedError for a
 * sealed file while locked (and for a plain copy of a sealed store).
 */
function readFile(p) {
  const physical = physicalPath(p);
  if (!physical) {
    if (fs.existsSync(p)) throw refusedPlainError(p);
    const err = new Error(`ENOENT: no such file, open '${p}'`);
    err.code = "ENOENT";
    throw err;
  }
  const bytes = fs.readFileSync(physical);
  return physical === p ? bytes : openSealed(bytes);
}

function readText(p) {
  return readFile(p).toString("utf8");
}

/**
 * Write a file. `seal` defaults to "encryption is on". Writes are atomic and
 * remove the other form, so a path never has both a plain and a sealed copy.
 * `requireUnlocked` refuses the write while WhisperWoof is locked.
 */
function writeFile(p, data, { kind = "blob", seal = vault.isOn(), requireUnlocked = false } = {}) {
  // Stores that rewrite their whole file from a fresh read must not write while
  // locked: their read came back empty, and the write would drop the rest.
  if (requireUnlocked && vault.isOn() && !vault.isUnlocked()) throw new vault.VaultLockedError();
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (seal) {
    writeFileAtomic(sealedPath(p), ww.encrypt(bytes, vault.sealPublicRaw(), { kind }));
    removeIfExists(p);
  } else {
    // Readable by this account only: other users on the Mac/PC get nothing
    // (clipboard images, recordings, Memory, notes).
    writeFileAtomic(p, bytes, 0o600);
    // Only drop the sealed copy while the vault can vouch for it (notes turned readable).
    if (vault.isOn()) removeIfExists(sealedPath(p));
  }
}

function writeText(p, text, opts) {
  writeFile(p, Buffer.from(String(text), "utf8"), opts);
}

function readJson(p, fallback) {
  if (!exists(p)) return fallback;
  return JSON.parse(readText(p));
}

function writeJson(p, value, opts) {
  writeText(p, JSON.stringify(value, null, 2), { kind: "json", ...opts });
}

function unlink(p) {
  removeIfExists(p);
  removeIfExists(sealedPath(p));
}

/** Logical names in a directory (sealed and plain alike), each once. */
function listNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return [...new Set(fs.readdirSync(dir).filter((n) => !/\.tmp-[0-9a-f]{8}$/.test(n)).map(logicalName))];
}

module.exports = {
  SEALED_EXT,
  SEALED_JSON_STORES,
  SEALED_DIR_STORES,
  sealedPath,
  isSealedName,
  logicalName,
  physicalPath,
  exists,
  statFile,
  readFile,
  readText,
  writeFile,
  writeText,
  readJson,
  writeJson,
  unlink,
  listNames,
};
