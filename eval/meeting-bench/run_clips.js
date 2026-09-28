#!/usr/bin/env node
/**
 * Meeting clip bench: how well local models transcribe a long recording when
 * it is cut into ~2 minute clips (the unit of async meeting transcription),
 * and where to cut.
 *
 *   node eval/meeting-bench/run_clips.js --bench bench-a --out /tmp/out \
 *     --bin-dir <dir> [--bench-models <dir>] [--engines x-asr-480,...] \
 *     [--plans lull-120,...] [--record]
 *
 * --bench <id> reads benches.json and finds the private audio/reference under
 * $WHISPERWOOF_BENCH_DATA (default ~/.whisperwoof-bench)/<id>/, checking the
 * audio against its recorded sha256. --audio/--ref point at files directly.
 * --record appends each run to results/history.jsonl and rewrites RESULTS.md.
 *
 * --ref is a transcript whose lines alternate "<speaker> HH:MM:SS" and text
 * (the export format of common meeting transcribers). --bin-dir holds renamed
 * copies of the app's whisper-server and sherpa-onnx online server with their
 * dylibs: a running WhisperWoof reaps processes named whisper-server* and
 * sherpa-onnx-*. Models come from ~/.cache/openwhispr like the app's.
 *
 * Writes <out>/results.json (numbers) and <out>/<engine>.<plan>.txt
 * (hypotheses). Keep --out outside the repo for private recordings.
 */
const { spawn, execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const { analyzeFrames } = require("../../src/whisperwoof/bridge/vad");
const { createOnlineAccumulator, joinTranscriptSegments } = require("../../src/helpers/parakeetWsResult");

const SR = 16000;
const MODELS = path.join(os.homedir(), ".cache", "openwhispr");

// ---------- args ----------
// "--key value", or a bare "--flag" (followed by another --key or nothing) = true
const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    const bare = next === undefined || next.startsWith("--");
    args[argv[i].slice(2)] = bare ? true : next;
    if (!bare) i++;
  }
}
const THREADS = Number(args.threads || 4);
const ENGINES = (args.engines || "whisper-turbo,x-asr-480").split(",");
const PLANS = (args.plans || "whole,fixed-120,pause-120").split(",");

// ---------- audio ----------
function decode16k(file) {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 }
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function wav16(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---------- clip plans ----------
/**
 * Cut points for a recording.
 *   fixed-<s>  every <s> seconds
 *   pause-<s>  middle of the first pause (>= minPauseMs below the app's fixed
 *              VAD threshold) after <s> seconds; quietest frame before the cap
 *              if no pause comes
 *   lull-<s>   middle of the quietest minPauseMs span in the lullWindowS after
 *              <s> seconds: no threshold, so no dependence on the noise floor
 * A cut that would leave under 5 s at the end is dropped.
 */
function quietestSpanStart(frames, spanFrames) {
  let best = 0;
  let bestSum = Infinity;
  let sum = 0;
  for (let i = 0; i < frames.length; i++) {
    sum += frames[i].rms;
    if (i >= spanFrames) sum -= frames[i - spanFrames].rms;
    if (i >= spanFrames - 1 && sum < bestSum) {
      bestSum = sum;
      best = i - spanFrames + 1;
    }
  }
  return best;
}

function planClips(samples, plan, { capExtraS = 30, lullWindowS = 20, minPauseMs = 400 } = {}) {
  const n = samples.length;
  if (plan === "whole") return { clips: [[0, n]], pauseCuts: 0, forcedCuts: 0 };
  const [kind, secs] = plan.split("-");
  const target = Number(secs) * SR;
  const clips = [];
  let pauseCuts = 0;
  let forcedCuts = 0;
  let start = 0;
  while (start < n) {
    let end = start + target;
    if (end >= n - SR * 5) {
      clips.push([start, n]);
      break;
    }
    if (kind === "lull") {
      const frames = analyzeFrames(samples.subarray(end, Math.min(n, end + lullWindowS * SR)), SR);
      const span = Math.ceil(minPauseMs / 30);
      const first = quietestSpanStart(frames, span);
      end += frames[Math.min(frames.length - 1, first + Math.floor(span / 2))].startSample;
      pauseCuts += 1;
    } else if (kind === "pause") {
      const winEnd = Math.min(n, end + capExtraS * SR);
      const frames = analyzeFrames(samples.subarray(end, winEnd), SR);
      const need = Math.ceil(minPauseMs / 30);
      let run = 0;
      let cut = -1;
      for (let i = 0; i < frames.length; i++) {
        run = frames[i].isSpeech ? 0 : run + 1;
        if (run >= need) {
          cut = frames[i - Math.floor(need / 2)].startSample;
          break;
        }
      }
      if (cut >= 0) {
        pauseCuts += 1;
      } else {
        forcedCuts += 1;
        cut = frames.reduce((q, f) => (f.rms < q.rms ? f : q), frames[0]).startSample;
      }
      end = end + cut;
    }
    if (end >= n - SR * 5) {
      clips.push([start, n]);
      break;
    }
    clips.push([start, end]);
    start = end;
  }
  return { clips, pauseCuts, forcedCuts };
}

// ---------- scoring (same tokenizer as eval/dictation-bench/run_asr.py) ----------
const CJK = /[一-鿿㐀-䶿]/;
function tokenize(text) {
  const s = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}_一-鿿\s]/gu, " ");
  const out = [];
  for (const chunk of s.split(/\s+/).filter(Boolean)) {
    let buf = "";
    for (const ch of chunk) {
      if (CJK.test(ch)) {
        if (buf) out.push(buf);
        buf = "";
        out.push(ch);
      } else buf += ch;
    }
    if (buf) out.push(buf);
  }
  return out;
}

function editDistance(a, b) {
  let prev = new Uint32Array(b.length + 1).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint32Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const mer = (ref, hyp) => {
  const r = tokenize(ref);
  return { mer: editDistance(r, tokenize(hyp)) / r.length, refTokens: r.length };
};

function parseReference(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const utts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\S+)\s+(\d\d):(\d\d):(\d\d)$/);
    if (m && i + 1 < lines.length) {
      utts.push({ speaker: m[1], start: +m[2] * 3600 + +m[3] * 60 + +m[4], text: lines[++i] });
    }
  }
  return utts;
}

// ---------- engines ----------
function waitFor(test, timeoutMs, label) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await test()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error(`${label} not ready`));
      setTimeout(tick, 200);
    };
    tick();
  });
}

function httpPost(port, pathName, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathName, method: "POST", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function startWhisper(binDir) {
  const port = 8321;
  const proc = spawn(
    path.join(binDir, "bench-wcpp-srv"),
    ["--model", path.join(MODELS, "whisper-models", "ggml-large-v3-turbo.bin"), "--host", "127.0.0.1",
      "--port", String(port), "--language", "auto", "--no-language-probabilities"],
    { cwd: binDir, stdio: ["ignore", "ignore", "pipe"] }
  );
  proc.stderr.on("data", () => {});
  await waitFor(
    () => new Promise((ok) => http.get({ host: "127.0.0.1", port, path: "/" }, (r) => { r.resume(); ok(true); }).on("error", () => ok(false))),
    120000,
    "whisper-server"
  );
  const transcribe = async (samples) => {
    const boundary = `----bench${Date.now()}`;
    const part = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      wav16(samples),
      Buffer.from(`\r\n${part("language", "auto")}${part("response_format", "verbose_json")}--${boundary}--\r\n`),
    ]);
    const res = JSON.parse(await httpPost(port, "/inference", body, { "Content-Type": `multipart/form-data; boundary=${boundary}` }));
    return (res.text || "").replace(/\s*\n\s*/g, " ").trim();
  };
  return { transcribe, stop: () => proc.kill() };
}

async function startXasr(binDir, model) {
  const port = 6231;
  const dir = path.join(MODELS, "parakeet-models", model);
  const proc = spawn(
    path.join(binDir, "bench-sherpa-online"),
    [`--tokens=${dir}/tokens.txt`, `--encoder=${dir}/encoder.int8.onnx`, `--decoder=${dir}/decoder.onnx`,
      `--joiner=${dir}/joiner.int8.onnx`, `--port=${port}`, `--num-threads=${THREADS}`, "--num-work-threads=2",
      "--loop-interval-ms=2", "--end-tail-padding=1.0", "--warm-up=0"],
    { cwd: binDir, stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  await waitFor(() => stderr.includes("Listening on:"), 60000, model);
  const transcribe = (samples) =>
    new Promise((resolve, reject) => {
      const acc = createOnlineAccumulator();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("open", () => {
        for (let i = 0; i < samples.length; i += 8000) {
          const chunk = samples.slice(i, i + 8000);
          ws.send(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        }
        ws.send("Done");
      });
      ws.on("message", (data) => {
        const msg = data.toString();
        if (msg === "Done!") ws.close();
        else acc.push(msg);
      });
      ws.on("close", () => resolve(acc.text()));
      ws.on("error", reject);
    });
  return { transcribe, stop: () => proc.kill() };
}

/**
 * Offline models (SenseVoice) decode short stretches: split a clip into
 * pieces of at most maxS seconds, each ending at the quietest minPauseMs span
 * between minS and maxS.
 */
function splitAtLulls(samples, { minS = 12, maxS = 20, minPauseMs = 300 } = {}) {
  const pieces = [];
  let start = 0;
  while (samples.length - start > maxS * SR) {
    const frames = analyzeFrames(samples.subarray(start + minS * SR, start + maxS * SR), SR);
    const span = Math.ceil(minPauseMs / 30);
    const cut = start + minS * SR + frames[quietestSpanStart(frames, span) + Math.floor(span / 2)].startSample;
    pieces.push([start, cut]);
    start = cut;
  }
  pieces.push([start, samples.length]);
  return pieces;
}

/**
 * Offline sherpa-onnx models, as server flags built from the files in their
 * model directory (k2-fsa release layout). All are fed the same <=20 s
 * pieces cut at lulls, so they are compared like for like.
 */
function findFile(dir, pattern) {
  const hit = fs.readdirSync(dir).find((f) => pattern.test(f));
  if (!hit) throw new Error(`no ${pattern} in ${dir}`);
  return path.join(dir, hit);
}

const HOTWORDS = () => (args.hotwords ? fs.readFileSync(args.hotwords, "utf8").split(/\r?\n/).map((w) => w.trim()).filter(Boolean).join(",") : "");

const OFFLINE_SPECS = {
  "sense-voice": (d) => [`--tokens=${d}/tokens.txt`, `--sense-voice-model=${findFile(d, /^model.*\.onnx$/)}`,
    "--sense-voice-language=auto", "--sense-voice-use-itn=true"],
  "xasr-offline": (d) => [`--tokens=${d}/tokens.txt`, `--encoder=${findFile(d, /^encoder.*\.onnx$/)}`,
    `--decoder=${findFile(d, /^decoder.*\.onnx$/)}`, `--joiner=${findFile(d, /^joiner.*\.onnx$/)}`],
  dolphin: (d) => [`--tokens=${d}/tokens.txt`, `--dolphin-model=${findFile(d, /^model.*\.onnx$/)}`],
  paraformer: (d) => [`--tokens=${d}/tokens.txt`, `--paraformer=${findFile(d, /^model.*\.onnx$/)}`],
  "firered-ctc": (d) => [`--tokens=${d}/tokens.txt`, `--fire-red-asr-ctc=${findFile(d, /^model.*\.onnx$/)}`],
  "firered-aed": (d) => [`--tokens=${d}/tokens.txt`, `--fire-red-asr-encoder=${findFile(d, /^encoder.*\.onnx$/)}`,
    `--fire-red-asr-decoder=${findFile(d, /^decoder.*\.onnx$/)}`],
  "funasr-nano": (d) => [`--funasr-nano-encoder-adaptor=${findFile(d, /^encoder_adaptor.*\.onnx$/)}`,
    `--funasr-nano-llm=${findFile(d, /^llm.*\.onnx$/)}`, `--funasr-nano-embedding=${findFile(d, /^embedding.*\.onnx$/)}`,
    `--funasr-nano-tokenizer=${findFile(d, /^Qwen|tokenizer/)}`, `--funasr-nano-hotwords=${HOTWORDS()}`],
  "qwen3-asr": (d) => [`--qwen3-asr-conv-frontend=${findFile(d, /^conv_frontend.*\.onnx$/)}`,
    `--qwen3-asr-encoder=${findFile(d, /^encoder.*\.onnx$/)}`, `--qwen3-asr-decoder=${findFile(d, /^decoder.*\.onnx$/)}`,
    `--qwen3-asr-tokenizer=${findFile(d, /^Qwen|tokenizer/)}`, "--qwen3-asr-max-new-tokens=512",
    "--qwen3-asr-max-total-len=1024", `--qwen3-asr-hotwords=${HOTWORDS()}`],
};

// engine name -> [spec, model dir]
function offlineEngine(engine) {
  if (engine === "sense-voice") return ["sense-voice", path.join(MODELS, "parakeet-models", "sense-voice-zh-en")];
  const [spec, dirName] = engine.split("@");
  if (!OFFLINE_SPECS[spec] || !dirName) return null;
  return [spec, path.join(args["bench-models"], dirName)];
}

async function startOffline(binDir, spec, dir) {
  const port = 6233;
  const proc = spawn(
    path.join(binDir, "bench-sherpa-offline"),
    [...OFFLINE_SPECS[spec](dir), `--port=${port}`, `--num-threads=${THREADS}`],
    { cwd: binDir, stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  proc.on("exit", (code) => code && console.error(`${spec} exited ${code}: ${stderr.slice(-400)}`));
  await waitFor(() => stderr.includes("Listening on:"), 300000, spec);
  const decode = (piece) =>
    new Promise((resolve, reject) => {
      let result = "";
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("open", () => {
        const body = Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength);
        const msg = Buffer.alloc(8 + body.length);
        msg.writeInt32LE(SR, 0);
        msg.writeInt32LE(body.length, 4);
        body.copy(msg, 8);
        ws.send(msg);
      });
      ws.on("message", (data) => {
        result += data.toString();
        ws.send("Done");
      });
      ws.on("close", () => {
        try {
          resolve(JSON.parse(result).text || "");
        } catch {
          resolve(result);
        }
      });
      ws.on("error", reject);
    });
  const transcribe = async (samples) => {
    const texts = [];
    for (const [s, e] of splitAtLulls(samples)) texts.push(await decode(samples.slice(s, e)));
    return joinTranscriptSegments(texts);
  };
  return { transcribe, stop: () => proc.kill() };
}

const startSenseVoice = (binDir) => startOffline(binDir, ...offlineEngine("sense-voice"));

// ---------- benches and history ----------
const HERE = __dirname;
const HISTORY = path.join(HERE, "results", "history.jsonl");

function resolveBench(id) {
  const meta = JSON.parse(fs.readFileSync(path.join(HERE, "benches.json"), "utf8"))[id];
  if (!meta) throw new Error(`unknown bench ${id} (see benches.json)`);
  const root = process.env.WHISPERWOOF_BENCH_DATA || path.join(os.homedir(), ".whisperwoof-bench");
  const audio = path.join(root, id, meta.files.audio);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(audio)).digest("hex");
  if (sha !== meta.audioSha256) throw new Error(`${audio} is not ${id} (sha256 ${sha.slice(0, 12)}…)`);
  return { audio, ref: path.join(root, id, meta.files.reference) };
}

function modelLabel(engine) {
  if (engine === "whisper-turbo") return "ggml-large-v3-turbo (whisper.cpp)";
  if (engine === "sense-voice") return "sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
  if (engine.includes("@")) return engine.split("@")[1].replace(/^sherpa-onnx-/, "");
  return `x-asr-zh-en-streaming-${engine.split("-").pop()}ms`;
}

function gitSha() {
  try {
    return execFileSync("git", ["-C", HERE, "rev-parse", "--short", "HEAD"]).toString().trim();
  } catch {
    return null;
  }
}

function machine() {
  const cpus = os.cpus();
  return `${cpus[0].model}, ${cpus.length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`;
}

/** RESULTS.md: the latest run per bench, model and plan, best first. */
function writeReport() {
  const rows = fs.existsSync(HISTORY)
    ? fs.readFileSync(HISTORY, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const latest = new Map();
  for (const r of rows) latest.set(`${r.bench}|${r.model}|${r.plan}|${r.threads ?? 4}|${Boolean(r.hotwords)}`, r);
  const benches = JSON.parse(fs.readFileSync(path.join(HERE, "benches.json"), "utf8"));
  const out = [
    "# Meeting bench results",
    "",
    "Generated by `run_clips.js --record` from `results/history.jsonl` (every run is kept there). This page shows the latest run per bench, model and cut plan, best first. MER is the mixed error rate (Chinese per character, English per word) against the bench's reference; RTF is processing time over audio time. Bench audio and references are private and not in the repo; `benches.json` describes them.",
    "",
  ];
  for (const bench of [...new Set([...latest.values()].map((r) => r.bench))].sort()) {
    const meta = benches[bench] || {};
    out.push(`## ${bench}`, "", `${meta.description || ""} ${Math.round((meta.durationS || 0) / 6) / 10} min; reference: ${meta.reference || "?"}.`, "");
    out.push("| model | runtime | plan | threads | MER | RTF | date | machine |", "|---|---|---|---|---|---|---|---|");
    [...latest.values()]
      .filter((r) => r.bench === bench)
      .sort((a, b) => a.mer - b.mer)
      .forEach((r) => out.push(`| ${r.model}${r.hotwords ? " (hotwords)" : ""} | ${r.runtime} | ${r.plan} | ${r.threads ?? 4} | ${(r.mer * 100).toFixed(1)}% | ${r.rtf.toFixed(3)} | ${r.date} | ${r.machine} |`));
    out.push("");
  }
  fs.writeFileSync(path.join(HERE, "RESULTS.md"), out.join("\n"));
}

function runtimeLabel(engine) {
  if (engine === "whisper-turbo") return "whisper.cpp server (app bundle)";
  if (engine.includes("@") || engine === "sense-voice") return "sherpa-onnx 1.13.4 offline server";
  return "sherpa-onnx 1.13.4 online server";
}

// ---------- run ----------
async function main() {
  if (args["report-only"]) return writeReport();
  if (args.bench) Object.assign(args, resolveBench(args.bench));
  fs.mkdirSync(args.out, { recursive: true });
  const samples = decode16k(args.audio);
  const audioS = samples.length / SR;
  const utts = parseReference(fs.readFileSync(args.ref, "utf8"));
  const refText = utts.map((u) => u.text).join("");
  const plans = Object.fromEntries(PLANS.map((p) => [p, planClips(samples, p)]));
  const results = { audioS, refUtterances: utts.length, plans: {}, runs: [] };
  for (const [name, p] of Object.entries(plans)) {
    results.plans[name] = {
      clips: p.clips.length,
      pauseCuts: p.pauseCuts,
      forcedCuts: p.forcedCuts,
      cutsS: p.clips.slice(1).map(([s]) => +(s / SR).toFixed(2)),
    };
  }

  for (const engine of ENGINES) {
    const offline = offlineEngine(engine);
    const server =
      engine === "whisper-turbo"
        ? await startWhisper(args["bin-dir"])
        : offline
          ? await startOffline(args["bin-dir"], ...offline)
          : await startXasr(args["bin-dir"], `x-asr-zh-en-streaming-${engine.split("-").pop()}ms`);
    try {
      await server.transcribe(samples.subarray(0, SR)); // warm up
      for (const [plan, { clips }] of Object.entries(plans)) {
        const t0 = Date.now();
        const texts = [];
        const clipMs = [];
        for (const [s, e] of clips) {
          const c0 = Date.now();
          texts.push(await server.transcribe(samples.subarray(s, e)));
          clipMs.push(Date.now() - c0);
        }
        const wallS = (Date.now() - t0) / 1000;
        const hyp = joinTranscriptSegments(texts);
        fs.writeFileSync(path.join(args.out, `${engine}.${plan}.txt`), texts.join("\n\n") + "\n");
        const score = mer(refText, hyp);
        results.runs.push({
          engine, plan, clips: clips.length, mer: +score.mer.toFixed(4), refTokens: score.refTokens,
          wallS: +wallS.toFixed(1), rtf: +(wallS / audioS).toFixed(4), maxClipMs: Math.max(...clipMs),
        });
        console.log(`${engine.padEnd(14)} ${plan.padEnd(10)} clips=${clips.length} MER=${(score.mer * 100).toFixed(1)}% RTF=${(wallS / audioS).toFixed(3)}`);
        if (args.record && args.bench) {
          fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
          const entry = {
            date: new Date().toISOString().slice(0, 10), bench: args.bench, model: modelLabel(engine),
            runtime: runtimeLabel(engine), plan, clips: clips.length, mer: +score.mer.toFixed(4),
            rtf: +(wallS / audioS).toFixed(4), threads: THREADS, hotwords: Boolean(args.hotwords), machine: machine(), git: gitSha(),
          };
          fs.appendFileSync(HISTORY, JSON.stringify(entry) + "\n");
        }
      }
    } finally {
      server.stop();
    }
  }
  fs.writeFileSync(path.join(args.out, "results.json"), JSON.stringify(results, null, 2));
  if (args.record && args.bench) writeReport();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { planClips, splitAtLulls, tokenize, editDistance, mer, parseReference, startXasr, startSenseVoice, decode16k };
