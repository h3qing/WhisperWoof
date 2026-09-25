/**
 * Sealed inbox (userData/vault/inbox/) — writes made while WhisperWoof is
 * locked. Each item is one WWENC1 file sealed to the vault's public key;
 * nothing here can be read until unlock. On unlock, items are replayed in
 * order through the same functions the app uses when unlocked, and each file
 * is deleted only after its handler succeeded. Failed items stay for the next
 * unlock, so nothing is lost.
 */

const fs = require("fs");
const path = require("path");
const ww = require("./wwenc-pure");
const inbox = require("./inbox-pure");
const vault = require("./vault-service");
const { vaultPaths, ensurePrivateDir, writeFileAtomic, removeIfExists } = require("./vault-paths");

let seq = 0;

function nextSeq() {
  seq = (seq + 1) % 1000000;
  return seq;
}

/** Seal one op into the inbox. Works while locked (public key only). */
function record(op, data) {
  const item = inbox.makeItem(op, data, { seq: nextSeq() });
  const dir = ensurePrivateDir(vaultPaths.inboxDir());
  const sealed = ww.encrypt(Buffer.from(JSON.stringify(item), "utf8"), vault.sealPublicRaw(), { kind: "inbox" });
  writeFileAtomic(path.join(dir, inbox.itemFileName(item)), sealed);
  return item;
}

/** A transcription id to hand the renderer while locked (replaced by the real one on replay). */
function provisionalTranscriptionId() {
  return inbox.provisionalId(nextSeq());
}

function listItemFiles() {
  const dir = vaultPaths.inboxDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(inbox.isItemFileName).sort();
}

function count() {
  return listItemFiles().length;
}

function readItem(file) {
  const bytes = fs.readFileSync(path.join(vaultPaths.inboxDir(), file));
  const { plaintext } = vault.openSealed(bytes);
  return inbox.parseItem(JSON.parse(plaintext.toString("utf8")));
}

/**
 * Replay every item in order. `handlers[op](data, ctx)` performs one op;
 * ctx.idMap maps provisional transcription ids to real ones across items.
 * Returns { applied, failed }.
 */
async function replay(handlers, log = () => {}) {
  const idMap = new Map();
  let applied = 0;
  let failed = 0;
  for (const file of listItemFiles()) {
    try {
      const item = readItem(file);
      const handler = handlers[item.op];
      if (!handler) throw new Error(`No handler for ${item.op}`);
      await handler(item.data, { idMap, item });
      removeIfExists(path.join(vaultPaths.inboxDir(), file));
      applied += 1;
    } catch (err) {
      failed += 1;
      log(file, err);
    }
  }
  return { applied, failed };
}

module.exports = { record, provisionalTranscriptionId, count, replay, listItemFiles };
