/**
 * Files that may be sealed. Callers keep their usual (logical) paths; when
 * encryption is on, the bytes live in "<path>.wwenc" instead.
 *
 * - Writing seals to the vault's public key, so it works while locked.
 * - Reading a sealed file needs the unlock (throws VaultLockedError).
 * - With encryption off, everything is a plain file, as before.
 */

const fs = require("fs");
const path = require("path");
const ww = require("./wwenc-pure");
const vault = require("./vault-service");
const { writeFileAtomic, removeIfExists } = require("./vault-paths");

const SEALED_EXT = ".wwenc";

const sealedPath = (p) => `${p}${SEALED_EXT}`;
const isSealedName = (name) => name.endsWith(SEALED_EXT);
const logicalName = (name) => (isSealedName(name) ? name.slice(0, -SEALED_EXT.length) : name);

/** The file on disk for a logical path: the sealed one if present, else the plain one, else null. */
function physicalPath(p) {
  if (fs.existsSync(sealedPath(p))) return sealedPath(p);
  if (fs.existsSync(p)) return p;
  return null;
}

function exists(p) {
  return physicalPath(p) !== null;
}

function statFile(p) {
  const physical = physicalPath(p);
  return physical ? fs.statSync(physical) : null;
}

function openSealed(bytes) {
  return vault.openSealed(bytes).plaintext;
}

/** Read a file's plaintext. Throws ENOENT like fs, or VaultLockedError for a sealed file while locked. */
function readFile(p) {
  const physical = physicalPath(p);
  if (!physical) {
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
 */
function writeFile(p, data, { kind = "blob", seal = vault.isOn() } = {}) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (seal) {
    writeFileAtomic(sealedPath(p), ww.encrypt(bytes, vault.sealPublicRaw(), { kind }));
    removeIfExists(p);
  } else {
    writeFileAtomic(p, bytes, 0o644);
    removeIfExists(sealedPath(p));
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
