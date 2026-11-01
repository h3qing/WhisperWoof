#!/usr/bin/env node
/**
 * Score every engine against the references the owner confirmed on the
 * rating page. Same mixed error rate as the other benches (Chinese per
 * character, English per word, punctuation ignored), plus how often each
 * engine's output was the one picked as closest, split by what the clip was:
 * Chinese, English or mixed. Fillers (嗯, 呃, um, uh) are dropped from both sides.
 *
 *   node eval/real-dictation/score.js --data ~/.whisperwoof-bench/dictation-real-1 [--json]
 *
 * Prints only aggregate numbers (no transcript text), so the output can go
 * into the repo.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { tokenize } = require("../meeting-bench/run_clips");

const CJK = /[一-鿿㐀-䶿]/;
// Fillers: polish removes them anyway, and whether a model writes them says nothing about what it heard.
const FILLERS = new Set(["嗯", "呃", "额", "um", "uh", "er", "erm", "hmm", "mm"]);
const words = (text) => tokenize(text || "").filter((t) => !FILLERS.has(t));
// Tags some models emit for non-speech (<noise>, [BLANK_AUDIO], sil) aren't typed text.
const spoken = (text) => words(String(text || "").replace(/<[^>]*>|\[[^\]]*\]|\([^)]*\)/g, " ")).filter((t) => t !== "sil");
// The app's own text at the time, from the transcriptions table.
const APP_ENGINE = "app-at-the-time";

function loadSession(data) {
  const manifest = JSON.parse(fs.readFileSync(path.join(data, "manifest.json"), "utf8"));
  const hypDir = path.join(data, "hyps");
  const fromFiles = fs.existsSync(hypDir)
    ? fs.readdirSync(hypDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(hypDir, f), "utf8")))
    : [];
  const app = {
    engine: APP_ENGINE,
    model: "what WhisperWoof produced when you dictated (raw, before polish)",
    runtime: "app",
    clips: Object.fromEntries(manifest.clips.map((c) => [c.id, { text: c.appRaw || c.appText || "" }])),
  };
  const ratingsFile = path.join(data, "ratings.json");
  const ratings = fs.existsSync(ratingsFile) ? JSON.parse(fs.readFileSync(ratingsFile, "utf8")) : {};
  return { manifest, engines: [...fromFiles, app], ratings };
}

/** Edit-distance alignment; errors are charged to the reference token's language (insertions to the inserted token's). */
function alignErrors(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Uint32Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
  }
  const errors = { zh: 0, en: 0 };
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      if (ref[i - 1] !== hyp[j - 1]) errors[CJK.test(ref[i - 1]) ? "zh" : "en"] += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      errors[CJK.test(ref[i - 1]) ? "zh" : "en"] += 1;
      i -= 1;
    } else {
      errors[CJK.test(hyp[j - 1]) ? "zh" : "en"] += 1;
      j -= 1;
    }
  }
  return { edits: d[n][m], ...errors };
}

function clipKind(refTokens) {
  const zh = refTokens.filter((t) => CJK.test(t)).length;
  const en = refTokens.length - zh;
  if (!en) return "zh";
  if (!zh) return "en";
  return "mixed";
}

const emptyTotals = () => ({ clips: 0, edits: 0, tokens: 0, zhEdits: 0, zhTokens: 0, enEdits: 0, enTokens: 0, perfect: 0, picked: 0, broken: 0, ms: [] });

function addClip(totals, ref, hyp, picked, ms) {
  const errors = alignErrors(ref, hyp);
  const zhTokens = ref.filter((t) => CJK.test(t)).length;
  return {
    clips: totals.clips + 1,
    edits: totals.edits + errors.edits,
    tokens: totals.tokens + ref.length,
    zhEdits: totals.zhEdits + errors.zh,
    zhTokens: totals.zhTokens + zhTokens,
    enEdits: totals.enEdits + errors.en,
    enTokens: totals.enTokens + ref.length - zhTokens,
    perfect: totals.perfect + (errors.edits === 0 ? 1 : 0),
    picked: totals.picked + (picked ? 1 : 0),
    broken: totals.broken + (errors.edits / Math.max(ref.length, 1) > 0.5 ? 1 : 0),
    ms: ms == null ? totals.ms : [...totals.ms, ms],
  };
}

const pct = (a, b) => (b ? a / b : null);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

function summarize(totals) {
  return {
    clips: totals.clips,
    mer: pct(totals.edits, totals.tokens),
    zhCer: pct(totals.zhEdits, totals.zhTokens),
    enWer: pct(totals.enEdits, totals.enTokens),
    perfectRate: pct(totals.perfect, totals.clips),
    pickedRate: pct(totals.picked, totals.clips),
    brokenClips: totals.broken,
    decodeMsP50: median(totals.ms),
  };
}

function score(data) {
  const { manifest, engines, ratings } = loadSession(data);
  const rated = manifest.clips.filter((c) => ratings[c.id] && !ratings[c.id].skipped && ratings[c.id].reference?.trim());
  const silent = manifest.clips.filter((c) => ratings[c.id]?.skipped === "no-speech");
  const kinds = ["all", "zh", "mixed", "en"];
  const byEngine = engines.map((e) => {
    const totals = Object.fromEntries(kinds.map((k) => [k, emptyTotals()]));
    for (const clip of rated) {
      const hyp = e.clips[clip.id];
      if (!hyp) continue;
      const rating = ratings[clip.id];
      const ref = words(rating.reference);
      const picked = (rating.pickedEngines || []).includes(e.engine);
      for (const k of ["all", clipKind(ref)]) totals[k] = addClip(totals[k], ref, words(hyp.text), picked, hyp.ms);
    }
    // Clips you marked "No speech" where this engine would still have typed something.
    const typedOnSilence = silent.filter((c) => e.clips[c.id] && spoken(e.clips[c.id].text).length).length;
    return {
      engine: e.engine,
      model: e.model,
      runtime: e.runtime,
      streaming: Boolean(e.streaming),
      typedOnSilence,
      ...Object.fromEntries(kinds.map((k) => [k, summarize(totals[k])])),
    };
  });
  const ranked = [...byEngine].sort((a, b) => (a.all.mer ?? 9) - (b.all.mer ?? 9));
  const skipped = Object.values(ratings).filter((r) => r.skipped).length;
  const clipKinds = rated.reduce((acc, c) => {
    const kind = clipKind(words(ratings[c.id].reference));
    return { ...acc, [kind]: (acc[kind] || 0) + 1 };
  }, {});
  return { rated: rated.length, skipped, silentClips: silent.length, totalClips: manifest.clips.length, clipKinds, engines: ranked };
}

function markdown(result) {
  const f = (x) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
  const lines = [
    `${result.rated} clips rated (${Object.entries(result.clipKinds).map(([k, n]) => `${n} ${k}`).join(", ")}), ${result.skipped} skipped, of ${result.totalClips}.`,
    "",
    `| engine | MER | zh CER | en WER | perfect clips | broken (>50%) | typed on silence (of ${result.silentClips}) | decode p50 |`,
    "|---|---|---|---|---|---|---|---|",
    ...result.engines.map((e) =>
      `| ${e.engine} | ${f(e.all.mer)} | ${f(e.all.zhCer)} | ${f(e.all.enWer)} | ${f(e.all.perfectRate)} | ${e.all.brokenClips} | ${e.typedOnSilence} | ${e.streaming ? "streams" : e.all.decodeMsP50 == null ? "–" : `${e.all.decodeMsP50} ms`} |`
    ),
  ];
  return lines.join("\n");
}

if (require.main === module) {
  const i = process.argv.indexOf("--data");
  const data = path.resolve(String(process.argv[i + 1] || "").replace(/^~/, os.homedir()));
  const result = score(data);
  console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : markdown(result));
}

module.exports = { score, loadSession, markdown, APP_ENGINE };
