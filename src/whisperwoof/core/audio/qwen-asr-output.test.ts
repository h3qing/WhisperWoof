import { describe, it, expect } from "vitest";
import { parseQwenAsrOutput, joinTranscripts } from "./qwen-asr-output.js";

describe("parseQwenAsrOutput", () => {
  it("drops the language prefix llama-server passes through", () => {
    expect(parseQwenAsrOutput("language Chinese<asr_text>好的，明天见。")).toEqual({
      text: "好的，明天见。",
      language: "chinese",
    });
    expect(parseQwenAsrOutput("language English<asr_text>See you tomorrow.")).toEqual({
      text: "See you tomorrow.",
      language: "english",
    });
  });

  it("joins the chunks of a long capture", () => {
    expect(parseQwenAsrOutput("language Chinese<asr_text>第一段，language Chinese<asr_text>第二段。").text).toBe(
      "第一段，第二段。"
    );
    expect(parseQwenAsrOutput("language English<asr_text>first part,language English<asr_text>second part").text).toBe(
      "first part, second part"
    );
  });

  it("is empty when the model heard no speech", () => {
    expect(parseQwenAsrOutput("language None<asr_text>")).toEqual({ text: "", language: null });
    expect(parseQwenAsrOutput("")).toEqual({ text: "", language: null });
    expect(parseQwenAsrOutput(undefined)).toEqual({ text: "", language: null });
  });

  it("normalizes numbers only in Chinese or Cantonese answers", () => {
    expect(parseQwenAsrOutput("language Japanese<asr_text>八百屋で買った").text).toBe("八百屋で買った");
    expect(parseQwenAsrOutput("language Cantonese<asr_text>二十八個人").text).toBe("28個人");
    expect(parseQwenAsrOutput("八百屋").text).toBe("八百屋");
  });

  it("writes spelled-out numbers in digits and repairs a broken mark", () => {
    expect(parseQwenAsrOutput("language Chinese<asr_text>一共二十八个人�十月三十一号前").text).toBe(
      "一共28个人，10月31号前"
    );
  });
});

describe("joinTranscripts", () => {
  it("joins Chinese pieces without a space and English ones with one", () => {
    expect(joinTranscripts(["第一段，", "第二段。"])).toBe("第一段，第二段。");
    expect(joinTranscripts(["first part.", "second part"])).toBe("first part. second part");
    expect(joinTranscripts(["先装好React", "然后再说"])).toBe("先装好React然后再说");
    expect(joinTranscripts(["", "只有这段", ""])).toBe("只有这段");
  });
});
