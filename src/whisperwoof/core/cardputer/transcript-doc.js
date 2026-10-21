/**
 * transcript.json and transcript.md of a Cardputer recording (contract v1
 * §7.4): sentences in session time, and a Markdown copy with one block id
 * per line (^tHHMMSS, then -2, -3 for more lines in the same second) that
 * summary.md links to. Pure.
 */

const MAX_TEXT = 10_000; // contract: sentences[].text maxLength (code points)
const MAX_SESSION_MS = 4_294_967_295;

const pad = (n) => String(n).padStart(2, "0");

/** Control characters and runs of whitespace become one space. */
function cleanText(text) {
  const flat = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f\s]+/gu, " ")
    .trim();
  const points = [...flat];
  return points.length > MAX_TEXT ? points.slice(0, MAX_TEXT).join("") : flat;
}

/**
 * Transcriber lines ({ timestamp, text }, timestamp = session ms) → sorted
 * [{ t_ms, text }], each text post-processed (Memory, script, punctuation)
 * and cleaned; empty ones dropped.
 */
function buildSentences(lines, postProcess) {
  return lines
    .map((line) => ({
      t_ms: Math.min(MAX_SESSION_MS, Math.max(0, Math.round(line.timestamp))),
      text: cleanText(postProcess(String(line.text ?? ""))),
    }))
    .filter((s) => s.text)
    .sort((a, b) => a.t_ms - b.t_ms)
    .map((s) => Object.freeze(s));
}

function hhmmss(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}${pad(Math.floor((s % 3600) / 60))}${pad(s % 60)}`;
}

/** "mm:ss", or "h:mm:ss" from an hour on. */
function clock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const rest = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return h > 0 ? `${h}:${rest}` : rest;
}

/** Block ids for sorted sentences: t + HHMMSS, "-2", "-3" … within one second. */
function blockIds(sentences) {
  const seen = new Map();
  return sentences.map((s) => {
    const base = `t${hhmmss(s.t_ms)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

function transcriptMarkdown({ session, sentences }) {
  const ids = blockIds(sentences);
  const lines = sentences.map((s, i) => `- [${clock(s.t_ms)}] ${s.text} ^${ids[i]}\n`);
  return `---\nsession: ${session}\nsource: cardputer\n---\n\n${lines.join("")}`;
}

function transcriptJson({ session, attempt, leadMs, sentences, stt }) {
  return Object.freeze({
    v: 1,
    session,
    attempt,
    lead_ms: leadMs,
    engine: { stt },
    sentences: sentences.map((s) => ({ t_ms: s.t_ms, text: s.text })),
  });
}

module.exports = { buildSentences, blockIds, clock, transcriptMarkdown, transcriptJson, cleanText };
