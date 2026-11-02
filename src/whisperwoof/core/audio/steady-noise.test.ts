import { describe, it, expect } from "vitest";
import { levelRangeDb, levelStats, isSteadyNoise, isNoiseHallucination } from "./steady-noise.js";

const RATE = 16000;
// Deterministic noise so the test never flakes.
function noise(seconds: number, amplitude: number, seed = 1) {
  let x = seed;
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return (x / 2147483648 - 0.5) * 2 * amplitude;
  });
}
// Syllables: 200 ms of tone, 100 ms of near-silence, over a noise floor.
function speechLike(seconds: number, floor = 0.002) {
  const base = noise(seconds, floor, 7);
  return base.map((v, i) => (i % 4800 < 3200 ? v + 0.2 * Math.sin((2 * Math.PI * 220 * i) / RATE) : v));
}
const range = (x: Float32Array) => levelRangeDb(x, RATE);
const steady = (x: Float32Array) => isSteadyNoise(levelStats(x, RATE));
// A word of `wordSeconds` at the start of a quiet capture.
function shortWord(seconds: number, wordSeconds: number, floor = 0.002) {
  return noise(seconds, floor).map((v, i) => (i < wordSeconds * RATE ? v + 0.2 * Math.sin(i / 3) : v));
}

describe("levelStats / isSteadyNoise", () => {
  it("finds no level change in digital silence or hiss", () => {
    expect(steady(new Float32Array(3 * RATE))).toBe(true);
    expect(steady(noise(4, 0.03))).toBe(true);
    expect(steady(noise(2, 0.003))).toBe(true);
  });

  it("keeps speech, even over loud noise", () => {
    expect(range(speechLike(3))).toBeGreaterThan(30);
    expect(steady(speechLike(3))).toBe(false);
    expect(steady(speechLike(3, 0.06))).toBe(false);
  });

  it("keeps one short word, however long the quiet around it", () => {
    expect(steady(shortWord(1.5, 0.3, 0.001))).toBe(false);
    expect(steady(shortWord(5, 0.4))).toBe(false);
    expect(steady(shortWord(20, 0.3))).toBe(false);
    // The spread of most windows says "noise"; the loudest one says "a word".
    expect(range(shortWord(20, 0.3))).toBeLessThan(1);
  });

  it("decides nothing on a capture too short to judge", () => {
    expect(levelStats(new Float32Array(RATE / 10), RATE)).toBeNull();
    expect(range(new Float32Array(RATE / 10))).toBeNull();
    expect(isSteadyNoise(null)).toBe(false);
  });
});

describe("isNoiseHallucination", () => {
  it("drops a Portuguese or Spanish sentence made up for fan noise", () => {
    expect(isNoiseHallucination({ rangeDb: 3.5, language: "portuguese" })).toBe(true);
    expect(isNoiseHallucination({ rangeDb: 5.4, language: "Spanish", userLanguages: ["en"] })).toBe(true);
  });

  it("keeps Chinese and English heard through noise", () => {
    expect(isNoiseHallucination({ rangeDb: 2, language: "chinese" })).toBe(false);
    expect(isNoiseHallucination({ rangeDb: 2, language: "english" })).toBe(false);
  });

  it("keeps the language the user dictates in or reads the app in", () => {
    expect(isNoiseHallucination({ rangeDb: 3, language: "spanish", userLanguages: ["es"] })).toBe(false);
    expect(isNoiseHallucination({ rangeDb: 3, language: "portuguese", userLanguages: [null, "pt-BR"] })).toBe(false);
  });

  it("keeps anything said over a level that rises and falls like speech", () => {
    expect(isNoiseHallucination({ rangeDb: 12, language: "portuguese" })).toBe(false);
    expect(isNoiseHallucination({ rangeDb: null, language: "portuguese" })).toBe(false);
  });

  it("keeps text whose language the model didn't name", () => {
    expect(isNoiseHallucination({ rangeDb: 2, language: null })).toBe(false);
    expect(isNoiseHallucination({ rangeDb: 2, language: "klingon" })).toBe(false);
  });
});
