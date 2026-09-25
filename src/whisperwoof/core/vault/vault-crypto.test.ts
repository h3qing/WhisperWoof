import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const vc = require("../../bridge/vault/vault-crypto-pure.js");

describe("aeadSeal / aeadOpen (AES-256-GCM)", () => {
  const key = crypto.randomBytes(32);

  it("round-trips with matching AAD", () => {
    const box = vc.aeadSeal(key, Buffer.from("hello"), "aad-1");
    expect(vc.aeadOpen(key, box, "aad-1").toString()).toBe("hello");
  });

  it("fails with the wrong key, the wrong AAD, or a flipped byte", () => {
    const box = vc.aeadSeal(key, Buffer.from("hello"), "aad-1");
    expect(() => vc.aeadOpen(crypto.randomBytes(32), box, "aad-1")).toThrow(vc.VaultCryptoError);
    expect(() => vc.aeadOpen(key, box, "aad-2")).toThrow(vc.VaultCryptoError);
    const tampered = { ...box, ct: Buffer.from(box.ct) };
    tampered.ct[0] ^= 1;
    expect(() => vc.aeadOpen(key, tampered, "aad-1")).toThrow(vc.VaultCryptoError);
  });

  it("uses a fresh nonce each time", () => {
    const a = vc.aeadSeal(key, Buffer.from("x"), "");
    const b = vc.aeadSeal(key, Buffer.from("x"), "");
    expect(a.nonce.equals(b.nonce)).toBe(false);
  });

  it("encodes to and from JSON-safe base64", () => {
    const box = vc.aeadSeal(key, Buffer.from("hello"), "a");
    const round = vc.boxFromJson(JSON.parse(JSON.stringify(vc.boxToJson(box))));
    expect(vc.aeadOpen(key, round, "a").toString()).toBe("hello");
  });
});

describe("hkdf", () => {
  it("gives different keys for different labels, the same key for the same label", () => {
    const ikm = crypto.randomBytes(32);
    expect(vc.hkdf(ikm, "a").equals(vc.hkdf(ikm, "a"))).toBe(true);
    expect(vc.hkdf(ikm, "a").equals(vc.hkdf(ikm, "b"))).toBe(false);
    expect(vc.hkdf(ikm, "a")).toHaveLength(32);
  });
});

describe("scryptKey", () => {
  const fast = { N: 1024, r: 8, p: 1 };

  it("is deterministic for the same password and salt", () => {
    const salt = crypto.randomBytes(16);
    expect(vc.scryptKey("correct horse", salt, fast).equals(vc.scryptKey("correct horse", salt, fast))).toBe(true);
  });

  it("treats Unicode-equivalent passwords the same (NFKC)", () => {
    const salt = crypto.randomBytes(16);
    const composed = "café";
    const decomposed = "café";
    expect(vc.scryptKey(composed, salt, fast).equals(vc.scryptKey(decomposed, salt, fast))).toBe(true);
  });

  it("rejects weak parameters", () => {
    expect(() => vc.scryptKey("pw", crypto.randomBytes(16), { N: 1000, r: 8, p: 1 })).toThrow();
  });
});

describe("X25519 from a seed", () => {
  it("derives the same key pair from the same seed", () => {
    const seed = crypto.randomBytes(32);
    const a = vc.x25519FromSeed(seed);
    const b = vc.x25519FromSeed(seed);
    expect(a.publicRaw.equals(b.publicRaw)).toBe(true);
    expect(a.publicRaw).toHaveLength(32);
  });

  it("agrees on a shared secret both ways", () => {
    const a = vc.x25519FromSeed(crypto.randomBytes(32));
    const b = vc.x25519FromSeed(crypto.randomBytes(32));
    const ab = vc.x25519Shared(a.privateKey, vc.x25519PublicFromRaw(b.publicRaw));
    const ba = vc.x25519Shared(b.privateKey, vc.x25519PublicFromRaw(a.publicRaw));
    expect(ab.equals(ba)).toBe(true);
  });
});

describe("P-256 (Touch ID wrap)", () => {
  it("exports and re-imports an uncompressed X9.63 public key", () => {
    const eph = vc.p256Generate();
    expect(eph.publicX963).toHaveLength(65);
    expect(eph.publicX963[0]).toBe(4);
    const other = vc.p256Generate();
    const s1 = vc.p256Shared(eph.privateKey, vc.p256PublicFromX963(other.publicX963));
    const s2 = vc.p256Shared(other.privateKey, vc.p256PublicFromX963(eph.publicX963));
    expect(s1.equals(s2)).toBe(true);
    expect(s1).toHaveLength(32);
  });
});

describe("wipe", () => {
  it("zeroes buffers and ignores anything else", () => {
    const b = Buffer.from([1, 2, 3]);
    vc.wipe(b, null, undefined);
    expect([...b]).toEqual([0, 0, 0]);
  });
});

describe("secrets never share Node's Buffer pool", () => {
  // A pooled Buffer's .buffer is a shared 8 KB slab: handing it to a renderer
  // (or anywhere) leaks whatever else sits in the slab — keys included.
  const ownsMemory = (b: Buffer) => b.byteOffset === 0 && b.buffer.byteLength === b.length;

  it("aeadOpen returns a Buffer with its own memory", () => {
    const key = crypto.randomBytes(32);
    const small = vc.aeadOpen(key, vc.aeadSeal(key, Buffer.from("tiny"), ""), "");
    expect(ownsMemory(small)).toBe(true);
  });

  it("unpooledConcat copies into fresh memory", () => {
    const out = vc.unpooledConcat([Buffer.from("ab"), Buffer.from("cd")]);
    expect(out.toString()).toBe("abcd");
    expect(ownsMemory(out)).toBe(true);
  });
});
