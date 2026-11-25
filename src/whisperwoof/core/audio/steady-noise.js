/**
 * Noise that Qwen3-ASR turns into made-up sentences.
 *
 * Steady noise above about -50 dBFS (a fan, a room) gets past the renderer's
 * speech gate, and Qwen3-ASR answers it with "language None" or with a
 * made-up question in Portuguese or Spanish ("O que é que é mais importante
 * para você?"): 29 of 60 noise-only clips (brown, pink, white; -50 to -23
 * dBFS), never Chinese or English. Digital silence gets a made-up Chinese
 * sentence.
 *
 * Speech rises and falls; noise doesn't. The level spread of a capture
 * (p90 − p10 of its 100 ms window levels) is at least 12.7 dB on the 200
 * real dictations in eval/real-dictation (median 34 dB), 0–6 dB on noise —
 * but speech under loud noise (-33 dBFS) shrinks to 1.4–5 dB too, so a
 * spread alone can't drop a capture without dropping real dictation. Hence:
 *
 * - when even the loudest window is within 1 dB of the quiet ones (digital
 *   silence, hum, hiss) there is nothing to decode — the loudest, so one
 *   short word in a long quiet capture still counts;
 * - below a 6 dB spread, text in a language the user doesn't dictate in is
 *   the made-up kind (isNoiseHallucination).
 *
 * Main-process module (CommonJS).
 */
const WINDOW_SECONDS = 0.1;
const MIN_WINDOWS = 5;
const STEADY_RANGE_DB = 1;
const NOISY_RANGE_DB = 6;
const FLOOR_DB = -120;

// Always expected: the languages WhisperWoof is built for.
const HOME_LANGUAGES = ["zh", "en", "yue"];
// Qwen3-ASR's language names ("language Portuguese<asr_text>…") as codes.
const LANGUAGE_CODES = {
  chinese: "zh", english: "en", cantonese: "yue", japanese: "ja", korean: "ko", arabic: "ar",
  german: "de", french: "fr", spanish: "es", portuguese: "pt", indonesian: "id", italian: "it",
  russian: "ru", thai: "th", vietnamese: "vi", turkish: "tr", hindi: "hi", malay: "ms",
  dutch: "nl", swedish: "sv", danish: "da", finnish: "fi", polish: "pl", czech: "cs",
  filipino: "fil", persian: "fa", greek: "el", hungarian: "hu", macedonian: "mk", romanian: "ro",
};

/**
 * { spreadDb: p90 − p10, peakDb: loudest − p10 } of a capture's 100 ms
 * window levels, in dB; null when it's too short to judge.
 */
function levelStats(samples, sampleRate) {
  const size = Math.round(sampleRate * WINDOW_SECONDS);
  const levels = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    let sum = 0;
    for (let i = start; i < start + size; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / size);
    levels.push(rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB);
  }
  if (levels.length < MIN_WINDOWS) return null;
  const sorted = [...levels].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { spreadDb: at(0.9) - at(0.1), peakDb: sorted[sorted.length - 1] - at(0.1) };
}

/** Level spread of a capture: p90 − p10 of its 100 ms window levels, in dB (null when too short). */
function levelRangeDb(samples, sampleRate) {
  return levelStats(samples, sampleRate)?.spreadDb ?? null;
}

/** Nothing but a constant level (levelStats): no point decoding it. */
function isSteadyNoise(stats) {
  return stats != null && stats.peakDb < STEADY_RANGE_DB;
}

/**
 * Text the model made up for noise: the capture is mostly noise and the
 * model heard a language the user doesn't dictate in. `userLanguages` are
 * base codes (the pinned dictation language, the UI language).
 */
function isNoiseHallucination({ rangeDb, language, userLanguages = [] }) {
  if (rangeDb === null || rangeDb >= NOISY_RANGE_DB || !language) return false;
  const code = LANGUAGE_CODES[String(language).toLowerCase()];
  if (!code) return false;
  const expected = new Set([...HOME_LANGUAGES, ...userLanguages.filter(Boolean).map((l) => l.split("-")[0])]);
  return !expected.has(code);
}

module.exports = { levelStats, levelRangeDb, isSteadyNoise, isNoiseHallucination };
