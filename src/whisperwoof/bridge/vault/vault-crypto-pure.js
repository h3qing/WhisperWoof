/**
 * Vault crypto primitives — Node's crypto only (Electron's BoringSSL build).
 * No fs, no electron. Every other vault module builds on these.
 *
 * Available in Electron 39 (checked): AES-256-GCM, X25519, P-256, HKDF,
 * scrypt. Not available: crypto.argon2, chacha20-poly1305.
 */

const crypto = require("crypto");

const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;

// scrypt costs we accept from a vault file: the floor stops a tampered vault
// from downgrading the password KDF; the ceiling stops one from hanging the
// app (1 GiB of memory at most).
const MIN_SCRYPT_N = 1024;
const MAX_SCRYPT_N = 2 ** 20;
const MAX_SCRYPT_R = 16;
const MAX_SCRYPT_P = 16;

// DER prefixes for raw 32-byte X25519 keys (RFC 8410).
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

class VaultCryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = "VaultCryptoError";
  }
}

/**
 * Concatenate into freshly allocated memory. Buffer.concat takes small results
 * from Node's shared 8 KB pool, and a pooled Buffer's .buffer exposes the
 * whole slab — so anything holding a secret or plaintext must not live there.
 */
function unpooledConcat(parts) {
  const out = Buffer.alloc(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    part.copy(out, offset);
    offset += part.length;
  }
  return out;
}

function hkdf(ikm, info, length = KEY_LEN, salt = Buffer.alloc(0)) {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info, "utf8"), length));
}

/** AES-256-GCM. Returns `{ nonce, ct }` where ct carries the 16-byte tag. */
function aeadSeal(key, plaintext, aad = "", nonce = crypto.randomBytes(NONCE_LEN)) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce: Buffer.from(nonce), ct: Buffer.concat([body, cipher.getAuthTag()]) };
}

function aeadOpen(key, box, aad = "") {
  if (!box || !Buffer.isBuffer(box.ct) || box.ct.length < TAG_LEN) {
    throw new VaultCryptoError("Encrypted data is malformed");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, box.nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(box.ct.subarray(box.ct.length - TAG_LEN));
    return unpooledConcat([decipher.update(box.ct.subarray(0, box.ct.length - TAG_LEN)), decipher.final()]);
  } catch {
    throw new VaultCryptoError("Decryption failed");
  }
}

function boxToJson(box) {
  return { nonce: box.nonce.toString("base64"), ct: box.ct.toString("base64") };
}

function boxFromJson(json) {
  if (!json || typeof json.nonce !== "string" || typeof json.ct !== "string") {
    throw new VaultCryptoError("Encrypted data is malformed");
  }
  return { nonce: Buffer.from(json.nonce, "base64"), ct: Buffer.from(json.ct, "base64") };
}

function assertScryptParams(params) {
  const { N, r, p } = params || {};
  const powerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0;
  const inRange =
    powerOfTwo && N >= MIN_SCRYPT_N && N <= MAX_SCRYPT_N &&
    Number.isInteger(r) && r >= 8 && r <= MAX_SCRYPT_R &&
    Number.isInteger(p) && p >= 1 && p <= MAX_SCRYPT_P;
  if (!inRange) {
    throw new VaultCryptoError("Password settings in the vault are invalid");
  }
}

/** Password → 32-byte key. NFKC so the same password typed differently matches. */
function scryptKey(password, salt, params) {
  assertScryptParams(params);
  const { N, r, p } = params;
  return crypto.scryptSync(String(password).normalize("NFKC"), salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
}

function x25519PrivateFromSeed(seed) {
  return crypto.createPrivateKey({
    key: unpooledConcat([X25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

function x25519PublicFromRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 32) throw new VaultCryptoError("Public key is malformed");
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

/** Raw 32-byte public key from an X25519 private or public KeyObject. */
function x25519RawPublic(keyObject) {
  const pub = keyObject.type === "public" ? keyObject : crypto.createPublicKey(keyObject);
  const der = pub.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32));
}

/** A deterministic X25519 key pair from a 32-byte seed. */
function x25519FromSeed(seed) {
  const privateKey = x25519PrivateFromSeed(seed);
  return { privateKey, publicRaw: x25519RawPublic(privateKey) };
}

function x25519Generate() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("x25519");
  return { privateKey, publicRaw: x25519RawPublic(publicKey) };
}

function x25519Shared(privateKey, publicKey) {
  return crypto.diffieHellman({ privateKey, publicKey });
}

/** P-256 key pair; the public key as uncompressed X9.63 (04‖X‖Y), CryptoKit's format. */
function p256Generate() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const publicX963 = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return { privateKey, publicX963 };
}

function p256PublicFromX963(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 65 || raw[0] !== 4) {
    throw new VaultCryptoError("Touch ID key is malformed");
  }
  return crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: raw.subarray(1, 33).toString("base64url"),
      y: raw.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
}

/** ECDH x-coordinate — the same bytes CryptoKit's sharedSecretFromKeyAgreement returns. */
function p256Shared(privateKey, publicKey) {
  return crypto.diffieHellman({ privateKey, publicKey });
}

function hmac(key, label) {
  return crypto.createHmac("sha256", key).update(label, "utf8").digest();
}

function randomBytes(n) {
  return crypto.randomBytes(n);
}

/** Best-effort zeroing of key material (JS strings can't be wiped). */
function wipe(...buffers) {
  for (const b of buffers) {
    if (Buffer.isBuffer(b)) b.fill(0);
  }
}

module.exports = {
  KEY_LEN,
  NONCE_LEN,
  TAG_LEN,
  VaultCryptoError,
  unpooledConcat,
  hkdf,
  aeadSeal,
  aeadOpen,
  boxToJson,
  boxFromJson,
  scryptKey,
  assertScryptParams,
  x25519FromSeed,
  x25519Generate,
  x25519PublicFromRaw,
  x25519RawPublic,
  x25519Shared,
  p256Generate,
  p256PublicFromX963,
  p256Shared,
  hmac,
  randomBytes,
  wipe,
};
