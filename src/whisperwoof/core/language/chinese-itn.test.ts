import { describe, it, expect } from "vitest";
import { normalizeChineseNumbers, parseChineseCardinal } from "./chinese-itn.js";

const itn = normalizeChineseNumbers;

describe("parseChineseCardinal", () => {
  it("reads standard cardinals", () => {
    expect(parseChineseCardinal("十二")).toBe(12);
    expect(parseChineseCardinal("二十八")).toBe(28);
    expect(parseChineseCardinal("一百九十五")).toBe(195);
    expect(parseChineseCardinal("一千零五")).toBe(1005);
    expect(parseChineseCardinal("一千零五十")).toBe(1050);
    expect(parseChineseCardinal("两千")).toBe(2000);
    expect(parseChineseCardinal("二十四万")).toBe(240000);
    expect(parseChineseCardinal("三千万")).toBe(30000000);
    expect(parseChineseCardinal("两亿")).toBe(200000000);
  });

  it("reads the spoken short forms (一百二 = 120)", () => {
    expect(parseChineseCardinal("一百二")).toBe(120);
    expect(parseChineseCardinal("三千五")).toBe(3500);
    expect(parseChineseCardinal("两万五")).toBe(25000);
    expect(parseChineseCardinal("一百零二")).toBe(102);
  });

  it("refuses what isn't one number", () => {
    for (const run of ["三四十", "五六百", "一百二三十", "三七二十一", "一五一十", "千万", "万一", "百万", "万万", "两", "两十", "零五", "三四"]) {
      expect(parseChineseCardinal(run), run).toBeNull();
    }
  });
});

describe("normalizeChineseNumbers", () => {
  it("writes numbers of 10 and up in digits", () => {
    expect(itn("一共二十八个人")).toBe("一共28个人");
    expect(itn("烤箱开到四百二十度")).toBe("烤箱开到420度");
    expect(itn("排在第二十八和第二十九")).toBe("排在第28和第29");
    expect(itn("自己掏五十块钱")).toBe("自己掏50块钱");
    expect(itn("一百二左右就行")).toBe("120左右就行");
    expect(itn("住在中山路十二号")).toBe("住在中山路12号");
    expect(itn("考了一百分")).toBe("考了100分");
    expect(itn("两百块")).toBe("200块");
  });

  it("keeps 万 and 亿 the way they're typed", () => {
    expect(itn("现在有二十四万多")).toBe("现在有24万多");
    expect(itn("花了三千万")).toBe("花了3000万");
    expect(itn("十万人")).toBe("10万人");
    expect(itn("一万个理由")).toBe("1万个理由");
    expect(itn("两亿用户")).toBe("2亿用户");
    expect(itn("两万五的工资")).toBe("25000的工资");
  });

  it("writes numbers read digit by digit as digits", () => {
    expect(itn("邮编是一零零零八零")).toBe("邮编是100080");
    expect(itn("二零二六年")).toBe("2026年");
    expect(itn("尾号幺三八")).toBe("尾号138");
  });

  it("writes dates with a day in digits, but leaves a month on its own", () => {
    expect(itn("十月三十一号之前")).toBe("10月31号之前");
    expect(itn("三月五日开会")).toBe("3月5日开会");
    expect(itn("十一月二十六开始")).toBe("11月26开始");
    expect(itn("明年四月份")).toBe("明年四月份");
    expect(itn("到十二月")).toBe("到十二月");
    expect(itn("二零二六年十一月一日")).toBe("2026年11月1日");
    expect(itn("三个月二十天")).toBe("三个月20天");
    expect(itn("十二个月")).toBe("12个月");
  });

  it("writes times with minutes in digits", () => {
    expect(itn("下午三点二十到")).toBe("下午3点20到");
    expect(itn("三点五分")).toBe("3点5分");
    expect(itn("十二点十五分")).toBe("12点15分");
    expect(itn("三点半")).toBe("三点半");
    expect(itn("十点")).toBe("十点");
  });

  it("writes percentages with %", () => {
    expect(itn("涨了百分之三十")).toBe("涨了30%");
    expect(itn("百分之五的人")).toBe("5%的人");
    expect(itn("百分之百确定")).toBe("100%确定");
    expect(itn("百分之三点五")).toBe("3.5%");
    expect(itn("百分之零点五")).toBe("0.5%");
  });

  it("leaves small counts in characters", () => {
    for (const text of ["一个", "两天", "等一下", "一起去", "三个人", "第一", "十", "十分钟", "五块", "零下", "一天"]) {
      expect(itn(text), text).toBe(text);
    }
  });

  it("leaves idioms and set phrases alone", () => {
    for (const text of [
      "这个十分重要",
      "千万别忘了",
      "万一下雨",
      "一五一十地说",
      "不管三七二十一",
      "九九八十一难",
      "百万富翁",
      "千千万万",
      "万万没想到",
      "差了十万八千里",
      "五十步笑百步",
      "三十而立",
      "十八般武艺",
      "十二生肖",
      "十一假期",
      "十一长假去哪",
      "一点一点地来",
      "三分之一",
    ]) {
      expect(itn(text), text).toBe(text);
    }
  });

  it("leaves approximate numbers alone", () => {
    for (const text of ["三四个", "七八个人", "三五天", "两三个", "三四十个", "五六百块", "十几个", "几十个", "二十几岁", "一一回复"]) {
      expect(itn(text), text).toBe(text);
    }
  });

  it("leaves digits, English and text without numbers as they are", () => {
    for (const text of ["React 18", "H1B 签证", "iOS 26", "好的，明天见。", ""]) {
      expect(itn(text), text).toBe(text);
    }
    expect(itn("iPhone十五")).toBe("iPhone15");
  });

  it("never reads 一点 / 这一点 as a time (a point, a bit)", () => {
    for (const text of [
      "这一点十分重要",
      "有一点十分奇怪",
      "第三点十分关键",
      "差一点十分钟就到了",
      "第二点二十个人都同意",
      "这一点二十分钟讲不完",
      "十点到十一点",
    ]) {
      expect(itn(text), text).toBe(text);
    }
    expect(itn("两点二十分")).toBe("2点20分");
  });

  it("writes decimals before 亿 / 万 / 倍 / 个百分点 whole, and never half a decimal", () => {
    expect(itn("融资三点五亿")).toBe("融资3.5亿");
    expect(itn("一点二万人")).toBe("1.2万人");
    expect(itn("增长了二十点五个百分点")).toBe("增长了20.5个百分点");
    expect(itn("翻了一点五倍")).toBe("翻了1.5倍");
    expect(itn("二十一点五")).toBe("二十一点五");
  });

  it("leaves doubled numerals, weekday lists and set phrases alone", () => {
    for (const text of [
      "忘得七七八八",
      "三三五五",
      "周一三五",
      "星期二四六有课",
      "九一八事变",
      "一二三木头人",
      "初一十五",
      "十万火急",
      "这人真是二百五",
      "三百六十行",
      "十一去哪玩",
      "一月一次",
      "百分之五十几",
      "百分之十几",
    ]) {
      expect(itn(text), text).toBe(text);
    }
  });

  it("reads Traditional 兩 / 萬 / 億", () => {
    expect(itn("一千兩百")).toBe("1200");
    expect(itn("三萬五千")).toBe("35000");
    expect(itn("兩億")).toBe("2億");
  });

  it("passes non-strings through", () => {
    expect(itn(null as unknown as string)).toBeNull();
    expect(itn(undefined as unknown as string)).toBeUndefined();
  });
});
