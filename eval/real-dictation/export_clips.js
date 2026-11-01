#!/usr/bin/env node
/**
 * Copy recent real dictations out of the encrypted app data for benchmarking.
 *
 * Opens the vault with Touch ID (the user touches the sensor; no password is
 * read or typed), reads the transcriptions table and the sealed audio, and
 * writes 16 kHz mono WAVs (the app's own convertToWav format) plus a manifest
 * to a private folder OUTSIDE the repo. Nothing is written to the app's data.
 *
 *   node eval/real-dictation/export_clips.js --out ~/.whisperwoof-bench/dictation-real-1 \
 *     --limit 200 --sqlite <path to better-sqlite3-multiple-ciphers>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), [])
);
const USER_DATA = args["user-data"] || path.join(os.homedir(), "Library", "Application Support", "whisperwoof");
const OUT = path.resolve((args.out || "").replace(/^~/, os.homedir()));
const LIMIT = Number(args.limit || 200);
const MIN_MS = Number(args["min-ms"] || 1500);
const MAX_MS = Number(args["max-ms"] || 60000);
const APP_RESOURCES = args.resources || "/Applications/WhisperWoof.app/Contents/Resources";

if (!args.out) throw new Error("--out is required");
// The app's own Touch ID helper (the one that made the Secure Enclave key).
const HELPER = path.join(APP_RESOURCES, "resources", "bin", "WhisperWoof.app", "Contents", "MacOS", "WhisperWoof");

const VAULT = path.join(__dirname, "..", "..", "src", "whisperwoof", "bridge", "vault");
const vk = require(path.join(VAULT, "vault-keys-pure.js"));
const ww = require(path.join(VAULT, "wwenc-pure.js"));
const vc = require(path.join(VAULT, "vault-crypto-pure.js"));
const { applyKey } = require(path.join(VAULT, "vault-db.js"));
const Database = require(args.sqlite || "better-sqlite3-multiple-ciphers");

/** Same exchange as vault-touchid.js deriveSecret, but waits as long as it takes for the touch. */
function touchIdSecret(vault) {
  return new Promise((resolve, reject) => {
    const child = spawn(HELPER, ["unlock"], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      let result = {};
      try {
        result = JSON.parse(out.trim().split("\n").pop() || "{}");
      } catch {}
      if (!result.shared) return reject(Object.assign(new Error(result.message || "Touch ID didn't answer"), { code: result.error }));
      resolve(Buffer.from(result.shared, "base64"));
    });
    child.stdin.end(JSON.stringify({ keyBlob: vault.touchId.keyBlob, peer: vault.touchId.peer, purpose: "unlock" }));
  });
}

async function openKeys() {
  const vault = JSON.parse(fs.readFileSync(path.join(USER_DATA, "vault", "vault.json"), "utf8"));
  console.log("Waiting for Touch ID…");
  const shared = await touchIdSecret(vault);
  try {
    const masterKey = vk.unlockWithTouchIdSecret(vault, shared);
    try {
      return vk.deriveKeys(masterKey);
    } finally {
      vc.wipe(masterKey);
    }
  } finally {
    shared.fill(0);
  }
}

function readRows(keys) {
  const db = new Database(path.join(USER_DATA, "transcriptions.db"), { readonly: true });
  try {
    applyKey(db, keys.dbKeyHex);
    return db
      .prepare(
        `SELECT id, timestamp, text, raw_text, provider, model, audio_duration_ms
           FROM transcriptions
          WHERE has_audio = 1 AND status = 'completed'
            AND audio_duration_ms BETWEEN ? AND ?
          ORDER BY id DESC`
      )
      .all(MIN_MS, MAX_MS);
  } finally {
    db.close();
  }
}

function audioFileFor(id, files) {
  return files.find((f) => f.endsWith(`-${id}.webm.wwenc`) || f === `${id}.webm.wwenc`) || null;
}

function exportClip(row, sealedPath, keys) {
  const webm = path.join(OUT, `.tmp-${row.id}.webm`);
  const wav = path.join(OUT, "audio", `${row.id}.wav`);
  const { plaintext: plain } = ww.decrypt(fs.readFileSync(sealedPath), keys.sealPrivateKey);
  try {
    fs.writeFileSync(webm, plain, { mode: 0o600 });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    fs.chmodSync(wav, 0o600);
  } finally {
    plain.fill(0);
    fs.rmSync(webm, { force: true });
  }
  return `audio/${row.id}.wav`;
}

async function main() {
  fs.mkdirSync(path.join(OUT, "audio"), { recursive: true, mode: 0o700 });
  fs.chmodSync(OUT, 0o700);
  const keys = await openKeys();
  const audioDir = path.join(USER_DATA, "audio");
  const files = fs.readdirSync(audioDir);
  const rows = readRows(keys).filter((row) => (row.raw_text || row.text || "").trim());
  const clips = [];
  for (const row of rows) {
    if (clips.length >= LIMIT) break;
    const sealed = audioFileFor(row.id, files);
    if (!sealed) continue;
    try {
      const file = exportClip(row, path.join(audioDir, sealed), keys);
      clips.push({
        id: row.id,
        timestamp: row.timestamp,
        durationMs: row.audio_duration_ms,
        file,
        appRaw: row.raw_text || "",
        appText: row.text || "",
        provider: row.provider || "",
        model: row.model || "",
      });
    } catch (err) {
      console.error(`skip ${row.id}: ${err.message}`);
    }
  }
  keys.sealPrivateKey.fill?.(0);
  const manifest = { exportedAt: new Date().toISOString(), source: "whisperwoof transcriptions (has_audio)", clips };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const totalS = clips.reduce((sum, c) => sum + c.durationMs, 0) / 1000;
  console.log(`exported ${clips.length} clips (${(totalS / 60).toFixed(1)} min) of ${rows.length} candidates → ${OUT}`);
}

main().catch((err) => {
  console.error(err.code || "", err.message);
  process.exit(1);
});
