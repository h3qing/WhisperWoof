#!/usr/bin/env node
/**
 * Real-dictation bench: run local ASR engines over the clips exported by
 * export_clips.js and keep every hypothesis, so the rating page can show them
 * side by side.
 *
 *   node eval/real-dictation/run_models.js --data ~/.whisperwoof-bench/dictation-real-1 \
 *     --bin-dir <renamed servers> [--bench-models <dir>] \
 *     --engines sense-voice,x-asr-480,whisper-turbo,qwen3-asr@<dir>
 *
 * Engines and --bin-dir/--bench-models are the meeting bench's (see
 * eval/meeting-bench/README.md); the same server adapters are reused.
 * `name=engine` saves an engine under a short name (firered-asr2=firered-aed@<dir>).
 * Each engine writes <data>/hyps/<name>.json ({ clips: { id: { text, ms } } }); a
 * clip already decoded is skipped unless --force, so adding an engine later
 * doesn't redo the others. `ms` is the decode time of the whole clip after
 * warm-up: what a final pass costs after the hotkey is released.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const bench = require("../meeting-bench/run_clips");

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
const ENGINES = String(args.engines || "sense-voice,x-asr-480,whisper-turbo").split(",");

function startEngine(engine) {
  const binDir = args["bin-dir"];
  if (engine === "whisper-turbo") return bench.startWhisper(binDir);
  const offline = bench.offlineEngine(engine);
  if (offline) return bench.startOffline(binDir, ...offline);
  return bench.startXasr(binDir, `x-asr-zh-en-streaming-${engine.split("-").pop()}ms`);
}

function readHyps(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { clips: {} };
}

async function runEngine(spec, clips) {
  const [name, engine] = spec.includes("=") ? spec.split("=") : [spec, spec];
  const file = path.join(DATA, "hyps", `${name.replace(/[^\w.@-]/g, "_")}.json`);
  const previous = readHyps(file);
  const todo = clips.filter((c) => args.force || !previous.clips[c.id]);
  if (!todo.length) return console.log(`${name}: nothing to do`);
  const server = await startEngine(engine);
  let done = { ...previous.clips };
  try {
    await server.transcribe(bench.decode16k(path.join(DATA, todo[0].file)).subarray(0, 16000)); // warm up
    for (const clip of todo) {
      const samples = bench.decode16k(path.join(DATA, clip.file));
      const t0 = Date.now();
      const text = await server.transcribe(samples);
      done = { ...done, [clip.id]: { text, ms: Date.now() - t0 } };
    }
  } finally {
    server.stop();
  }
  const out = {
    engine: name,
    model: bench.modelLabel(engine),
    runtime: bench.runtimeLabel(engine),
    // Streaming engines decode while you talk; their `ms` here (whole clip at once) isn't the wait after release.
    streaming: engine.startsWith("x-asr-") && !engine.includes("@"),
    date: new Date().toISOString().slice(0, 10),
    clips: done,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
  const ms = todo.map((c) => done[c.id].ms).sort((a, b) => a - b);
  console.log(`${name}: ${todo.length} clips, decode p50 ${ms[Math.floor(ms.length / 2)]} ms, p90 ${ms[Math.floor(ms.length * 0.9)]} ms`);
}

async function main() {
  if (!args.data) throw new Error("--data is required");
  fs.mkdirSync(path.join(DATA, "hyps"), { recursive: true, mode: 0o700 });
  const { clips } = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));
  for (const engine of ENGINES) await runEngine(engine, clips);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
