/**
 * Opening transcriptions.db. With encryption on, every connection gets the
 * SQLCipher key derived from the master key (raw key → no KDF on open), and
 * temp tables stay in memory so sorts never spill plaintext to disk.
 * Never pass keys in URI filenames: this SQLite build has URIs off, so they'd
 * end up in the file name.
 */

const fs = require("fs");
const vault = require("./vault-service");
const { vaultPaths } = require("./vault-paths");

const KEY_HEX = /^[0-9a-f]{64}$/;

function applyKey(db, keyHex) {
  if (!KEY_HEX.test(keyHex)) throw new Error("Database key is malformed");
  db.pragma("cipher = 'sqlcipher'");
  db.pragma(`hexkey = '${keyHex}'`);
  db.pragma("temp_store = MEMORY");
  // Touch a page: a wrong key (or a plain file) fails here, not on first use.
  db.prepare("SELECT count(*) AS n FROM sqlite_master").get();
  return db;
}

/** A turn-off whose database step may already be done (then the file is plain). */
function turningOff() {
  try {
    const { parseJournal } = require("./migration-plan-pure");
    return parseJournal(JSON.parse(fs.readFileSync(vaultPaths.journal(), "utf8"))).direction === "disable";
  } catch {
    return false;
  }
}

function isPlainFile(file) {
  const { sqliteState } = require("./migration-plan-pure");
  try {
    const fd = fs.openSync(file, "r");
    const head = Buffer.alloc(16);
    const n = fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    return sqliteState(head.subarray(0, n)) === "plain";
  } catch {
    return false; // missing: SQLite creates it, encrypted
  }
}

/**
 * Open the app database the way encryption requires. Throws VaultLockedError
 * while locked, so callers can wait for the unlock. Tries every key the vault
 * currently accepts (a new recovery phrase may be half-rolled-out). A plain
 * file under an encrypted vault opens only while turning encryption off.
 */
function openDatabase(Database, file) {
  if (!vault.isOn()) return new Database(file);
  const keyHexes = [vault.requireKeys().dbKeyHex, ...vault.extraDbKeys()];
  if (isPlainFile(file) && turningOff()) return new Database(file);
  let lastError;
  for (const keyHex of keyHexes) {
    const db = new Database(file);
    try {
      return applyKey(db, keyHex);
    } catch (err) {
      db.close();
      lastError = err;
    }
  }
  throw lastError;
}

module.exports = { openDatabase, applyKey };
