#!/usr/bin/env node
/**
 * Polish the real-dictation transcripts with a local LLM, the way the app
 * does it (same system prompt as eval/run-polish-eval.js, same sampling and
 * request body as src/helpers/llamaServer.js), so cleanup models can be
 * compared blind on the rating page's Cleanup tab.
 *
 *   llama-server -m <model>.gguf --jinja --port 8341 -ngl 99   # renamed copy of the app's binary
 *   node eval/real-dictation/run_polish.js --data ~/.whisperwoof-bench/dictation-real-1 \
 *     --llama-url http://127.0.0.1:8341 --name qwen3.5-2b --input whisper-turbo
 *
 * --input is the ASR engine whose text gets polished (hyps/<input>.json); every
 * cleanup model gets the same input. Writes <data>/polish/<name>.json.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildSystemPrompt, translated, leakHits, PARAMS, PROD_PROMPT } = require("../run-polish-eval");

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const DATA = path.resolve(String(arg("data", "")).replace(/^~/, os.homedir()));
const LLAMA_URL = arg("llama-url", "http://127.0.0.1:8341");
const NAME = arg("name");
const INPUT = arg("input", "whisper-turbo");

async function polish(text) {
  const t0 = Date.now();
  const res = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: buildSystemPrompt(PROD_PROMPT, text) },
        { role: "user", content: text },
      ],
      temperature: PARAMS.temperature,
      top_k: PARAMS.top_k,
      top_p: PARAMS.top_p,
      max_tokens: PARAMS.num_predict,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const out = (data?.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
  return { text: out, ms: Date.now() - t0 };
}

async function main() {
  if (!NAME) throw new Error("--name is required");
  const { clips } = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));
  const inputs = JSON.parse(fs.readFileSync(path.join(DATA, "hyps", `${INPUT}.json`), "utf8")).clips;
  const model = await (await fetch(`${LLAMA_URL}/v1/models`)).json();
  await polish("测试一下。"); // warm up
  let done = {};
  for (const clip of clips) {
    const input = (inputs[clip.id]?.text || "").trim();
    if (!/[\p{L}\p{N}]/u.test(input)) continue; // the app never polishes symbol-only text (non-speech-transcript.ts)
    const out = await polish(input);
    done = { ...done, [clip.id]: { ...out, translated: translated(input, out.text), leaked: leakHits(out.text).length > 0 } };
  }
  fs.mkdirSync(path.join(DATA, "polish"), { recursive: true, mode: 0o700 });
  const file = path.join(DATA, "polish", `${NAME}.json`);
  const label = path.basename(model?.data?.[0]?.id || NAME);
  fs.writeFileSync(file, JSON.stringify({ name: NAME, model: label, input: INPUT, date: new Date().toISOString().slice(0, 10), clips: done }, null, 2), { mode: 0o600 });
  const ms = Object.values(done).map((c) => c.ms).sort((a, b) => a - b);
  const flagged = Object.values(done).filter((c) => c.translated || c.leaked).length;
  console.log(`${NAME}: ${ms.length} clips, p50 ${ms[Math.floor(ms.length / 2)]} ms, translated/leaked ${flagged}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
