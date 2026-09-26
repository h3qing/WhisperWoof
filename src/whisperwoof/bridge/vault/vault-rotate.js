/**
 * "Make a new recovery phrase" — moves everything to a new master key, so the
 * old phrase stops working. Crash-safe:
 *
 * 1. vault.next.json holds the new vault (same password, Touch ID re-wrapped
 *    to the same Secure Enclave key) plus a link: the new master key sealed
 *    under the old one. Any unlock of the old vault can therefore resume.
 * 2. While it runs, new files are sealed to the new key; files still on the
 *    old key keep opening.
 * 3. Database: copy → rekey the copy → verify → swap. Files: only the header
 *    is re-wrapped (each file keeps its own key), so audio isn't re-encrypted.
 * 4. The new vault replaces vault.json; the link and the journal are deleted.
 */

const fs = require("fs");
const path = require("path");
const vk = require("./vault-keys-pure");
const vc = require("./vault-crypto-pure");
const ww = require("./wwenc-pure");
const planPure = require("./migration-plan-pure");
const vault = require("./vault-service");
const migrate = require("./vault-migrate");
const { sealedPath } = require("./vault-files");
const { vaultPaths, ensurePrivateDir, writeFileAtomic, removeIfExists } = require("./vault-paths");
const debugLogger = require("../../../helpers/debugLogger");

const PASSWORD_TTL_MS = 30 * 60 * 1000;
const LINK_INFO = "whisperwoof/rotate/v1";

let deps = null; // { Database, userData(), notesDir(), closeDatabases(), openDatabases(), onProgress(p) }
let pending = null; // { password, expires } between "confirm it's you" and "confirm the words"

function configure(nextDeps) {
  deps = nextDeps;
}

function rememberPassword(password) {
  pending = { password, expires: Date.now() + PASSWORD_TTL_MS };
}

function takePassword() {
  const p = pending;
  pending = null;
  if (!p || Date.now() > p.expires) throw Object.assign(new Error("That took too long. Start again."), { code: "INVALID" });
  return p.password;
}

const linkAad = (vaultId) => `whisperwoof-rotate/v1/${vaultId}`;

function buildNextVault(oldVault, oldMasterKey, entropy, password) {
  const { vault: fresh, masterKey } = vk.createVault({ entropy, password });
  const withPrefs = { ...fresh, createdAt: oldVault.createdAt, prefs: { ...oldVault.prefs, touchId: false } };
  const next = oldVault.touchId
    ? vk.setTouchIdWrap(withPrefs, masterKey, {
        publicKey: Buffer.from(oldVault.touchId.sePublicKey, "base64"),
        keyBlob: vk.touchIdKeyBlob(oldVault),
      })
    : withPrefs;
  const link = vc.aeadSeal(vc.hkdf(oldMasterKey, LINK_INFO), masterKey, linkAad(next.vaultId));
  return { next, masterKey, link: vc.boxToJson(link) };
}

function readNext() {
  try {
    const json = JSON.parse(fs.readFileSync(vaultPaths.nextVaultFile(), "utf8"));
    return { next: vk.parseVault(json.vault), link: vc.boxFromJson(json.link) };
  } catch {
    return null;
  }
}

/** The new master key, from the link, using the old one we're unlocked with. */
function masterKeyFromLink(next, link) {
  const mk = vc.aeadOpen(vc.hkdf(vault.requireMasterKey(), LINK_INFO), link, linkAad(next.vaultId));
  if (!vk.verifyMasterKey(next, mk)) throw new Error("The new recovery phrase doesn't match");
  return mk;
}

function opensWithKey(Database, file, keyHex) {
  try {
    migrate.openAs(Database, file, true, keyHex).close();
    return true;
  } catch {
    return false;
  }
}

function rotateDatabase(Database, file, oldHex, newHex) {
  const work = file + migrate.WORK_EXT;
  const old = file + migrate.OLD_EXT;
  if (!fs.existsSync(file) && fs.existsSync(work) && opensWithKey(Database, work, newHex)) fs.renameSync(work, file);
  if (!fs.existsSync(file) && fs.existsSync(old)) fs.renameSync(old, file);
  if (fs.existsSync(file) && !opensWithKey(Database, file, newHex)) {
    removeIfExists(work);
    const expected = migrate.settle(Database, file, true, oldHex);
    fs.copyFileSync(file, work);
    const db = migrate.openAs(Database, work, true, oldHex);
    try {
      db.pragma(`hexrekey = '${newHex}'`);
    } finally {
      db.close();
    }
    const check = migrate.openAs(Database, work, true, newHex);
    try {
      const same = JSON.stringify(migrate.tableCounts(check)) === JSON.stringify(expected);
      if (check.pragma("integrity_check", { simple: true }) !== "ok" || !same) {
        throw new Error("The re-keyed database didn't match the original");
      }
    } finally {
      check.close();
    }
    removeIfExists(`${file}-wal`);
    removeIfExists(`${file}-shm`);
    fs.renameSync(file, old);
    fs.renameSync(work, file);
  }
  for (const suffix of ["", "-wal", "-shm"]) removeIfExists(old + suffix);
  removeIfExists(work);
}

function sealedFiles(userData, notesDir) {
  const inbox = fs.existsSync(vaultPaths.inboxDir())
    ? fs.readdirSync(vaultPaths.inboxDir()).map((n) => path.join(vaultPaths.inboxDir(), n))
    : [];
  const logical = [...migrate.userDataTargets(userData), ...migrate.noteTargets(notesDir)].map((t) => sealedPath(t.file));
  return [...logical, ...inbox].filter((f) => f.endsWith(".wwenc") && fs.existsSync(f));
}

/**
 * Move each sealed file to the new key. A file neither key opens (a note
 * synced from another Mac's vault, a damaged file) is left as it is: it
 * wasn't readable before either, and it must not stop the rollout.
 */
function rewrapFiles(files, oldPrivateKey, newKeys, onProgress) {
  const skipped = [];
  files.forEach((file, i) => {
    const bytes = fs.readFileSync(file);
    if (ww.opensWith(bytes, newKeys.sealPrivateKey)) return;
    if (!ww.opensWith(bytes, oldPrivateKey)) {
      skipped.push(file);
      return;
    }
    writeFileAtomic(file, ww.rewrap(bytes, oldPrivateKey, newKeys.sealPublicRaw), 0o600, fs.statSync(file));
    if (i % 10 === 0 || i === files.length - 1) onProgress({ direction: "rotate", phase: "files", done: i + 1, total: files.length });
  });
  return skipped;
}

function finishedAlready(saved) {
  return saved.next.vaultId === vault.getVault()?.vaultId;
}

function removeLeftovers() {
  removeIfExists(vaultPaths.nextVaultFile());
  removeIfExists(vaultPaths.journal());
}

/**
 * Carry out (or resume) a rotation from the old vault, unlocked. Order:
 * files (skip unreadable) → database → adopt the new vault → delete the link
 * and the journal. If it stops, the new keys stay accepted for this session
 * (reads and the database keep working) and the next unlock resumes.
 */
async function finish() {
  const d = deps;
  const saved = readNext();
  if (!saved) {
    removeLeftovers();
    return;
  }
  if (finishedAlready(saved)) {
    removeLeftovers(); // crashed after adopting, before cleaning up
    return;
  }
  const newMasterKey = masterKeyFromLink(saved.next, saved.link);
  const oldKeys = vault.requireKeys();
  const newKeys = vk.deriveKeys(newMasterKey);
  vault.setRotation({
    sealPublic: newKeys.sealPublicRaw,
    extraPrivateKeys: [newKeys.sealPrivateKey],
    extraDbKeys: [newKeys.dbKeyHex],
  });
  try {
    d.onProgress({ direction: "rotate", phase: "files", done: 0, total: 1 });
    const skipped = rewrapFiles(sealedFiles(d.userData(), d.notesDir()), oldKeys.sealPrivateKey, newKeys, d.onProgress);
    if (skipped.length > 0) debugLogger.warn("[Vault] Left files no key opens as they are", { count: skipped.length });
    d.onProgress({ direction: "rotate", phase: "db", done: 0, total: 1 });
    await d.closeDatabases();
    rotateDatabase(d.Database, vaultPaths.dbFile(), oldKeys.dbKeyHex, newKeys.dbKeyHex);
    vault.replaceVault(saved.next, newMasterKey);
    removeLeftovers();
    d.onProgress(null);
  } finally {
    await d.openDatabases?.();
  }
}

async function rotate(entropy) {
  const password = takePassword();
  const oldVault = vault.getVault();
  const { next, link } = buildNextVault(oldVault, vault.requireMasterKey(), entropy, password);
  ensurePrivateDir(vaultPaths.dir());
  writeFileAtomic(vaultPaths.nextVaultFile(), JSON.stringify({ vault: next, link }));
  writeFileAtomic(vaultPaths.journal(), JSON.stringify(planPure.startJournal("rotate")));
  await finish();
}

module.exports = { configure, rememberPassword, rotate, finish };
