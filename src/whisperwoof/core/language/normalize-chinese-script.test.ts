import { describe, it, expect } from "vitest";
import {
  normalizeChineseScript,
  scriptForLanguage,
  resolveChineseScript,
} from "./normalize-chinese-script";

describe("normalizeChineseScript", () => {
  it("converts the Traditional output whisper-small produced on real human audio", () => {
    // eval/dictation-bench, real recording, whisper-small:auto
    expect(normalizeChineseScript("開放時間早上9點至下午5點")).toBe("开放时间早上9点至下午5点");
  });

  it("converts Traditional leaking into a code-switching transcript", () => {
    expect(
      normalizeChineseScript("這個模型在中英混合的場景下表現怎麼樣")
    ).toBe("这个模型在中英混合的场景下表现怎么样");
  });

  it("leaves already-Simplified text byte-identical", () => {
    const s = "这个方案我觉得整体思路是对的，但是成本估算那部分需要再仔细算一遍。";
    expect(normalizeChineseScript(s)).toBe(s);
  });

  it("does not corrupt correctly-Simplified text that has Traditional variants", () => {
    // Regression: the Taiwan-specific converter (`from: "tw"`) rewrites
    // 么 -> 幺, so it mangled transcripts that were already correct.
    expect(normalizeChineseScript("怎么样")).toBe("怎么样");
    expect(normalizeChineseScript("什么")).toBe("什么");
    expect(normalizeChineseScript("么")).toBe("么");
    expect(normalizeChineseScript("这个模型在中英混合的场景下表现怎么样")).toBe(
      "这个模型在中英混合的场景下表现怎么样"
    );
  });

  it("still simplifies the Traditional spelling of the same word", () => {
    expect(normalizeChineseScript("這個模型表現怎麼樣")).toBe("这个模型表现怎么样");
  });

  it("leaves English untouched", () => {
    const s = "Let me know if the deployment finished.";
    expect(normalizeChineseScript(s)).toBe(s);
  });

  it("preserves embedded English inside mixed dictation", () => {
    expect(normalizeChineseScript("先commit到local branch，等CI跑完再push上去")).toBe(
      "先commit到local branch，等CI跑完再push上去"
    );
  });

  it("is a no-op when disabled", () => {
    expect(normalizeChineseScript("開放時間", "off")).toBe("開放時間");
  });

  it("passes through empty and non-string input without throwing", () => {
    expect(normalizeChineseScript("")).toBe("");
    expect(normalizeChineseScript(null as unknown as string)).toBe(null);
    expect(normalizeChineseScript(undefined as unknown as string)).toBe(undefined);
  });
});

describe("scriptForLanguage", () => {
  it("leaves Traditional-script locales alone", () => {
    expect(scriptForLanguage("zh-TW")).toBe("off");
    expect(scriptForLanguage("zh-HK")).toBe("off");
    expect(scriptForLanguage("zh-Hant")).toBe("off");
  });

  it("defaults auto — the setting a zh/en bilingual user is on — to Simplified", () => {
    expect(scriptForLanguage("auto")).toBe("simplified");
    expect(scriptForLanguage(null)).toBe("simplified");
    expect(scriptForLanguage(undefined)).toBe("simplified");
  });

  it("resolves Simplified and non-Chinese locales to Simplified (a no-op for the latter)", () => {
    expect(scriptForLanguage("zh-CN")).toBe("simplified");
    expect(scriptForLanguage("en")).toBe("simplified");
  });

  it("is case-insensitive", () => {
    expect(scriptForLanguage("ZH-tw")).toBe("off");
  });
});

describe("resolveChineseScript", () => {
  it("keeps the dictation language as the most specific signal", () => {
    expect(resolveChineseScript("zh-TW", "en", "en-US")).toBe("off");
    expect(resolveChineseScript("zh-CN", "zh-TW", "zh-TW")).toBe("simplified");
  });

  it("recognizes a Traditional-script user on auto by their UI language", () => {
    // The whole point: a zh-TW user on the recommended auto setting must not
    // have Simplified forced onto their transcripts.
    expect(resolveChineseScript("auto", "zh-TW", "en-US")).toBe("off");
    expect(resolveChineseScript("auto", "zh-CN", "en-US")).toBe("simplified");
  });

  it("falls back to the OS locale when neither setting is Chinese", () => {
    expect(resolveChineseScript("auto", "en", "zh-TW")).toBe("off");
    expect(resolveChineseScript("auto", "en", "zh-Hant-TW")).toBe("off");
    expect(resolveChineseScript("auto", "en", "zh-HK")).toBe("off");
    expect(resolveChineseScript("auto", "en", "zh-CN")).toBe("simplified");
  });

  it("defaults to Simplified when no signal says Traditional", () => {
    expect(resolveChineseScript("auto", "en", "en-US")).toBe("simplified");
    expect(resolveChineseScript(null, undefined, undefined)).toBe("simplified");
  });

  it("does not let a zh-Hans OS locale masquerade as Traditional", () => {
    expect(resolveChineseScript("auto", "en", "zh-Hans-CN")).toBe("simplified");
  });
});
