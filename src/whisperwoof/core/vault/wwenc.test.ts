import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ww = require("../../bridge/vault/wwenc-pure.js");
const vc = require("../../bridge/vault/vault-crypto-pure.js");

const pair = () => vc.x25519FromSeed(crypto.randomBytes(32));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return "no error";
};

/** Split a sealed file into { head, chunks[] } by walking the length prefixes. */
function split(buf: Buffer) {
  const headerLen = buf.readUInt32BE(6);
  let off = 6 + 4 + headerLen + 32;
  const head = buf.subarray(0, off);
  const chunks: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    chunks.push(buf.subarray(off, off + 4 + len));
    off += 4 + len;
  }
  return { head, chunks };
}

describe("encrypt / decrypt", () => {
  it("round-trips every size around the chunk boundary", () => {
    const k = pair();
    for (const size of [0, 1, 65535, 65536, 65537, 200000]) {
      const plain = crypto.randomBytes(size);
      const sealed = ww.encrypt(plain, k.publicRaw, { kind: "audio" });
      const out = ww.decrypt(sealed, k.privateKey);
      expect(out.plaintext.equals(plain)).toBe(true);
      expect(out.complete).toBe(true);
      expect(out.kind).toBe("audio");
    }
  });

  it("leaves no plaintext in the output", () => {
    const k = pair();
    const plain = Buffer.from("zebra-quartz-secret ".repeat(50));
    expect(ww.encrypt(plain, k.publicRaw).includes("zebra-quartz")).toBe(false);
  });

  it("gives each file its own key (same input, different bytes)", () => {
    const k = pair();
    const plain = Buffer.from("same");
    expect(ww.encrypt(plain, k.publicRaw).equals(ww.encrypt(plain, k.publicRaw))).toBe(false);
  });

  it("can't be opened with another vault's key", () => {
    const sealed = ww.encrypt(Buffer.from("hi"), pair().publicRaw);
    expect(code(() => ww.decrypt(sealed, pair().privateKey))).toBe("CANNOT_DECRYPT");
  });

  it("says when data isn't a sealed file", () => {
    expect(ww.isEncrypted(Buffer.from("SQLite format 3\0"))).toBe(false);
    expect(ww.isEncrypted(ww.encrypt(Buffer.from("x"), pair().publicRaw))).toBe(true);
    expect(code(() => ww.decrypt(Buffer.from("plain text"), pair().privateKey))).toBe("NOT_ENCRYPTED");
  });
});

describe("tamper detection", () => {
  const k = pair();
  const sealed = ww.encrypt(crypto.randomBytes(150000), k.publicRaw, { kind: "note" });

  it("catches a flipped byte anywhere", () => {
    const { head } = split(sealed);
    const spots = [8, 12, head.length - 5, head.length + 10, sealed.length - 3];
    for (const at of spots) {
      const bad = Buffer.from(sealed);
      bad[at] ^= 0x40;
      expect(["TAMPERED", "CANNOT_DECRYPT"]).toContain(code(() => ww.decrypt(bad, k.privateKey)));
    }
  });

  it("catches a changed kind in the header", () => {
    const text = sealed.toString("latin1").replace('"kind":"note"', '"kind":"blob"');
    expect(["TAMPERED", "CANNOT_DECRYPT"]).toContain(code(() => ww.decrypt(Buffer.from(text, "latin1"), k.privateKey)));
  });

  it("catches reordered chunks", () => {
    const { head, chunks } = split(sealed);
    const swapped = Buffer.concat([head, chunks[1], chunks[0], ...chunks.slice(2)]);
    expect(code(() => ww.decrypt(swapped, k.privateKey))).toBe("TAMPERED");
  });

  it("catches data after the final chunk", () => {
    const { chunks } = split(sealed);
    const extra = Buffer.concat([sealed, chunks[0]]);
    expect(code(() => ww.decrypt(extra, k.privateKey))).toBe("TAMPERED");
  });

  it("catches a header copied from another file", () => {
    const other = split(ww.encrypt(crypto.randomBytes(10), k.publicRaw, { kind: "note" }));
    const { chunks } = split(sealed);
    expect(code(() => ww.decrypt(Buffer.concat([other.head, ...chunks]), k.privateKey))).toBe("TAMPERED");
  });
});

describe("truncation and crash recovery", () => {
  const k = pair();
  const plain = crypto.randomBytes(3 * 65536 + 100);
  const sealed = ww.encrypt(plain, k.publicRaw);
  const { head, chunks } = split(sealed);

  it("refuses a file missing its final chunk", () => {
    const cut = Buffer.concat([head, ...chunks.slice(0, 2)]);
    expect(code(() => ww.decrypt(cut, k.privateKey))).toBe("TRUNCATED");
  });

  it("with allowPartial, returns the complete chunks and says it was interrupted", () => {
    const cut = Buffer.concat([head, ...chunks.slice(0, 2)]);
    const out = ww.decrypt(cut, k.privateKey, { allowPartial: true });
    expect(out.complete).toBe(false);
    expect(out.plaintext.equals(plain.subarray(0, 2 * 65536))).toBe(true);
  });

  it("with allowPartial, drops a torn half-written chunk", () => {
    const torn = Buffer.concat([head, chunks[0], chunks[1].subarray(0, 100)]);
    const out = ww.decrypt(torn, k.privateKey, { allowPartial: true });
    expect(out.complete).toBe(false);
    expect(out.plaintext.equals(plain.subarray(0, 65536))).toBe(true);
  });

  it("with allowPartial, still rejects a corrupted chunk in the middle", () => {
    const bad = Buffer.from(Buffer.concat([head, ...chunks.slice(0, 3)]));
    bad[head.length + 50] ^= 1;
    expect(code(() => ww.decrypt(bad, k.privateKey, { allowPartial: true }))).toBe("TAMPERED");
  });
});

describe("streaming writer (meeting recorder)", () => {
  it("writes short chunks as they arrive and decrypts to the whole", () => {
    const k = pair();
    const stream = ww.createStream(k.publicRaw, { kind: "meeting-pcm" });
    const parts = [crypto.randomBytes(48000), crypto.randomBytes(12), crypto.randomBytes(65536)];
    const body = parts.map((p, i) => ww.sealChunk(stream.state, i, p, i === parts.length - 1));
    const out = ww.decrypt(Buffer.concat([stream.header, ...body]), k.privateKey);
    expect(out.plaintext.equals(Buffer.concat(parts))).toBe(true);
    expect(out.kind).toBe("meeting-pcm");
  });

  it("recovers everything written before a crash (no final chunk)", () => {
    const k = pair();
    const stream = ww.createStream(k.publicRaw, { kind: "meeting-pcm" });
    const parts = [crypto.randomBytes(1000), crypto.randomBytes(2000)];
    const body = parts.map((p, i) => ww.sealChunk(stream.state, i, p, false));
    const out = ww.decrypt(Buffer.concat([stream.header, ...body]), k.privateKey, { allowPartial: true });
    expect(out.complete).toBe(false);
    expect(out.plaintext.equals(Buffer.concat(parts))).toBe(true);
  });

  it("refuses a chunk larger than 64 KiB", () => {
    const stream = ww.createStream(pair().publicRaw);
    expect(() => ww.sealChunk(stream.state, 0, Buffer.alloc(65537), true)).toThrow();
  });
});

describe("opensWith", () => {
  it("tells whether a key opens a file without decrypting its body", () => {
    const a = pair();
    const b = pair();
    const sealed = ww.encrypt(crypto.randomBytes(1000), a.publicRaw);
    expect(ww.opensWith(sealed, a.privateKey)).toBe(true);
    expect(ww.opensWith(sealed, b.privateKey)).toBe(false);
    expect(ww.opensWith(Buffer.from("plain"), a.privateKey)).toBe(false);
  });
});

describe("rewrap (new recovery phrase)", () => {
  it("moves a file to a new key without touching its body", () => {
    const oldK = pair();
    const newK = pair();
    const plain = crypto.randomBytes(70000);
    const sealed = ww.encrypt(plain, oldK.publicRaw, { kind: "audio" });
    const moved = ww.rewrap(sealed, oldK.privateKey, newK.publicRaw);
    expect(ww.decrypt(moved, newK.privateKey).plaintext.equals(plain)).toBe(true);
    expect(code(() => ww.decrypt(moved, oldK.privateKey))).toBe("CANNOT_DECRYPT");
    const body = (b: Buffer) => Buffer.concat(split(b).chunks);
    expect(body(moved).equals(body(sealed))).toBe(true);
  });
});
