/**
 * The vault file (userData/vault/vault.json) and the key hierarchy.
 *
 *   12-word phrase entropy ──HKDF──► master key (MK)
 *   MK is wrapped (AES-256-GCM) by: password (scrypt) · Touch ID (Secure
 *   Enclave ECDH) — the phrase recomputes MK directly.
 *   MK ──HKDF──► SQLCipher key · X25519 sealing key pair (files, inbox)
 *
 * Pure: no fs, no electron. Every function returns new objects.
 */

const crypto = require("crypto");
const vc = require("./vault-crypto-pure");

const VAULT_VERSION = 1;
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_KDF = Object.freeze({ name: "scrypt", N: 262144, r: 8, p: 1 }); // 256 MiB
const IDLE_CHOICES = Object.freeze([0, 15, 60]);
const DEFAULT_PREFS = Object.freeze({ touchId: false, lockOnSleep: true, idleMinutes: 0, notesReadable: false });

const MASTER_SALT = Buffer.from("WhisperWoof vault", "utf8");

class WrongPasswordError extends Error {
  constructor() {
    super("That password isn't right.");
    this.name = "WrongPasswordError";
    this.code = "WRONG_PASSWORD";
  }
}

class WrongPhraseError extends Error {
  constructor() {
    super("That recovery phrase doesn't belong to this vault.");
    this.name = "WrongPhraseError";
    this.code = "WRONG_PHRASE";
  }
}

const aad = (method, vaultId) => `whisperwoof-vault/v${VAULT_VERSION}/${method}/${vaultId}`;
const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (s) => Buffer.from(String(s), "base64");

function checkValue(masterKey) {
  return b64(vc.hmac(masterKey, "whisperwoof/check/v1").subarray(0, 16));
}

function deriveKeys(masterKey) {
  const seal = vc.x25519FromSeed(vc.hkdf(masterKey, "whisperwoof/seal/v1"));
  return {
    dbKeyHex: vc.hkdf(masterKey, "whisperwoof/db/v1").toString("hex"),
    sealPrivateKey: seal.privateKey,
    sealPublicRaw: seal.publicRaw,
  };
}

function assertPassword(password) {
  if (typeof password !== "string" || [...password].length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  }
}

function verifyMasterKey(vault, masterKey) {
  const expected = unb64(vault.check);
  const actual = unb64(checkValue(masterKey));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function assertMasterKey(vault, masterKey) {
  if (!Buffer.isBuffer(masterKey) || !verifyMasterKey(vault, masterKey)) {
    throw new Error("Master key doesn't belong to this vault");
  }
}

function passwordWrap(vaultId, masterKey, password, kdf) {
  assertPassword(password);
  const salt = vc.randomBytes(16);
  const kek = vc.scryptKey(password, salt, kdf);
  const box = vc.aeadSeal(kek, masterKey, aad("password", vaultId));
  vc.wipe(kek);
  return { kdf: { name: "scrypt", N: kdf.N, r: kdf.r, p: kdf.p }, salt: b64(salt), box: vc.boxToJson(box) };
}

function masterKeyFromEntropy(entropy, vault = null) {
  const masterKey = vc.hkdf(entropy, "whisperwoof/master/v1", 32, MASTER_SALT);
  if (vault && !verifyMasterKey(vault, masterKey)) {
    vc.wipe(masterKey);
    throw new WrongPhraseError();
  }
  return masterKey;
}

function createVault({ entropy, password, kdf = DEFAULT_KDF, now = new Date() }) {
  assertPassword(password);
  const masterKey = masterKeyFromEntropy(entropy);
  const vaultId = vc.randomBytes(16).toString("hex");
  const vault = {
    version: VAULT_VERSION,
    vaultId,
    createdAt: now.toISOString(),
    check: checkValue(masterKey),
    sealPublicKey: b64(deriveKeys(masterKey).sealPublicRaw),
    password: passwordWrap(vaultId, masterKey, password, kdf),
    touchId: null,
    prefs: { ...DEFAULT_PREFS },
  };
  return { vault, masterKey };
}

function unlockWithPassword(vault, password) {
  const { kdf, salt, box } = vault.password;
  const kek = vc.scryptKey(password, unb64(salt), kdf);
  try {
    const masterKey = vc.aeadOpen(kek, vc.boxFromJson(box), aad("password", vault.vaultId));
    if (!verifyMasterKey(vault, masterKey)) throw new WrongPasswordError();
    return masterKey;
  } catch (err) {
    if (err instanceof WrongPasswordError) throw err;
    throw new WrongPasswordError();
  } finally {
    vc.wipe(kek);
  }
}

function setPassword(vault, masterKey, newPassword, kdf = DEFAULT_KDF) {
  assertMasterKey(vault, masterKey);
  return { ...vault, password: passwordWrap(vault.vaultId, masterKey, newPassword, kdf) };
}

function touchIdKek(shared, peerX963, sePublicX963) {
  return vc.hkdf(shared, "whisperwoof/touchid/v1", 32, Buffer.concat([peerX963, sePublicX963]));
}

/** Wrap MK to a Secure Enclave public key. Needs no Touch ID — only the public half. */
function setTouchIdWrap(vault, masterKey, { publicKey, keyBlob }) {
  assertMasterKey(vault, masterKey);
  const sePublic = vc.p256PublicFromX963(publicKey);
  const eph = vc.p256Generate();
  const kek = touchIdKek(vc.p256Shared(eph.privateKey, sePublic), eph.publicX963, publicKey);
  const box = vc.aeadSeal(kek, masterKey, aad("touchid", vault.vaultId));
  vc.wipe(kek);
  return {
    ...vault,
    touchId: { sePublicKey: b64(publicKey), keyBlob: b64(keyBlob), peer: b64(eph.publicX963), box: vc.boxToJson(box) },
    prefs: { ...vault.prefs, touchId: true },
  };
}

function touchIdPeerPublic(vault) {
  if (!vault.touchId) throw new Error("Touch ID isn't set up");
  return unb64(vault.touchId.peer);
}

function touchIdKeyBlob(vault) {
  if (!vault.touchId) throw new Error("Touch ID isn't set up");
  return unb64(vault.touchId.keyBlob);
}

/** `shared` is what the Secure Enclave returns after a successful Touch ID. */
function unlockWithTouchIdSecret(vault, shared) {
  const { sePublicKey, peer, box } = vault.touchId || {};
  if (!box) throw new Error("Touch ID isn't set up");
  const kek = touchIdKek(shared, unb64(peer), unb64(sePublicKey));
  try {
    const masterKey = vc.aeadOpen(kek, vc.boxFromJson(box), aad("touchid", vault.vaultId));
    assertMasterKey(vault, masterKey);
    return masterKey;
  } finally {
    vc.wipe(kek);
  }
}

function clearTouchId(vault) {
  return { ...vault, touchId: null, prefs: { ...vault.prefs, touchId: false } };
}

function sealPublicKey(vault) {
  return unb64(vault.sealPublicKey);
}

/** Recompute the sealing public key from MK — catches a swapped key in vault.json. */
function verifySealKey(vault, masterKey) {
  return deriveKeys(masterKey).sealPublicRaw.equals(sealPublicKey(vault));
}

function normalizePrefs(prefs, current = DEFAULT_PREFS) {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  return {
    touchId: current.touchId,
    lockOnSleep: typeof p.lockOnSleep === "boolean" ? p.lockOnSleep : current.lockOnSleep,
    idleMinutes: IDLE_CHOICES.includes(p.idleMinutes) ? p.idleMinutes : 0,
    notesReadable: typeof p.notesReadable === "boolean" ? p.notesReadable : current.notesReadable,
  };
}

function updatePrefs(vault, updates) {
  const merged = { ...vault.prefs, ...(updates || {}) };
  return { ...vault, prefs: normalizePrefs(merged, vault.prefs) };
}

function requireString(value, what) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Vault file is damaged (${what})`);
  return value;
}

function parseBox(box, what) {
  requireString(box && box.nonce, `${what} nonce`);
  requireString(box && box.ct, `${what} data`);
  return { nonce: box.nonce, ct: box.ct };
}

/** Validate a vault.json object. Throws on anything unexpected (fail closed). */
function parseVault(json) {
  if (!json || json.version !== VAULT_VERSION) throw new Error("Vault file is from an unknown version");
  if (!/^[0-9a-f]{32}$/.test(json.vaultId || "")) throw new Error("Vault file is damaged (id)");
  if (unb64(requireString(json.sealPublicKey, "public key")).length !== 32) {
    throw new Error("Vault file is damaged (public key)");
  }
  const pw = json.password || {};
  vc.assertScryptParams(pw.kdf);
  const tid = json.touchId;
  return {
    version: VAULT_VERSION,
    vaultId: json.vaultId,
    createdAt: requireString(json.createdAt, "date"),
    check: requireString(json.check, "check"),
    sealPublicKey: json.sealPublicKey,
    password: {
      kdf: { name: "scrypt", N: pw.kdf.N, r: pw.kdf.r, p: pw.kdf.p },
      salt: requireString(pw.salt, "salt"),
      box: parseBox(pw.box, "password"),
    },
    touchId: tid
      ? {
          sePublicKey: requireString(tid.sePublicKey, "Touch ID key"),
          keyBlob: requireString(tid.keyBlob, "Touch ID blob"),
          peer: requireString(tid.peer, "Touch ID peer"),
          box: parseBox(tid.box, "Touch ID"),
        }
      : null,
    prefs: { ...normalizePrefs(json.prefs), touchId: Boolean(tid) && json.prefs?.touchId !== false },
  };
}

module.exports = {
  VAULT_VERSION,
  MIN_PASSWORD_LENGTH,
  DEFAULT_KDF,
  IDLE_CHOICES,
  DEFAULT_PREFS,
  WrongPasswordError,
  WrongPhraseError,
  createVault,
  masterKeyFromEntropy,
  unlockWithPassword,
  setPassword,
  setTouchIdWrap,
  touchIdPeerPublic,
  touchIdKeyBlob,
  unlockWithTouchIdSecret,
  clearTouchId,
  deriveKeys,
  sealPublicKey,
  verifySealKey,
  verifyMasterKey,
  updatePrefs,
  parseVault,
};
