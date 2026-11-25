import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { capturePieces, maxTokensFor } = require("../../../helpers/qwenAsr.js");

const RATE = 16000;
// Speech everywhere except a 1 s pause at `pauseAt` seconds.
function capture(seconds: number, pauseAt: number) {
  return Float32Array.from({ length: seconds * RATE }, (_, i) =>
    i >= pauseAt * RATE && i < (pauseAt + 1) * RATE ? 0 : 0.2 * Math.sin(i / 3)
  );
}

describe("Qwen3-ASR capture pieces (the context holds ~8 min of audio)", () => {
  it("sends up to 5 minutes as one piece", () => {
    expect(capturePieces(capture(290, 100))).toEqual([[0, 290 * RATE]]);
  });

  it("cuts a longer capture at its pause", () => {
    const pieces = capturePieces(capture(400, 250));
    expect(pieces).toHaveLength(2);
    expect(pieces[0][1] / RATE).toBeGreaterThan(250);
    expect(pieces[0][1] / RATE).toBeLessThan(251);
    expect(pieces[1][1]).toBe(400 * RATE);
  });

  it("folds a short tail into the piece before it", () => {
    expect(capturePieces(capture(310, 295))).toEqual([[0, 310 * RATE]]);
  });

  it("gives a piece room for its text, never more than the context", () => {
    expect(maxTokensFor(44 + 5 * 32000)).toBe(114);
    expect(maxTokensFor(44 + 330 * 32000)).toBeLessThanOrEqual(4096);
  });
});
