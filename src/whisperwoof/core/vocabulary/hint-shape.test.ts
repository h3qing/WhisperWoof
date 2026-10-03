/**
 * A Memory or Dictionary word is a term, never a clause. Auto-learn splits
 * text on spaces, and Chinese has none, so editing a pasted Chinese
 * dictation used to store the whole clause as a "word". Sent to Whisper as
 * hints, those clauses made it write English speech in Chinese.
 */
import { describe, it, expect } from "vitest";
import { isChineseClause } from "./hint-shape";

describe("isChineseClause", () => {
  it("flags Chinese clauses like the ones auto-learn stored as words (v2.8.0)", () => {
    for (const text of [
      "不用管这个url的跳转的时间",
      "我打算明天上午和david开会之后",
      "我在上海的课都是一节一节的",
      "有没有别的办法可以找到xin'shou'jiao'cheng的入口吧",
      "然后有些地方这样不会太难看",
    ]) {
      expect(isChineseClause(text)).toBe(true);
    }
  });

  it("flags short clauses by their particles and pronouns", () => {
    for (const text of ["看一下这个问题", "明天再继续吧", "帮我发给他"]) {
      expect(isChineseClause(text)).toBe(true);
    }
  });

  it("flags a long run with no particle", () => {
    expect(isChineseClause("明天下午三点开会讨论明年预算")).toBe(true);
  });

  it("keeps Chinese names and terms, long ones included", () => {
    for (const text of [
      "上海",
      "王小明",
      "通义千问",
      "中华人民共和国",
      "微信公众号",
      "国家发展和改革委员会",
      "中国科学院自动化研究所",
      "我的电脑",
    ]) {
      expect(isChineseClause(text)).toBe(false);
    }
  });

  it("keeps Japanese and Korean terms (only Chinese characters count)", () => {
    for (const text of ["コミュニケーション", "プロジェクトマネージャー", "삼성전자 반도체 사업부"]) {
      expect(isChineseClause(text)).toBe(false);
    }
  });

  it("keeps Latin words and phrases, and ignores non-strings", () => {
    for (const text of ["Supabase", "be based", "paragraph", "Sinead Kubernetes", "", null, undefined, 42]) {
      expect(isChineseClause(text as string)).toBe(false);
    }
  });
});
