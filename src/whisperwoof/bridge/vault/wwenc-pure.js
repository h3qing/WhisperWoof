/**
 * WWENC1 — WhisperWoof's sealed file format (audio, images, notes, JSON,
 * inbox items). Pure: Buffers in, Buffers out.
 *
 *   "WWENC1" | u32 header length | header JSON { v, kind, eph, wk, np }
 *            | HMAC-SHA256(header)  (key derived from the file key)
 *            | chunks: u32 length | AES-256-GCM(≤ 64 KiB)
 *              nonce = np(7) ‖ u32 counter ‖ last-flag(1)
 *
 * Each file gets a random file key, wrapped to the vault's X25519 public key
 * (ephemeral X25519 → HKDF → AES-GCM), so writing needs only the public key
 * and works while WhisperWoof is locked. Reading needs the private key.
 * Detects: changed bytes, reordered chunks, swapped headers, a missing end.
 */

const crypto = require("crypto");
const vc = require("./vault-crypto-pure");

const MAGIC = Buffer.from("WWENC1", "latin1");
const FORMAT_VERSION = 1;
const CHUNK_SIZE = 65536;
const MAX_HEADER = 4096;
const MAC_LEN = 32;
const NONCE_PREFIX_LEN = 7;
const MAX_CHUNK_CT = CHUNK_SIZE + vc.TAG_LEN;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;

class WwencError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WwencError";
    this.code = code;
  }
}

const tampered = () => new WwencError("TAMPERED", "This file was changed or damaged");

function isEncrypted(buf) {
  return Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function wrapKey(shared, ephRaw, recipientRaw) {
  return vc.hkdf(shared, "wwenc/wrap/v1", 32, Buffer.concat([ephRaw, recipientRaw]));
}

function headerMac(fileKey, headerBytes) {
  return vc.hmac(vc.hkdf(fileKey, "wwenc/header/v1"), headerBytes.toString("latin1"));
}

function payloadKeyFor(fileKey) {
  return vc.hkdf(fileKey, "wwenc/payload/v1");
}

function nonceFor(prefix, index, last) {
  const n = Buffer.alloc(vc.NONCE_LEN);
  prefix.copy(n, 0);
  n.writeUInt32BE(index, NONCE_PREFIX_LEN);
  n[vc.NONCE_LEN - 1] = last ? 1 : 0;
  return n;
}

function buildHeader(fileKey, recipientRaw, kind, noncePrefix) {
  const eph = vc.x25519Generate();
  const shared = vc.x25519Shared(eph.privateKey, vc.x25519PublicFromRaw(recipientRaw));
  const wk = vc.aeadSeal(wrapKey(shared, eph.publicRaw, recipientRaw), fileKey, "WWENC1", Buffer.alloc(vc.NONCE_LEN));
  const json = Buffer.from(
    JSON.stringify({
      v: FORMAT_VERSION,
      kind,
      eph: eph.publicRaw.toString("base64"),
      wk: wk.ct.toString("base64"),
      np: noncePrefix.toString("base64"),
    }),
    "utf8"
  );
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length, 0);
  const headerBytes = Buffer.concat([MAGIC, len, json]);
  return Buffer.concat([headerBytes, headerMac(fileKey, headerBytes)]);
}

function createStream(recipientPublicRaw, { kind = "blob" } = {}) {
  if (!KIND_RE.test(kind)) throw new Error(`Invalid kind: ${kind}`);
  const fileKey = vc.randomBytes(32);
  const noncePrefix = vc.randomBytes(NONCE_PREFIX_LEN);
  const header = buildHeader(fileKey, recipientPublicRaw, kind, noncePrefix);
  const state = Object.freeze({ payloadKey: payloadKeyFor(fileKey), noncePrefix });
  vc.wipe(fileKey);
  return { header, state };
}

/** One length-prefixed chunk. `index` counts from 0; mark the last one. */
function sealChunk(state, index, plaintext, last) {
  if (plaintext.length > CHUNK_SIZE) throw new Error("Chunk is larger than 64 KiB");
  const { ct } = vc.aeadSeal(state.payloadKey, plaintext, "", nonceFor(state.noncePrefix, index, last));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(ct.length, 0);
  return Buffer.concat([len, ct]);
}

function encrypt(plaintext, recipientPublicRaw, { kind = "blob" } = {}) {
  const { header, state } = createStream(recipientPublicRaw, { kind });
  const count = Math.max(1, Math.ceil(plaintext.length / CHUNK_SIZE));
  const chunks = Array.from({ length: count }, (_, i) =>
    sealChunk(state, i, plaintext.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), i === count - 1)
  );
  return Buffer.concat([header, ...chunks]);
}

function parseHeader(buf) {
  if (!isEncrypted(buf)) throw new WwencError("NOT_ENCRYPTED", "Not a WhisperWoof encrypted file");
  if (buf.length < MAGIC.length + 4) throw new WwencError("TRUNCATED", "This file is incomplete");
  const jsonLen = buf.readUInt32BE(MAGIC.length);
  if (jsonLen === 0 || jsonLen > MAX_HEADER) throw tampered();
  const jsonEnd = MAGIC.length + 4 + jsonLen;
  if (buf.length < jsonEnd + MAC_LEN) throw new WwencError("TRUNCATED", "This file is incomplete");
  let header;
  try {
    header = JSON.parse(buf.subarray(MAGIC.length + 4, jsonEnd).toString("utf8"));
  } catch {
    throw tampered();
  }
  const ok =
    header &&
    header.v === FORMAT_VERSION &&
    KIND_RE.test(header.kind) &&
    typeof header.eph === "string" &&
    typeof header.wk === "string" &&
    typeof header.np === "string";
  if (!ok) throw tampered();
  const eph = Buffer.from(header.eph, "base64");
  const np = Buffer.from(header.np, "base64");
  if (eph.length !== 32 || np.length !== NONCE_PREFIX_LEN) throw tampered();
  return {
    kind: header.kind,
    eph,
    wk: Buffer.from(header.wk, "base64"),
    noncePrefix: np,
    headerBytes: buf.subarray(0, jsonEnd),
    mac: buf.subarray(jsonEnd, jsonEnd + MAC_LEN),
    bodyStart: jsonEnd + MAC_LEN,
  };
}

function openFileKey(h, privateKey) {
  let fileKey;
  try {
    const recipientRaw = vc.x25519RawPublic(privateKey);
    const shared = vc.x25519Shared(privateKey, vc.x25519PublicFromRaw(h.eph));
    fileKey = vc.aeadOpen(wrapKey(shared, h.eph, recipientRaw), { nonce: Buffer.alloc(vc.NONCE_LEN), ct: h.wk }, "WWENC1");
  } catch {
    throw new WwencError("CANNOT_DECRYPT", "This file can't be opened with this vault's key");
  }
  const expected = headerMac(fileKey, h.headerBytes);
  if (!crypto.timingSafeEqual(expected, h.mac)) {
    vc.wipe(fileKey);
    throw tampered();
  }
  return fileKey;
}

function tryOpen(payloadKey, noncePrefix, index, ct, last) {
  try {
    return vc.aeadOpen(payloadKey, { nonce: nonceFor(noncePrefix, index, last), ct }, "");
  } catch {
    return null;
  }
}

/**
 * Decrypt a whole file. `allowPartial` is for crash recovery: it returns the
 * complete, authenticated chunks of a file that never got its final chunk
 * (and drops a torn or half-written last chunk), with `complete: false`.
 */
function decrypt(buf, privateKey, { allowPartial = false } = {}) {
  const h = parseHeader(buf);
  const fileKey = openFileKey(h, privateKey);
  const payloadKey = payloadKeyFor(fileKey);
  vc.wipe(fileKey);

  const parts = [];
  let off = h.bodyStart;
  let index = 0;
  let complete = false;
  while (off < buf.length) {
    if (complete) throw tampered(); // data after the final chunk
    if (off + 4 > buf.length) break; // torn length prefix
    const len = buf.readUInt32BE(off);
    if (len < vc.TAG_LEN || len > MAX_CHUNK_CT) {
      if (allowPartial) break;
      throw tampered();
    }
    const end = off + 4 + len;
    if (end > buf.length) break; // torn chunk
    const ct = buf.subarray(off + 4, end);
    const middle = tryOpen(payloadKey, h.noncePrefix, index, ct, false);
    const final = middle ? null : tryOpen(payloadKey, h.noncePrefix, index, ct, true);
    if (!middle && !final) {
      if (allowPartial && end === buf.length) break; // garbage tail after a crash
      throw tampered();
    }
    parts.push(middle || final);
    complete = Boolean(final);
    off = end;
    index += 1;
  }
  vc.wipe(payloadKey);
  if (!complete && !allowPartial) throw new WwencError("TRUNCATED", "This file is incomplete");
  return { plaintext: vc.unpooledConcat(parts), complete, kind: h.kind };
}

/** Whether `privateKey` opens this file (header only — the body isn't decrypted). */
function opensWith(buf, privateKey) {
  try {
    vc.wipe(openFileKey(parseHeader(buf), privateKey));
    return true;
  } catch {
    return false;
  }
}

function readKind(buf) {
  return parseHeader(buf).kind;
}

/** Re-wrap a file's key to a new vault key. The body is left byte-for-byte. */
function rewrap(buf, oldPrivateKey, newPublicRaw) {
  const h = parseHeader(buf);
  const fileKey = openFileKey(h, oldPrivateKey);
  const header = buildHeader(fileKey, newPublicRaw, h.kind, h.noncePrefix);
  vc.wipe(fileKey);
  return Buffer.concat([header, buf.subarray(h.bodyStart)]);
}

module.exports = {
  MAGIC,
  CHUNK_SIZE,
  WwencError,
  isEncrypted,
  encrypt,
  decrypt,
  createStream,
  sealChunk,
  readKind,
  opensWith,
  rewrap,
};
