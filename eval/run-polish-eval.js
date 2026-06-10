#!/usr/bin/env node

/**
 * Polish Eval — measures the PRODUCTION cleanup path.
 *
 * Unlike run-eval.js (which tested the legacy polish-presets stack), this loads
 * the real `cleanupPrompt` from src/locales/en/prompts.json — the prompt that
 * actually ships via ReasoningService — and runs it against local models with
 * the production sampling params from src/config/InferenceConfig.ts ("reasoning"
 * use case: temperature 0.3, topK 40, topP 0.9, repeatPenalty 1.1).
 *
 * It captures full outputs + latency and computes quality heuristics so prompt
 * and param changes can be compared. Final quality judgement is done by reading
 * the dumped outputs (cleanup has many valid forms; a single WER target is too
 * brittle).
 *
 * Usage:
 *   node eval/run-polish-eval.js                         # all models, prod params, prod prompt
 *   PROMPT=candidate node eval/run-polish-eval.js        # use a candidate prompt (see PROMPTS below)
 *   MODELS="llama3.2:3b,qwen2.5:3b" node eval/run-polish-eval.js
 *   TEMP=0.1 node eval/run-polish-eval.js                # override temperature
 */

const fs = require("fs");
const path = require("path");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const PROMPTS_PATH = path.join(__dirname, "..", "src", "locales", "en", "prompts.json");
const CASES_PATH = path.join(__dirname, "polish-cases.json");
const RESULTS_DIR = path.join(__dirname, "results");

// Production sampling params (mirror InferenceConfig "reasoning" use case).
const PARAMS = {
  temperature: process.env.TEMP ? parseFloat(process.env.TEMP) : 0.3,
  top_k: process.env.TOPK ? parseInt(process.env.TOPK, 10) : 40,
  top_p: process.env.TOPP ? parseFloat(process.env.TOPP) : 0.9,
  repeat_penalty: process.env.REPEAT ? parseFloat(process.env.REPEAT) : 1.1,
  num_predict: 512,
};

const PROD_PROMPT = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8")).cleanupPrompt;

// Candidate prompts live here so the eval is self-contained while iterating.
const PROMPTS = {
  prod: PROD_PROMPT,
};
const candidatePath = path.join(__dirname, "candidate-prompt.txt");
if (fs.existsSync(candidatePath)) {
  PROMPTS.candidate = fs.readFileSync(candidatePath, "utf-8").trim();
}

// --- Quality heuristics ----------------------------------------------------

// Phrases that signal the model broke character (added commentary / preamble /
// meta) instead of just returning cleaned text.
const LEAK_PATTERNS = [
  /^here(?:'s| is)\b/i,
  /^sure[,!]/i,
  /^(?:okay|ok)[,!]/i,
  /^i('| a)?m sorry/i,
  /^the (?:cleaned|polished|corrected)/i,
  /^cleaned(?: up)? (?:text|version)/i,
  /\bcleaned[- ]up text\b/i,
  /^as an ai/i,
  /^certainly[,!]/i,
  /^output:/i,
  /\bhere is the (?:cleaned|polished)/i,
  /\blet me know if\b/i,
  /^"[^"]*"$/, // entire output wrapped in quotes
];

const FILLERS = ["um", "uh", "erm", "uhh", "umm"];

function leakHits(out) {
  return LEAK_PATTERNS.filter((re) => re.test(out.trim())).map((re) => re.source);
}
function countFillers(text) {
  const lower = ` ${text.toLowerCase()} `;
  let n = 0;
  for (const f of FILLERS) {
    const m = lower.match(new RegExp(`\\b${f}\\b`, "g"));
    if (m) n += m.length;
  }
  return n;
}
function wordCount(t) {
  return t.split(/\s+/).filter(Boolean).length;
}

// --- Ollama -----------------------------------------------------------------

async function polish(model, systemPrompt, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const start = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        stream: false,
        options: PARAMS,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok) return { out: "", latencyMs, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { out: (data?.message?.content || "").trim(), latencyMs, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { out: "", latencyMs: Date.now() - start, error: err.message };
  }
}

// --- Runner -----------------------------------------------------------------

async function main() {
  const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf-8")).cases;
  const models = (process.env.MODELS || "llama3.2:1b,llama3.2:3b,qwen2.5:3b")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const promptKey = process.env.PROMPT || "prod";
  const systemPrompt = PROMPTS[promptKey];
  if (!systemPrompt) {
    console.error(`Unknown PROMPT="${promptKey}". Available: ${Object.keys(PROMPTS).join(", ")}`);
    process.exit(1);
  }

  try {
    const check = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!check.ok) throw new Error("not ok");
  } catch {
    console.error("✗ Ollama not running. Start it with: ollama serve");
    process.exit(1);
  }

  console.log(`\nPolish eval — prompt="${promptKey}" | ${cases.length} cases × ${models.length} models`);
  console.log(`Params: ${JSON.stringify(PARAMS)}\n`);

  const runResults = [];
  for (const model of models) {
    console.log(`\n===== ${model} =====`);
    const perModel = [];
    for (const c of cases) {
      const { out, latencyMs, error } = await polish(model, systemPrompt, c.input);
      const leaks = leakHits(out);
      const fillers = countFillers(out);
      const ratio = wordCount(c.input) ? wordCount(out) / wordCount(c.input) : 0;
      const flags = [];
      if (error) flags.push(`ERR:${error}`);
      if (leaks.length) flags.push(`LEAK(${leaks.length})`);
      if (fillers > 0) flags.push(`FILLER(${fillers})`);
      if (ratio < 0.4 && wordCount(c.input) > 8) flags.push(`SHORT(${ratio.toFixed(2)})`);
      if (ratio > 1.6) flags.push(`EXPAND(${ratio.toFixed(2)})`);
      perModel.push({ id: c.id, input: c.input, out, latencyMs, leaks, fillers, ratio: +ratio.toFixed(2), error });
      const status = flags.length ? `⚠ ${flags.join(" ")}` : "✓";
      console.log(`  ${c.id.padEnd(22)} ${String(latencyMs).padStart(5)}ms  ${status}`);
    }
    const ok = perModel.filter((r) => !r.error && !r.leaks.length && r.fillers === 0);
    const avgLat = Math.round(perModel.reduce((s, r) => s + r.latencyMs, 0) / perModel.length);
    console.log(`  ----- clean: ${ok.length}/${perModel.length} | avg ${avgLat}ms`);
    runResults.push({ model, avgLatencyMs: avgLat, cleanCount: ok.length, total: perModel.length, cases: perModel });
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = { timestamp: new Date().toISOString(), prompt: promptKey, params: PARAMS, models, runResults };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(RESULTS_DIR, `polish-${promptKey}-${stamp}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `polish-latest.json`), JSON.stringify(out, null, 2));
  console.log(`\nSaved → eval/results/polish-latest.json (read outputs there to judge quality)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
