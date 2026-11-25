#!/usr/bin/env node

/**
 * Polish Eval — measures the PRODUCTION cleanup path.
 *
 * Unlike run-eval.js (which tested the legacy polish-presets stack), this
 * builds the system prompt the way src/config/prompts.ts does for a real
 * dictation — CLEANUP_LANGUAGE_DIRECTIVE on top, the shipped `cleanupPrompt`
 * for the chosen LOCALE, and the input-specific script-mix hint appended last
 * — and sends it with the sampling the app's local path uses
 * (src/services/localReasoningBridge.js: temperature 0.3, top_k 40, top_p 0.9,
 * no repeat penalty — reduplication is grammar in Chinese).
 *
 * It captures full outputs + latency and computes quality heuristics so prompt
 * and param changes can be compared. Final quality judgement is done by reading
 * the dumped outputs (cleanup has many valid forms; a single WER target is too
 * brittle).
 *
 * Backends:
 *   Ollama (default)   OLLAMA_URL=http://localhost:11434, MODELS=<ollama tags>
 *   llama-server       LLAMA_URL=http://127.0.0.1:8080 — the bundled engine
 *                      itself (start it on the GGUF you ship, e.g.
 *                      llama-server -m ~/.cache/openwhispr/<model>.gguf --jinja --port 8080);
 *                      MODELS is then just a label.
 *
 * Usage:
 *   node eval/run-polish-eval.js                         # all models, prod params, prod prompt
 *   LOCALE=zh-CN node eval/run-polish-eval.js            # the prompt a zh-CN UI user gets
 *   PROMPT=candidate node eval/run-polish-eval.js        # use a candidate prompt (see PROMPTS below)
 *   MODELS="llama3.2:3b,qwen2.5:3b" node eval/run-polish-eval.js
 *   TEMP=0.1 node eval/run-polish-eval.js                # override temperature
 *   LLAMA_URL=http://127.0.0.1:8080 MODELS=qwen3.5-4b node eval/run-polish-eval.js
 */

const fs = require("fs");
const path = require("path");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLAMA_URL = process.env.LLAMA_URL || null;
// LOCALE picks which shipped prompt to evaluate — production selects the
// prompt by UI language (ReasoningService.getUiLanguage), so a zh-CN user's
// dictation runs under the zh-CN prompt, not the en one. Evaluate both:
//   LOCALE=zh-CN node eval/run-polish-eval.js
const LOCALE = process.env.LOCALE || "en";
const PROMPTS_PATH = path.join(__dirname, "..", "src", "locales", LOCALE, "prompts.json");
const CASES_PATH = path.join(__dirname, "polish-cases.json");
const RESULTS_DIR = path.join(__dirname, "results");

// Production sampling params (mirror src/services/localReasoningBridge.js).
const PARAMS = {
  temperature: process.env.TEMP ? parseFloat(process.env.TEMP) : 0.3,
  top_k: process.env.TOPK ? parseInt(process.env.TOPK, 10) : 40,
  top_p: process.env.TOPP ? parseFloat(process.env.TOPP) : 0.9,
  num_predict: 512,
};
// Opt-in only: production sends none, and 1.1 penalises legitimate Chinese
// reduplication (看看 / 谢谢 / 慢慢).
if (process.env.REPEAT) PARAMS.repeat_penalty = parseFloat(process.env.REPEAT);

const PROD_PROMPT = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8")).cleanupPrompt;

// Mirrors src/config/prompts.ts getSystemPrompt (cleanup mode): directive on
// top, prompt body, input-specific hint last. Keep in sync by hand — the TS
// module cannot be required from here, so the strings are duplicated.
const CLEANUP_LANGUAGE_DIRECTIVE = "Output in the same language as the input. Never translate.";
const SCRIPT_MIX_HINTS = require("../src/whisperwoof/core/language/script-mix-hints.json");
function describeScriptMix(text) {
  const han = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (han === 0 && latin === 0) return "none";
  if (han === 0) return "en";
  if (latin < 2) return "zh";
  return "mixed";
}
function buildSystemPrompt(body, input) {
  const hint = SCRIPT_MIX_HINTS[describeScriptMix(input)] || "";
  return `${CLEANUP_LANGUAGE_DIRECTIVE}\n\n${body}${hint ? `\n\n${hint}` : ""}`;
}

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

// Translation heuristic — the same proportion rule the app's output guard
// applies (src/whisperwoof/core/polish/polish-output-guard.ts, "whole" and
// "ratio"); the token-novelty rules live only there. A hit here means the
// app would have pasted the RAW transcript for this case.
function translated(input, out) {
  const count = (t) => ({
    han: (t.match(/[一-鿿㐀-䶿]/g) || []).length,
    latin: (t.match(/[a-zA-Z]/g) || []).length,
  });
  const r = count(input);
  const p = count(out);
  const rTotal = r.han + r.latin;
  const pTotal = p.han + p.latin;
  if (rTotal < 2 || pTotal < 2) return false;
  const rHan = r.han / rTotal;
  const pHan = p.han / pTotal;
  if (rHan >= 0.3 && pHan <= rHan * 0.25) return true;
  if (1 - rHan >= 0.5 && 1 - pHan <= (1 - rHan) * 0.25) return true;
  const hanLost = r.han - p.han;
  const latinGained = p.latin - r.latin;
  if (hanLost >= Math.max(2, r.han * 0.3) && latinGained >= Math.max(4, hanLost * 1.2)) return true;
  const latinLost = r.latin - p.latin;
  const hanGained = p.han - r.han;
  return latinLost >= Math.max(6, r.latin * 0.3) && hanGained >= Math.max(3, latinLost * 0.4);
}

// --- Backends ---------------------------------------------------------------

async function polish(model, systemPrompt, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const start = Date.now();
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text },
  ];
  try {
    let res;
    if (LLAMA_URL) {
      // The exact body src/helpers/llamaServer.js sends.
      res = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          temperature: PARAMS.temperature,
          top_k: PARAMS.top_k,
          top_p: PARAMS.top_p,
          max_tokens: PARAMS.num_predict,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: controller.signal,
      });
    } else {
      res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false, options: PARAMS }),
        signal: controller.signal,
      });
    }
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok) return { out: "", latencyMs, error: `HTTP ${res.status}` };
    const data = await res.json();
    const content = LLAMA_URL ? data?.choices?.[0]?.message?.content : data?.message?.content;
    const out = (content || "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<think>[\s\S]*$/, "")
      .trim();
    return { out, latencyMs, error: null };
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
  const promptBody = PROMPTS[promptKey];
  if (!promptBody) {
    console.error(`Unknown PROMPT="${promptKey}". Available: ${Object.keys(PROMPTS).join(", ")}`);
    process.exit(1);
  }

  if (LLAMA_URL) {
    try {
      const check = await fetch(`${LLAMA_URL}/health`);
      if (!check.ok) throw new Error("not ok");
    } catch {
      console.error(`✗ llama-server not reachable at ${LLAMA_URL}. Start it with: llama-server -m <model.gguf> --jinja --port 8080`);
      process.exit(1);
    }
  } else {
    try {
      const check = await fetch(`${OLLAMA_URL}/api/tags`);
      if (!check.ok) throw new Error("not ok");
    } catch {
      console.error("✗ Ollama not running. Start it with: ollama serve (or set LLAMA_URL for the bundled engine)");
      process.exit(1);
    }
  }

  console.log(`\nPolish eval — prompt="${promptKey}" locale=${LOCALE} backend=${LLAMA_URL ? "llama-server" : "ollama"} | ${cases.length} cases × ${models.length} models`);
  console.log(`Params: ${JSON.stringify(PARAMS)}\n`);

  const runResults = [];
  for (const model of models) {
    console.log(`\n===== ${model} =====`);
    const perModel = [];
    for (const c of cases) {
      const systemPrompt = buildSystemPrompt(promptBody, c.input);
      const { out, latencyMs, error } = await polish(model, systemPrompt, c.input);
      const leaks = leakHits(out);
      const fillers = countFillers(out);
      const flip = translated(c.input, out);
      const ratio = wordCount(c.input) ? wordCount(out) / wordCount(c.input) : 0;
      const flags = [];
      if (error) flags.push(`ERR:${error}`);
      if (leaks.length) flags.push(`LEAK(${leaks.length})`);
      if (fillers > 0) flags.push(`FILLER(${fillers})`);
      if (flip) flags.push("TRANSLATED");
      if (ratio < 0.4 && wordCount(c.input) > 8) flags.push(`SHORT(${ratio.toFixed(2)})`);
      if (ratio > 1.6) flags.push(`EXPAND(${ratio.toFixed(2)})`);
      perModel.push({ id: c.id, input: c.input, out, latencyMs, leaks, fillers, translated: flip, ratio: +ratio.toFixed(2), error });
      const status = flags.length ? `⚠ ${flags.join(" ")}` : "✓";
      console.log(`  ${c.id.padEnd(26)} ${String(latencyMs).padStart(5)}ms  ${status}`);
    }
    const ok = perModel.filter((r) => !r.error && !r.leaks.length && r.fillers === 0 && !r.translated);
    const flips = perModel.filter((r) => r.translated).length;
    const avgLat = Math.round(perModel.reduce((s, r) => s + r.latencyMs, 0) / perModel.length);
    console.log(`  ----- clean: ${ok.length}/${perModel.length} | translated: ${flips} | avg ${avgLat}ms`);
    runResults.push({ model, avgLatencyMs: avgLat, cleanCount: ok.length, translatedCount: flips, total: perModel.length, cases: perModel });
  }

  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = {
    timestamp: new Date().toISOString(),
    prompt: promptKey,
    locale: LOCALE,
    backend: LLAMA_URL ? "llama-server" : "ollama",
    params: PARAMS,
    models,
    runResults,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(RESULTS_DIR, `polish-${promptKey}-${stamp}.json`), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `polish-latest.json`), JSON.stringify(out, null, 2));
  console.log(`\nSaved → eval/results/polish-latest.json (read outputs there to judge quality)`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { buildSystemPrompt, translated, leakHits, PARAMS, PROD_PROMPT };
