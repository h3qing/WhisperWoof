import { describe, it, expect } from "vitest";
import { normalizeCjkPunctuation } from "./normalize-cjk-punctuation";

describe("normalizeCjkPunctuation", () => {
  it("leaves English-only text untouched", () => {
    const en = "Remind me to call the dentist tomorrow at 3 pm.";
    expect(normalizeCjkPunctuation(en)).toBe(en);
  });

  it("adds a space after full-width punctuation the model already produced", () => {
    expect(normalizeCjkPunctuation("提醒我明天下午三点开会，然后准备季度报告。")).toBe(
      "提醒我明天下午三点开会， 然后准备季度报告。"
    );
  });

  it("converts half-width comma/period in Chinese context to full-width + space", () => {
    expect(normalizeCjkPunctuation("提醒我开会,然后准备报告.")).toBe(
      "提醒我开会， 然后准备报告。"
    );
  });

  it("converts question and exclamation marks", () => {
    expect(normalizeCjkPunctuation("你觉得呢?太好了!我们开始吧")).toBe(
      "你觉得呢？ 太好了！ 我们开始吧"
    );
  });

  it("does not add a trailing space at the end of the string", () => {
    const out = normalizeCjkPunctuation("结束。");
    expect(out).toBe("结束。");
    expect(out.endsWith(" ")).toBe(false);
  });

  it("preserves decimals, times, emails, and URLs (punctuation not Han-adjacent)", () => {
    expect(normalizeCjkPunctuation("价格是3.14元，时间5:30开始")).toBe(
      "价格是3.14元， 时间5:30开始"
    );
    expect(normalizeCjkPunctuation("发到john@acme.com，地址https://a.com/x")).toBe(
      "发到john@acme.com， 地址https://a.com/x"
    );
  });

  it("only touches Han-adjacent punctuation in mixed CN/EN text", () => {
    // The English clause's period stays English; the Chinese comma is normalized.
    expect(normalizeCjkPunctuation("先看 README.md,再问我")).toBe(
      "先看 README.md， 再问我"
    );
  });

  it("does not double-space when a space already follows", () => {
    expect(normalizeCjkPunctuation("开会， 然后")).toBe("开会， 然后");
  });

  it("is idempotent", () => {
    const once = normalizeCjkPunctuation("提醒我开会,然后准备报告.你觉得呢?");
    expect(normalizeCjkPunctuation(once)).toBe(once);
  });

  it("keeps a ？！ run tight with a single trailing space", () => {
    expect(normalizeCjkPunctuation("真的吗？！我不信")).toBe("真的吗？！ 我不信");
  });

  it("handles non-string input defensively", () => {
    expect(normalizeCjkPunctuation(null)).toBe(null);
  });
});
