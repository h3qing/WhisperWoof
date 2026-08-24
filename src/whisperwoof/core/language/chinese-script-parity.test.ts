/**
 * Parity suite: the renderer and main-process copies of the Chinese script
 * normalizer must behave identically.
 *
 * The logic exists twice on purpose — Vite cannot bundle a project-local CJS
 * module into the renderer graph (it ships a bare `module.exports` that throws
 * at chunk load), so `core/language/normalize-chinese-script.ts` (ESM,
 * renderer) and `bridge/chinese-script.js` (CJS, main process) each carry
 * their own copy. This suite is what keeps them from drifting: it runs every
 * behavioral case through both implementations and requires identical output.
 * If you change one file, this suite fails until you change the other.
 */
import { describe, it, expect } from "vitest";
import * as renderer from "./normalize-chinese-script";
import * as main from "../../bridge/chinese-script.js";

type Impl = {
  normalizeChineseScript: (text: string, target?: "simplified" | "off") => string;
  scriptForLanguage: (language: string | null | undefined) => "simplified" | "off";
};

const impls: Array<[string, Impl]> = [
  ["renderer (ESM)", renderer as Impl],
  ["main (CJS)", main as unknown as Impl],
];

const NORMALIZE_CASES: Array<[string, "simplified" | "off" | undefined]> = [
  // Traditional output whisper-small produced on real human audio
  ["開放時間早上9點至下午5點", undefined],
  // Traditional leaking into a code-switching transcript
  ["這個模型在中英混合的場景下表現怎麼樣", undefined],
  // 么/幺 regression: correctly-Simplified text with Taiwan-variant hazards
  ["怎么样", undefined],
  ["什么", undefined],
  // already-Simplified text must be byte-identical
  ["这个方案我觉得整体思路是对的，但是成本估算那部分需要再仔细算一遍。", undefined],
  // English and mixed dictation
  ["Let me know if the deployment finished.", undefined],
  ["先commit到local branch，等CI跑完再push上去", undefined],
  // disabled
  ["開放時間", "off"],
  // empty
  ["", undefined],
];

const LANGUAGE_CASES = ["auto", "zh-CN", "zh-TW", "zh-HK", "zh-Hant", "ZH-tw", "en", "", null, undefined];

describe("chinese-script parity between renderer and main process", () => {
  it("normalizeChineseScript agrees on every case", () => {
    for (const [text, target] of NORMALIZE_CASES) {
      const a = renderer.normalizeChineseScript(text, target);
      const b = main.normalizeChineseScript(text, target);
      expect(b, `normalize(${JSON.stringify(text)}, ${target})`).toBe(a);
    }
  });

  it("scriptForLanguage agrees on every case", () => {
    for (const lang of LANGUAGE_CASES) {
      const a = renderer.scriptForLanguage(lang);
      const b = main.scriptForLanguage(lang);
      expect(b, `scriptForLanguage(${JSON.stringify(lang)})`).toBe(a);
    }
  });

  it("both fix the measured defect and neither corrupts correct text", () => {
    for (const [name, impl] of impls) {
      expect(impl.normalizeChineseScript("開放時間早上9點至下午5點"), name).toBe(
        "开放时间早上9点至下午5点"
      );
      expect(impl.normalizeChineseScript("怎么样"), name).toBe("怎么样");
    }
  });
});
