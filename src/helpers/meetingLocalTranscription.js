/**
 * Local meeting transcription, the pure parts: where a clip is cut, how a
 * clip is split into pieces for an offline model (SenseVoice), and how the
 * model's reply becomes timed sentences.
 *
 * Measured on eval/meeting-bench (bench-a): cutting at the quietest moment
 * keeps sentences whole where fixed-time cuts split them, and needs no
 * silence threshold, which real rooms' noise floors defeat.
 */
const { analyzeFrames } = require("../whisperwoof/bridge/vad");

const FRAME_S = 0.03;

function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

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

/**
 * Sample index of the middle of the quietest `spanMs` between `fromS` and
 * `toS` seconds into `samples`.
 */
function findLullCut(samples, sampleRate, fromS, toS, spanMs = 400) {
  const from = Math.round(fromS * sampleRate);
  const to = Math.min(samples.length, Math.round(toS * sampleRate));
  const frameSizeSamples = Math.round(sampleRate * FRAME_S);
  const frames = analyzeFrames(samples.subarray(from, to), sampleRate, { frameSizeSamples });
  if (!frames.length) return from;
  const span = Math.max(1, Math.ceil(spanMs / 1000 / FRAME_S));
  const first = quietestSpanStart(frames, span);
  return from + frames[Math.min(frames.length - 1, first + Math.floor(span / 2))].startSample;
}

/**
 * [start, end) sample ranges of at most `maxS` seconds covering `samples`,
 * each ending at the quietest moment between `minS` and `maxS`.
 */
function splitAtLulls(samples, sampleRate, { minS = 12, maxS = 20, spanMs = 300 } = {}) {
  const pieces = [];
  let start = 0;
  while (samples.length - start > maxS * sampleRate) {
    const cut = start + findLullCut(samples.subarray(start), sampleRate, minS, maxS, spanMs);
    pieces.push([start, cut]);
    start = cut;
  }
  pieces.push([start, samples.length]);
  return pieces;
}

// Sentence ends: CJK marks, and ASCII ?/!/. when followed by a space or the end
// (so decimals like 3.5 don't end a sentence).
const TEXT_SENTENCE_END = /[。？！]|[?!.](?=\s|$)/g;
const TOKEN_SENTENCE_END = /^[。？！?!.]$/;

function splitSentences(text) {
  const out = [];
  let last = 0;
  for (const match of text.matchAll(TEXT_SENTENCE_END)) {
    const end = match.index + match[0].length;
    out.push(text.slice(last, end));
    last = end;
  }
  out.push(text.slice(last));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Index of the first token of each token sentence (tokens split at sentence ends). */
function tokenSentenceStarts(tokens) {
  const starts = [];
  let open = false;
  tokens.forEach((token, i) => {
    const isEnd = TOKEN_SENTENCE_END.test(String(token).trim());
    if (!open && !isEnd) {
      starts.push(i);
      open = true;
    }
    if (isEnd) open = false;
  });
  return starts;
}

/**
 * Sentences of a sherpa-onnx offline reply ({ text, tokens, timestamps }),
 * each with the time of its first token, offset by where the piece starts.
 * The text has ITN applied and the tokens don't, so they are paired sentence
 * by sentence; when the counts disagree the whole text is one line at the
 * piece's first token.
 */
function sentencesFromResult(result, offsetS) {
  const text = String(result?.text || "").trim();
  if (!text) return [];
  const tokens = result.tokens || [];
  const times = result.timestamps || [];
  const sentences = splitSentences(text);
  const starts = tokenSentenceStarts(tokens);
  const at = (tokenIndex) => +(offsetS + (times[tokenIndex] ?? 0)).toFixed(3);
  if (sentences.length === starts.length) {
    return sentences.map((sentence, i) => ({ startS: at(starts[i]), text: sentence }));
  }
  return [{ startS: at(starts[0] ?? 0), text }];
}

module.exports = { rms, findLullCut, splitAtLulls, sentencesFromResult };
