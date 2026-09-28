/**
 * The migration journal (userData/vault/migration.json): which migration is
 * running (turning encryption on or off, a new recovery phrase) and how far it
 * got. Every unlock acts on it, so it is signed with a MAC keyed from the
 * master key (migration-plan-pure signJournal). A journal this vault didn't
 * write — say, one planted while WhisperWoof was locked to make the next
 * unlock decrypt everything — is never acted on.
 */

const fs = require("fs");
const plan = require("./migration-plan-pure");
const vault = require("./vault-service");
const { vaultPaths, ensurePrivateDir, writeFileAtomic, removeIfExists } = require("./vault-paths");

/**
 * What the file on disk claims, unverified. Only for things that are safe to
 * get wrong: a status line on the lock screen, startup cleanup.
 */
function peek() {
  try {
    return plan.parseJournal(JSON.parse(fs.readFileSync(vaultPaths.journal(), "utf8")));
  } catch {
    return null;
  }
}

/** The journal, if this vault wrote it. Needs the unlock; null otherwise. */
function read() {
  const journal = peek();
  const current = vault.getVault();
  if (!journal || !current || !vault.isUnlocked()) return null;
  return plan.verifyJournal(journal, vault.requireMasterKey(), current.vaultId) ? journal : null;
}

/**
 * Sign and write a journal. The master key and vault id default to the
 * unlocked vault's; turning encryption on passes the new vault's, since it
 * writes the journal just before its first unlock.
 */
function write(journal, { masterKey, vaultId } = {}) {
  const key = masterKey || vault.requireMasterKey();
  const id = vaultId || vault.getVault()?.vaultId;
  if (!id) throw new Error("There's no vault to write a migration journal for");
  ensurePrivateDir(vaultPaths.dir());
  const signed = plan.signJournal(journal, key, id);
  writeFileAtomic(vaultPaths.journal(), JSON.stringify(signed));
  return signed;
}

function remove() {
  removeIfExists(vaultPaths.journal());
}

/**
 * Right after an unlock: delete a journal this vault didn't write, so nothing
 * acts on it. Returns what it claimed to be (for the caller to judge), or
 * null when there was nothing to drop.
 */
function dropUnverified() {
  if (!fs.existsSync(vaultPaths.journal()) || read()) return null;
  const claimed = peek() || { direction: null };
  remove();
  return claimed;
}

module.exports = { peek, read, write, remove, dropUnverified };
