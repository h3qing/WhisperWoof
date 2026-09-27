/**
 * Words in clipboard images — pure rules (no fs, no electron) for the reader
 * in clipboard-image-text.js: the setting, when to read and how fast, which
 * languages to ask macOS for, the helper's wire format, and the snippet a
 * search result shows.
 */

/** Off until the user turns it on (it reads every image they've copied). */
const DEFAULT_IMAGE_TEXT = Object.freeze({ enabled: false });

/** Stored text per image is capped; a screenshot of a whole document is still searchable. */
const MAX_TEXT_CHARS = 20000;

/** Load average per core at which the Mac counts as busy. */
const BUSY_LOAD_RATIO = 0.75;
/** New copies wait this long, so a burst of copies settles first. */
const FRESH_DELAY_MS = 2000;
const FRESH_REST_MS = 200;
/** Older images: rest at least as long as the last one took (twice while the user is active). */
const MIN_REST_MS = 400;
const MAX_REST_MS = 10000;

function normalizeImageText(raw) {
  return { enabled: Boolean(raw && typeof raw === "object" && raw.enabled === true) };
}

const paused = (reason, retryMs) => ({ run: false, freshOnly: false, state: "paused", reason, retryMs });

/**
 * Whether to read an image now.
 * ctx: { enabled, available, dbOpen, hasFresh, hasBacklog, now, holdUntil,
 *        meetingRecording, thermal, onBattery, loadRatio }
 * → { run, freshOnly, state: off|unavailable|paused|done|reading, reason?, retryMs }
 * `retryMs` null means wait to be woken (a new copy, unlock, turning it on).
 */
function decidePace(ctx) {
  if (!ctx.enabled) return { run: false, freshOnly: false, state: "off", retryMs: null };
  if (!ctx.available) return { run: false, freshOnly: false, state: "unavailable", retryMs: null };
  if (!ctx.dbOpen) return paused("locked", null);
  if (!ctx.hasFresh && !ctx.hasBacklog) return { run: false, freshOnly: false, state: "done", retryMs: null };
  if (ctx.meetingRecording) return paused("meeting", 30000);
  const holdLeft = (ctx.holdUntil || 0) - ctx.now;
  if (holdLeft > 0) return paused("dictating", holdLeft + 250);
  if (ctx.thermal === "serious" || ctx.thermal === "critical") return paused("hot", 60000);
  if (ctx.loadRatio >= BUSY_LOAD_RATIO) return paused("busy", 20000);
  // On battery only new copies are read; older images wait for the charger.
  if (ctx.onBattery && !ctx.hasFresh) return paused("battery", 60000);
  return { run: true, freshOnly: Boolean(ctx.onBattery), state: "reading", retryMs: null };
}

/**
 * Rest after reading one image. Older images keep the helper busy at most
 * half the time, a third while the user is at the Mac; new copies go quickly.
 */
function restAfter(elapsedMs, { fresh = false, userActive = false } = {}) {
  if (fresh) return FRESH_REST_MS;
  const rest = Math.round((Number(elapsedMs) || 0) * (userActive ? 2 : 1));
  return Math.min(MAX_REST_MS, Math.max(MIN_REST_MS, rest));
}

// Vision's names for the languages it reads (macOS 13 reads all of these,
// older macOS fewer; the helper drops what it can't).
const VISION_LANGUAGE = {
  en: "en-US",
  fr: "fr-FR",
  it: "it-IT",
  de: "de-DE",
  es: "es-ES",
  pt: "pt-BR",
  ja: "ja-JP",
  ko: "ko-KR",
  ru: "ru-RU",
  uk: "uk-UA",
  th: "th-TH",
  vi: "vi-VT",
};
const CJK = new Set(["zh-Hans", "zh-Hant", "ja-JP", "ko-KR"]);

function visionLanguage(tag) {
  const t = String(tag ?? "").toLowerCase();
  if (/^zh-(hant|tw|hk|mo)\b/.test(t)) return "zh-Hant";
  if (t === "zh" || t.startsWith("zh-")) return "zh-Hans";
  return VISION_LANGUAGE[t.split(/[-_]/)[0]] ?? null;
}

/**
 * Languages to read, from the Mac's preferred languages: Chinese, Japanese
 * or Korean first (their models read Latin text too, not the other way
 * round), then the rest, and always English.
 */
function ocrLanguages(preferred) {
  const out = [];
  for (const tag of Array.isArray(preferred) ? preferred : []) {
    const lang = visionLanguage(tag);
    if (lang && !out.includes(lang)) out.push(lang);
  }
  if (!out.includes("en-US")) out.push("en-US");
  return [...out.filter((l) => CJK.has(l)), ...out.filter((l) => !CJK.has(l))];
}

/** The 4-byte big-endian length that goes before each image sent to the helper. */
function frameHeader(length) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(length, 0);
  return header;
}

/** Recognized lines as stored: no control characters or blank lines, trimmed, capped. */
function cleanRecognizedText(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  let out = lines.join("\n");
  if (out.length > MAX_TEXT_CHARS) {
    out = out.slice(0, MAX_TEXT_CHARS);
    // Don't end on half a surrogate pair.
    if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);
  }
  return out;
}

/**
 * One JSON line from the helper → { ready } (it started), { text }, or
 * { error: "unreadable" | "failed" }.
 */
function parseHelperAnswer(line) {
  let parsed;
  try {
    parsed = JSON.parse(String(line));
  } catch {
    return { error: "failed" };
  }
  if (!parsed || typeof parsed !== "object") return { error: "failed" };
  if (parsed.ready === true) return { ready: true };
  if (typeof parsed.error === "string") return { error: parsed.error === "unreadable" ? "unreadable" : "failed" };
  if (typeof parsed.text !== "string") return { error: "failed" };
  return { text: cleanRecognizedText(parsed.text) };
}

const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const flat = (s) => s.replace(/\s+/g, " ");

/**
 * The words around the first match of `query` in an image's text, for a
 * search result: { before, match, after } (with … where it was cut) or null.
 */
function matchSnippet(text, query, radius = 32) {
  const t = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!t || !q) return null;
  const lower = t.toLowerCase();
  // Lower-casing can change a string's length (e.g. "İ"); then match exactly.
  const at = lower.length === t.length ? lower.indexOf(q.toLowerCase()) : t.indexOf(q);
  if (at < 0) return null;
  let start = Math.max(0, at - radius);
  let end = Math.min(t.length, at + q.length + radius);
  if (start > 0 && isLowSurrogate(t.charCodeAt(start))) start -= 1;
  if (end < t.length && isHighSurrogate(t.charCodeAt(end - 1))) end += 1;
  return {
    before: `${start > 0 ? "…" : ""}${flat(t.slice(start, at)).trimStart()}`,
    match: flat(t.slice(at, at + q.length)),
    after: `${flat(t.slice(at + q.length, end)).trimEnd()}${end < t.length ? "…" : ""}`,
  };
}

module.exports = {
  DEFAULT_IMAGE_TEXT,
  MAX_TEXT_CHARS,
  BUSY_LOAD_RATIO,
  FRESH_DELAY_MS,
  normalizeImageText,
  decidePace,
  restAfter,
  visionLanguage,
  ocrLanguages,
  frameHeader,
  cleanRecognizedText,
  parseHelperAnswer,
  matchSnippet,
};
