import { describe, it, expect } from "vitest";
import { repairLostPunctuation } from "./lost-punctuation.js";

// A friend's dictation, as Whisper Turbo pasted it: every "�" was a comma.
const REPORTED = "我的理解是只是一个储存数据的方法，方便查询�看这个数据有多大的影响�如果对实际生产造成影响的话�可以酌情调整";

describe("repairLostPunctuation", () => {
  it("puts the comma back where Whisper dropped a byte of it", () => {
    expect(repairLostPunctuation(REPORTED)).toBe(
      "我的理解是只是一个储存数据的方法，方便查询，看这个数据有多大的影响，如果对实际生产造成影响的话，可以酌情调整"
    );
  });

  it("treats a run of replacement characters (and spaces around it) as one lost mark", () => {
    expect(repairLostPunctuation("方便查询��看")).toBe("方便查询，看");
    expect(repairLostPunctuation("方便查询� �看")).toBe("方便查询，看");
    expect(repairLostPunctuation("方便查询 � 看")).toBe("方便查询，看");
  });

  it("uses the comma between Chinese and English words too", () => {
    expect(repairLostPunctuation("先装好React�然后再说")).toBe("先装好React，然后再说");
  });

  it("drops a lost mark at either end or next to real punctuation", () => {
    expect(repairLostPunctuation("你觉得呢�")).toBe("你觉得呢");
    expect(repairLostPunctuation("�你好")).toBe("你好");
    expect(repairLostPunctuation("好的。�明天见")).toBe("好的。明天见");
    expect(repairLostPunctuation("好的�。")).toBe("好的。");
  });

  it("drops it in English, keeping words apart", () => {
    expect(repairLostPunctuation("hello � world")).toBe("hello world");
    expect(repairLostPunctuation("hello� world")).toBe("hello world");
    expect(repairLostPunctuation("caf�")).toBe("caf");
  });

  it("returns nothing for a transcript that was only broken bytes", () => {
    expect(repairLostPunctuation("� �")).toBe("");
  });

  it("leaves clean text (and non-strings) exactly as they were", () => {
    expect(repairLostPunctuation("  提醒我开会，然后准备报告。 ")).toBe("  提醒我开会，然后准备报告。 ");
    expect(repairLostPunctuation("Call me at 5.")).toBe("Call me at 5.");
    expect(repairLostPunctuation(null as unknown as string)).toBe(null);
  });
});
