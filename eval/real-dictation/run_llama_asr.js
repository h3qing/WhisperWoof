#!/usr/bin/env node
/**
 * Real-dictation bench: run an audio model served by llama-server (mtmd, e.g.
 * Qwen3-ASR GGUF + mmproj) over the clips and write <data>/hyps/<name>.json in
 * run_models.js's format.
 *
 *   node eval/real-dictation/run_llama_asr.js --data ~/.whisperwoof-bench/dictation-real-1 \
 *     --url http://127.0.0.1:8342 --name qwen3-asr-1.7b-llama --model Qwen3-ASR-1.7B-Q8_0 \
 *     --runtime "llama.cpp b12032" [--mode transcriptions|chat] [--clips 1272,1282] [--force]
 *
 * --mode transcriptions (default) posts the WAV to /v1/audio/transcriptions
 * (llama-server adds "Transcribe audio to text" to the turn); --mode chat sends
 * the audio alone as the user turn. Start llama-server with --cache-ram 0: its
 * default 8 GB prompt cache otherwise fills up over the run. Language is
 * left on auto, no hotwords. Qwen3-ASR answers "language Chinese<asr_text>…":
 * the prefix is dropped (llama-server keeps it).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

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
const DATA = path.resolve(String(args.data || "").replace(/^~/, os.homedir()));
const URL_BASE = String(args.url || "http://127.0.0.1:8342");
const MODE = String(args.mode || "transcriptions");

const stripAsrTags = (text) => String(text || "").replace(/language\s+[A-Za-z]+\s*<asr_text>/g, "").trim();

async function transcribe(wav) {
  if (MODE === "chat") {
    const body = {
      // The audio alone. (Adding Qwen3-ASR's empty system turn scored the same within noise: 44 vs 42.)
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } }] }],
      temperature: 0,
      max_tokens: 512,
    };
    const res = await fetch(`${URL_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
    return stripAsrTags((await res.json()).choices[0].message.content);
  }
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "clip.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await fetch(`${URL_BASE}/v1/audio/transcriptions`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`transcriptions ${res.status}: ${await res.text()}`);
  return stripAsrTags((await res.json()).text);
}

async function main() {
  if (!args.data || !args.name) throw new Error("--data and --name are required");
  const { clips } = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));
  const file = path.join(DATA, "hyps", `${String(args.name).replace(/[^\w.@-]/g, "_")}.json`);
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { clips: {} };
  const only = args.clips ? new Set(String(args.clips).split(",")) : null;
  const todo = clips.filter((c) => (!only || only.has(String(c.id))) && (args.force || !previous.clips[c.id]));
  if (!todo.length) return console.log(`${args.name}: nothing to do`);
  await transcribe(fs.readFileSync(path.join(DATA, todo[0].file))); // warm up
  let done = { ...previous.clips };
  for (const clip of todo) {
    const wav = fs.readFileSync(path.join(DATA, clip.file));
    const t0 = Date.now();
    const text = await transcribe(wav);
    done = { ...done, [clip.id]: { text, ms: Date.now() - t0 } };
  }
  const out = {
    engine: args.name,
    model: String(args.model || args.name),
    runtime: String(args.runtime || "llama.cpp"),
    streaming: false,
    date: new Date().toISOString().slice(0, 10),
    clips: done,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
  const ms = todo.map((c) => done[c.id].ms).sort((a, b) => a - b);
  console.log(`${args.name}: ${todo.length} clips, decode p50 ${ms[Math.floor(ms.length / 2)]} ms, p90 ${ms[Math.floor(ms.length * 0.9)]} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
