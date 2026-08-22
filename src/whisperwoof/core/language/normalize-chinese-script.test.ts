import { describe, it, expect } from "vitest";
import { normalizeChineseScript, scriptForLanguage } from "./normalize-chinese-script";

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
