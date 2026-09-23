/**
 * Deterministic formatting applied after polish:
 *  - spoken enumerations (第一… 第二… 第三…) become a numbered list, the way
 *    other dictation tools lay them out;
 *  - short Chinese utterances that skip the LLM still get punctuation.
 */
import { describe, it, expect } from "vitest";
import { formatSpokenEnumeration, punctuateShortCjk } from "./format-dictation";

describe("formatSpokenEnumeration", () => {
  it("turns 第一/第二/第三 into a numbered list under the lead-in sentence", () => {
    // The owner's real dictation, as polish returned it.
    const polished =
      "然后我现在试试， 好不好用了？ 第一， 它好用； 第二， 它不太好用； 第三， 我觉得可以有进步的空间。";
    expect(formatSpokenEnumeration(polished)).toBe(
      "然后我现在试试， 好不好用了？\n1. 它好用\n2. 它不太好用\n3. 我觉得可以有进步的空间"
    );
  });

  it("handles a list with no lead-in and colon separators", () => {
    expect(formatSpokenEnumeration("第一：买菜。第二：做饭。")).toBe("1. 买菜\n2. 做饭");
  });

  it("needs at least two ordinals in order", () => {
    const one = "第一， 我们先把这个做完。";
    expect(formatSpokenEnumeration(one)).toBe(one);
    const outOfOrder = "第二， 先做这个； 第一， 再做那个。";
    expect(formatSpokenEnumeration(outOfOrder)).toBe(outOfOrder);
  });

  it("leaves ordinals used as words alone (第一次, 第二天)", () => {
    const text = "第一次去的时候下雨了， 第二天就晴了。";
    expect(formatSpokenEnumeration(text)).toBe(text);
  });

  it("turns first/second/third into a numbered list in English too", () => {
    expect(
      formatSpokenEnumeration(
        "Three things for tomorrow. First, reply to the investors. Second, review the pull request. Third, book the flight."
      )
    ).toBe("Three things for tomorrow.\n1. Reply to the investors\n2. Review the pull request\n3. Book the flight");
  });

  it("accepts firstly/secondly and colons", () => {
    expect(formatSpokenEnumeration("Firstly: ship it. Secondly: iterate.")).toBe("1. Ship it\n2. Iterate");
  });

  it("leaves a lone or out-of-order English ordinal alone", () => {
    const lone = "First, let me say thanks for coming.";
    expect(formatSpokenEnumeration(lone)).toBe(lone);
    const words = "The first time we met, the second one was better.";
    expect(formatSpokenEnumeration(words)).toBe(words);
  });
});

describe("punctuateShortCjk", () => {
  it("turns Whisper's pause spaces into commas and ends the sentence", () => {
    expect(punctuateShortCjk("做的怎么样啦 亲")).toBe("做的怎么样啦，亲。");
  });

  it("ends a question with a question mark", () => {
    expect(punctuateShortCjk("这会儿有空吗")).toBe("这会儿有空吗？");
    expect(punctuateShortCjk("你看是不是这样")).toBe("你看是不是这样？");
  });

  it("adds a full stop to a plain statement", () => {
    expect(punctuateShortCjk("现在测试一下花样感觉可以了")).toBe("现在测试一下花样感觉可以了。");
  });

  it("keeps a space between Chinese and an English word", () => {
    expect(punctuateShortCjk("把 PDF 发给我")).toBe("把 PDF 发给我。");
  });

  it("leaves text that already has punctuation, or no Chinese, alone", () => {
    expect(punctuateShortCjk("好的，谢谢。")).toBe("好的，谢谢。");
    expect(punctuateShortCjk("Thank you")).toBe("Thank you");
  });
});
