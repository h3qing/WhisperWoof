/**
 * Opening transcriptions.db. With encryption on, every connection gets the
 * SQLCipher key derived from the master key (raw key → no KDF on open), and
 * temp tables stay in memory so sorts never spill plaintext to disk.
 * Never pass keys in URI filenames: this SQLite build has URIs off, so they'd
 * end up in the file name.
 */

const vault = require("./vault-service");

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

/**
 * Open the app database the way encryption requires. Throws VaultLockedError
 * while locked, so callers can wait for the unlock.
 */
function openDatabase(Database, file) {
  if (!vault.isOn()) return new Database(file);
  const { dbKeyHex } = vault.requireKeys();
  const db = new Database(file);
  try {
    return applyKey(db, dbKeyHex);
  } catch (err) {
    db.close();
    throw err;
  }
}

module.exports = { openDatabase, applyKey };
