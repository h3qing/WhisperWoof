/**
 * Sealed inbox — what WhisperWoof saves while it's locked.
 *
 * Dictation keeps working while locked. Each write that would need the
 * database becomes one item, sealed to the vault's public key (so nobody can
 * read it until unlock) and replayed in order on unlock. Pure: no fs.
 */

const crypto = require("crypto");

const ITEM_VERSION = 1;
const OPS = Object.freeze([
  "transcription.save", // { pid, text, rawText, options }
  "transcription.audio", // { pid, audio (base64), metadata }
  "entry.save", // { entry }  entry.id is final; metadata.transcriptionId may be a pid
  "note.linkEntry", // { name, entryId }
  "note.fileInDefaultProject", // { name }
  "vocab.correction", // { args }
]);
const FILE_RE = /^\d{15}-\d{6}-[0-9a-f-]{36}\.wwenc$/;

// Anyone who can write the folder can seal an item (the key is public), so
// replay trusts nothing about an item's shape.
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isString = (v) => typeof v === "string";
const isOptional = (check) => (v) => v === undefined || v === null || check(v);
const isBase64 = (v) => isString(v) && /^[A-Za-z0-9+/]*={0,2}$/.test(v);

function isEntry(e) {
  return (
    isObject(e) &&
    isString(e.id) &&
    e.id.length > 0 &&
    isOptional(isString)(e.source) &&
    isOptional(isString)(e.rawText) &&
    isOptional(isString)(e.polished) &&
    isOptional(isString)(e.audioPath) &&
    isOptional((c) => isString(c) && !Number.isNaN(Date.parse(c)))(e.createdAt) &&
    isOptional(isObject)(e.metadata) &&
    isOptional(Number.isSafeInteger)(e.metadata?.transcriptionId)
  );
}

// What each op's data must look like. transcription.audio only ever attaches
// a recording to a transcription saved while locked (a provisional id): with
// a real id, a planted item could replace an existing recording.
const DATA_CHECKS = Object.freeze({
  "transcription.save": (d) =>
    isProvisionalId(d.pid) && isString(d.text) && isOptional(isString)(d.rawText) && isOptional(isObject)(d.options),
  "transcription.audio": (d) => isProvisionalId(d.pid) && isBase64(d.audio) && isOptional(isObject)(d.metadata),
  "entry.save": (d) => isEntry(d.entry),
  "note.linkEntry": (d) => isString(d.name) && isString(d.entryId),
  "note.fileInDefaultProject": (d) => isString(d.name),
  "vocab.correction": (d) =>
    isString(d.originalText) &&
    isString(d.newFieldValue) &&
    isOptional(isString)(d.bundleId) &&
    isOptional(Array.isArray)(d.swaps),
});

function makeItem(op, data, { seq, now = new Date(), id = crypto.randomUUID() }) {
  if (!OPS.includes(op)) throw new Error(`Unknown inbox op: ${op}`);
  return { v: ITEM_VERSION, id, seq, op, createdAt: now.toISOString(), data: data ?? {} };
}

class InvalidItemError extends Error {
  constructor() {
    super("Inbox item is damaged");
    this.name = "InvalidItemError";
    this.code = "INVALID_ITEM";
  }
}

function parseItem(json) {
  const ok =
    json &&
    json.v === ITEM_VERSION &&
    OPS.includes(json.op) &&
    typeof json.id === "string" &&
    Number.isInteger(json.seq) &&
    typeof json.createdAt === "string" &&
    !Number.isNaN(Date.parse(json.createdAt)) &&
    isObject(json.data) &&
    DATA_CHECKS[json.op](json.data);
  if (!ok) throw new InvalidItemError();
  return { v: json.v, id: json.id, seq: json.seq, op: json.op, createdAt: json.createdAt, data: json.data };
}

function itemFileName(item) {
  const ms = String(Date.parse(item.createdAt)).padStart(15, "0");
  const seq = String(item.seq % 1000000).padStart(6, "0");
  return `${ms}-${seq}-${item.id}.wwenc`;
}

function isItemFileName(name) {
  return typeof name === "string" && FILE_RE.test(name);
}

function sortItems(items) {
  return [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.seq - b.seq);
}

/** A stand-in transcription id handed to the renderer while locked (always negative). */
function provisionalId(seq, now = new Date()) {
  return -(now.getTime() * 1000 + (seq % 1000));
}

function isProvisionalId(value) {
  return Number.isSafeInteger(value) && value < 0;
}

/** The entry with a provisional transcriptionId replaced by the real one (or dropped). */
function remapEntry(entry, idMap) {
  const tid = entry?.metadata?.transcriptionId;
  if (!isProvisionalId(tid)) return entry;
  const { transcriptionId, ...rest } = entry.metadata;
  const real = idMap.get(transcriptionId);
  return { ...entry, metadata: real === undefined ? rest : { ...rest, transcriptionId: real } };
}

module.exports = {
  OPS,
  InvalidItemError,
  makeItem,
  parseItem,
  itemFileName,
  isItemFileName,
  sortItems,
  provisionalId,
  isProvisionalId,
  remapEntry,
};
