/**
 * Test helpers: Cardputer session folders as cpad lands them (contract v1),
 * and a fake SenseVoice. Used by the inbox flow tests only.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const SR = 16000;

export function tempRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ww-cardputer-")));
}

/** 16-bit PCM: a tone of the given amplitude, quiet in the given [from, to) seconds. */
export function tone(
  seconds: number,
  quiet: Array<[number, number]> = [],
  amplitude = 6000
): Buffer {
  const buf = Buffer.alloc(Math.round(seconds * SR) * 2);
  for (let i = 0; i < buf.length / 2; i++) {
    const t = i / SR;
    const q = quiet.some(([a, b]) => t >= a && t < b);
    buf.writeInt16LE(q ? 0 : Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / SR)), i * 2);
  }
  return buf;
}

export function wav(pcm: Buffer, { channels = 1 } = {}): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function monoId(n: number): string {
  const tail = Array.from({ length: 4 }, (_, k) => CROCKFORD[(n >> (5 * (3 - k))) & 31]).join("");
  return `K3M9Q2T-00042-${tail}`;
}

export type SegSpec = { i: number; seconds: number; t0_ms: number; pcm?: Buffer };

export type SessionSpec = {
  mode: "memo" | "meeting";
  segments: SegSpec[];
  gaps?: number[];
  marks?: Array<{ t_ms: number; k: string }>;
  leadMs?: number;
  first?: number; // MonoId counter of segment 0
  date?: string;
  dirName?: string;
  manifest?: (m: any) => any; // edit the manifest before it is written
};

/** Writes the segments and manifest.json (last, like cpad). → { dir, manifest, session } */
export function writeSession(root: string, spec: SessionSpec) {
  const first = spec.first ?? 0x0a1c;
  const session = monoId(first);
  const date = spec.date ?? "2026-10-21";
  const dir = path.join(root, date, spec.dirName ?? `1402-${session.toLowerCase()}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const segments = spec.segments.map((s) => {
    const pcm = s.pcm ?? tone(s.seconds);
    const file = `seg-${String(s.i).padStart(3, "0")}.wav`;
    const bytes = wav(pcm);
    fs.writeFileSync(path.join(dir, file), bytes, { mode: 0o600 });
    return {
      i: s.i,
      file,
      id: monoId(first + s.i),
      t0_ms: s.t0_ms,
      samples: pcm.length / 2,
      bytes: bytes.length,
      sha256: sha(bytes),
      recovered: false,
      repaired: false,
    };
  });
  const last = spec.segments[spec.segments.length - 1];
  const base = {
    v: 1,
    kind: "cardputer.recording",
    session,
    attempt: 1,
    mode: spec.mode,
    project: spec.mode === "meeting" ? { key: "cpa", name: "Cardputer 助手" } : null,
    ...(spec.mode === "meeting" ? { consent: "ack" } : {}),
    started: { wall_ms: 1792620120000, tz_min: 480, uncertain: false },
    duration_ms: last.t0_ms + Math.round(last.seconds * 1000),
    lead_ms: spec.leadMs ?? 200,
    audio: { sample_rate: 16000, channels: 1, bits: 16 },
    segments,
    gaps: spec.gaps ?? [],
    marks: spec.marks ?? [],
    device: { dev: "288485756024", fw: "cpa-fw/0.3.0" },
    written_at: "2026-10-21T14:45:10.120+08:00",
  };
  const manifest = spec.manifest ? spec.manifest(structuredClone(base)) : base;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return { dir, manifest, session };
}

/** A fake SenseVoice: one numbered sentence per piece, first token at 0.5 s. */
export function fakeSenseVoice() {
  let n = 0;
  const pieces: number[] = [];
  const transcribe = async (samples: Float32Array, sampleRate: number) => {
    n += 1;
    pieces.push(samples.length / sampleRate);
    return { text: `第${n}句。`, tokens: ["第", "。"], timestamps: [0.5, 0.9] };
  };
  return { transcribe, pieces };
}

export function readJson(dir: string, name: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
}

/** Names and mtimes of everything in a folder, to prove it wasn't touched. */
export function snapshot(dir: string): string {
  return fs
    .readdirSync(dir)
    .sort()
    .map(
      (f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}:${fs.statSync(path.join(dir, f)).size}`
    )
    .join("\n");
}
