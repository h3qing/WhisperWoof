/**
 * Local meeting transcription, the pure parts (helpers/meetingLocalTranscription.js):
 * where a clip is cut, how a clip is split into pieces for SenseVoice, and how
 * a SenseVoice reply becomes timed sentences.
 */
import { createRequire } from "module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const {
  findLullCut,
  splitAtLulls,
  sentencesFromResult,
  rms,
} = require("../../../helpers/meetingLocalTranscription");
const { parseOfflineDetail } = require("../../../helpers/parakeetWsResult");

const SR = 16000;

/** Loud tone everywhere except quiet [from, to) seconds. */
function audioWithQuiet(totalS: number, quiet: Array<[number, number]>) {
  const out = new Float32Array(totalS * SR);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const isQuiet = quiet.some(([a, b]) => t >= a && t < b);
    out[i] = isQuiet ? 0.001 * Math.sin(i) : 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  return out;
}

describe("findLullCut", () => {
  it("cuts in the middle of the quietest stretch inside the window", () => {
    const audio = audioWithQuiet(150, [[130.0, 130.6]]);
    const cut = findLullCut(audio, SR, 120, 140) / SR;
    expect(cut).toBeGreaterThan(130.0);
    expect(cut).toBeLessThan(130.6);
  });

  it("ignores quiet stretches outside the window", () => {
    const audio = audioWithQuiet(150, [
      [110, 112],
      [133.0, 133.5],
    ]);
    const cut = findLullCut(audio, SR, 120, 140) / SR;
    expect(cut).toBeGreaterThan(133.0);
    expect(cut).toBeLessThan(133.5);
  });

  it("still returns a cut inside the window when nothing is quiet", () => {
    const audio = audioWithQuiet(150, []);
    const cut = findLullCut(audio, SR, 120, 140) / SR;
    expect(cut).toBeGreaterThanOrEqual(120);
    expect(cut).toBeLessThanOrEqual(140);
  });
});

describe("splitAtLulls", () => {
  it("keeps a short clip whole", () => {
    expect(splitAtLulls(audioWithQuiet(15, []), SR)).toEqual([[0, 15 * SR]]);
  });

  it("splits a long clip into pieces of at most 20 s, each ending at a lull between 12 and 20 s", () => {
    const audio = audioWithQuiet(60, [
      [15, 15.5],
      [31, 31.5],
      [47, 47.5],
    ]);
    const pieces = splitAtLulls(audio, SR);
    expect(pieces[0][0]).toBe(0);
    expect(pieces.at(-1)![1]).toBe(audio.length);
    pieces.forEach(([s, e], i) => {
      expect(e - s).toBeLessThanOrEqual(20 * SR);
      if (i > 0) expect(s).toBe(pieces[i - 1][1]);
    });
    expect(pieces[0][1] / SR).toBeGreaterThan(15);
    expect(pieces[0][1] / SR).toBeLessThan(15.5);
  });
});

describe("sentencesFromResult", () => {
  const reply = {
    text: "我们先看一下，这个问题。然后说第二件事！",
    tokens: [
      "我",
      "们",
      "先",
      "看",
      "一",
      "下",
      "，",
      "这",
      "个",
      "问",
      "题",
      "。",
      "然",
      "后",
      "说",
      "第",
      "二",
      "件",
      "事",
      "！",
    ],
    timestamps: [
      0.2, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.4, 1.5, 1.6, 1.7, 1.9, 3.1, 3.2, 3.4, 3.5, 3.6, 3.8, 3.9,
      4.0,
    ],
  };

  it("gives each sentence the time of its first token, offset by where the piece starts", () => {
    expect(sentencesFromResult(reply, 100)).toEqual([
      { startS: 100.2, text: "我们先看一下，这个问题。" },
      { startS: 103.1, text: "然后说第二件事！" },
    ]);
  });

  it("keeps a trailing sentence without an end mark", () => {
    const r = {
      text: "好的。那就这样",
      tokens: ["好", "的", "。", "那", "就", "这", "样"],
      timestamps: [0, 0.1, 0.2, 1, 1.1, 1.2, 1.3],
    };
    expect(sentencesFromResult(r, 0)).toEqual([
      { startS: 0, text: "好的。" },
      { startS: 1, text: "那就这样" },
    ]);
  });

  it("falls back to one line at the piece start when text and tokens disagree", () => {
    // ITN can rewrite the text (numbers), so its sentence marks may not match the tokens'.
    const r = {
      text: "价格是3.5元。好。",
      tokens: ["价", "格", "是", "三", "点", "五", "元"],
      timestamps: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1],
    };
    expect(sentencesFromResult(r, 10)).toEqual([{ startS: 10.5, text: "价格是3.5元。好。" }]);
  });

  it("keeps a piece whole when a decimal point makes text and tokens disagree", () => {
    const r = {
      text: "GPT 3.5 is fine. Yes.",
      tokens: ["▁GPT", "▁3", ".", "5", "▁is", "▁fine", ".", "▁Yes", "."],
      timestamps: [0, 0.2, 0.3, 0.4, 0.6, 0.8, 1.0, 2.0, 2.2],
    };
    const lines = sentencesFromResult(r, 0);
    expect(lines.map((l: { text: string }) => l.text)).toEqual(["GPT 3.5 is fine. Yes."]);
  });

  it("reads a raw sherpa-onnx reply as the server sends it", () => {
    const raw = JSON.stringify({
      lang: "<|zh|>",
      emotion: "<|NEUTRAL|>",
      event: "<|Speech|>",
      text: "好的。",
      timestamps: [0.72, 0.9, 1.02],
      durations: [],
      tokens: ["好", "的", "。"],
      words: [],
    });
    expect(sentencesFromResult(parseOfflineDetail(raw), 5)).toEqual([
      { startS: 5.72, text: "好的。" },
    ]);
    expect(parseOfflineDetail("not json")).toBeNull();
  });

  it("returns nothing for an empty reply", () => {
    expect(sentencesFromResult({ text: "  ", tokens: [], timestamps: [] }, 0)).toEqual([]);
    expect(sentencesFromResult(null, 0)).toEqual([]);
  });
});

describe("rms", () => {
  it("measures loudness", () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5);
  });
});
