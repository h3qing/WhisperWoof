/**
 * Chinese inverse text normalization: spelled-out numbers → digits.
 *
 * Qwen3-ASR writes every number in characters (三十一, 四八五, 百分之三十)
 * where people type digits, and that is most of what it still gets wrong on
 * real dictations (eval/real-dictation/RESULTS.md). This writes them the
 * way they're usually typed, and errs towards leaving text alone:
 *
 * - a number of 10 or more, read as one number: 二十八个 → 28个, 一百二 → 120,
 *   三千万 → 3000万;
 * - three or more digits read one by one: 一零零零八零 → 100080, 二零二六年;
 * - a date with a day, both parts: 十月三十一号 → 10月31号 (a month on its
 *   own, 四月份, stays);
 * - a time with minutes, both parts: 三点二十 → 3点20, 三点五分 → 3点5分;
 * - a decimal before 亿 / 万 / 倍 / 个百分点: 三点五亿 → 3.5亿;
 * - percentages: 百分之三点五 → 3.5%.
 *
 * Left alone: small counts (一个, 两天), anything that isn't exactly one
 * number (三四个, 三四十, 七七八八, 三七二十一), numbers next to 几, a number
 * next to 点 that isn't a time or a decimal (这一点十分重要), weekday lists
 * (周一三五), lunar days (初一十五) and idioms (十分, 千万, 万一, 十万八千里,
 * 二百五, 十一假期…). Callers run it on Chinese text only.
 *
 * Main-process module (CommonJS), like lost-punctuation.js.
 */

const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const SPELLED_DIGIT = { ...DIGIT, 幺: 1 };
const UNIT = { 十: 10, 百: 100, 千: 1000 };
const BIG_UNIT = { 万: 1e4, 萬: 1e4, 亿: 1e8, 億: 1e8 };
const NUMERAL = "零〇一幺二两兩三四五六七八九十百千万萬亿億";

const NUMERAL_RUN = new RegExp(`[${NUMERAL}]+`, "g");
const HAS_NUMERAL = new RegExp(`[${NUMERAL}]`);
const SPELLED_DIGITS = /^[零〇一幺二三四五六七八九]{3,}$/;
const DOUBLED = /^(.)\1(.)\2$/; // 七七八八, 三三五五
const PERCENT = new RegExp(`百分之(百|[零〇一二两兩三四五六七八九十百千万萬]+)(?:点([零〇一二三四五六七八九]+))?(?![几多${NUMERAL}])`, "g");
// After these a numeral run is a weekday list or a lunar day (周一三五, 初一).
const LIST_BEFORE = new Set(["周", "期", "拜", "初"]);
// Before 点 these make it "a point" or "a bit" (这一点, 第三点, 有一点), not a time.
const NOT_AN_HOUR_AFTER = new Set(["这", "那", "哪", "第", "有", "差", "每", "些", "一"]);
// What a decimal X点Y is followed by (三点五亿, 一点五倍, 二十点五个百分点).
const DECIMAL_UNIT = /^(?:[万萬亿億]|倍|个百分点)/;
// A count, not a day of the month (一月一次, 三月五个).
const NOT_A_DAY_BEFORE = /^[个多几次遍趟回天年周些下]/;

// Set phrases whose numbers aren't quantities. Matched against the whole
// text; a number inside one is never converted.
const PROTECTED = [
  /十万八千里/g,
  /十万火急/g,
  /五十步笑百步/g,
  /三百六十行/g,
  /二百五(?![零〇一二三四五六七八九十百千万])/g,
  /十八般/g,
  /十八罗汉/g,
  /三十而立/g,
  /四十不惑/g,
  /五十知天命/g,
  /三十六计/g,
  /七十二变/g,
  /二十四节气/g,
  /十二生肖/g,
  /十二星座/g,
  /一二三木头人/g,
  /九一八(?=事变)/g,
  /十一(?=假|长假|黄金周|国庆|期间|放假|去|出去)/g,
];

/** One section below 10 000 (三千零五, 二十八, 一百二), or null. */
function parseSection(chars, leading) {
  let value = 0;
  let lastUnit = 10000;
  let afterZero = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (c === "零" || c === "〇") {
      // Only between two parts: 一千零五.
      if (i === 0 || next === undefined || afterZero) return null;
      afterZero = true;
      continue;
    }
    if (c === "十" && i === 0 && leading) {
      // 十二, 十万: a bare 十 starts the whole number or nothing.
      value += 10;
      lastUnit = 10;
      continue;
    }
    if (!(c in DIGIT)) return null;
    const digit = DIGIT[c];
    const isLiang = c === "两" || c === "兩";
    if (next in UNIT) {
      const unit = UNIT[next];
      if (unit >= lastUnit || (isLiang && unit === 10)) return null;
      value += digit * unit;
      lastUnit = unit;
      afterZero = false;
      i++;
      continue;
    }
    if (next !== undefined || isLiang || lastUnit === 1) return null;
    // The last digit: ones, or the spoken short form (一百二 = 120).
    const shortForm = !afterZero && i > 0 && lastUnit >= 100;
    value += shortForm ? digit * (lastUnit / 10) : digit;
    lastUnit = 1;
  }
  return value;
}

/**
 * A run of numeral characters read as exactly one cardinal (二十四万, 两万五,
 * 一千零五), or null when it isn't one (三四十, 千万, 一五一十).
 */
function parseChineseCardinal(run) {
  if (typeof run !== "string" || !run) return null;
  let total = 0;
  let rest = run;
  let leading = true;
  for (const [bigs, scale] of [[["亿", "億"], 1e8], [["万", "萬"], 1e4]]) {
    const at = Math.max(...bigs.map((b) => rest.indexOf(b)));
    if (at === -1) continue;
    const head = rest.slice(0, at);
    // 两万, 三亿: a lone digit (两 included) before 万/亿 is fine.
    const value = head.length === 1 && head in DIGIT && DIGIT[head] > 0 ? DIGIT[head] : parseSection(head, leading);
    if (!value) return null;
    total += value * scale;
    rest = rest.slice(at + 1);
    leading = false;
    // 两万五 = 25 000: one digit right after 万 counts thousands.
    if (scale === 1e4 && rest.length === 1 && rest in DIGIT && DIGIT[rest] > 0) {
      return total + DIGIT[rest] * 1000;
    }
  }
  if (!rest) return total || null;
  const low = parseSection(rest, leading);
  return low === null || (leading && low === 0) ? null : total + low;
}

function formatCardinal(value, run) {
  const big = (simplified, traditional) => (run.includes(traditional) ? traditional : simplified);
  if (/[万萬亿億]/.test(run) && value % 1e8 === 0) return `${value / 1e8}${big("亿", "億")}`;
  if (/[万萬亿億]/.test(run) && value % 1e4 === 0 && value < 1e8) return `${value / 1e4}${big("万", "萬")}`;
  return String(value);
}

const spelledDigits = (run) => [...run].map((c) => SPELLED_DIGIT[c]).join("");

/** A run as a small number (0–59) for a date or time part, or null. 两 only when `liang`. */
function smallNumber(run, { liang = false } = {}) {
  if (run === "十") return 10;
  if (run.length === 1) {
    const isLiang = run === "两" || run === "兩";
    return run in DIGIT && (liang || !isLiang) ? DIGIT[run] : null;
  }
  return parseChineseCardinal(run);
}

function protectedSpans(text) {
  return PROTECTED.flatMap((re) => [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]));
}

function convertPercent(text) {
  return text.replace(PERCENT, (whole, int, frac) => {
    const value = int === "百" ? 100 : int.length === 1 ? smallNumber(int) : parseChineseCardinal(int);
    if (value === null) return whole;
    return `${value}${frac ? `.${spelledDigits(frac)}` : ""}%`;
  });
}

/** Text split into numeral runs and the text between them. */
function tokenize(text) {
  const tokens = [];
  let last = 0;
  for (const m of text.matchAll(NUMERAL_RUN)) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), start: last });
    tokens.push({ text: m[0], start: m.index, run: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), start: last });
  return tokens;
}

/** Longest end of a run that reads as a number in [min, max]: 四八五十 → 十 for a month. */
function partSuffix(run, min, max, options) {
  for (let len = Math.min(3, run.length); len >= 1; len--) {
    const value = smallNumber(run.slice(-len), options);
    if (value !== null && value >= min && value <= max) return { head: run.slice(0, -len), value };
  }
  return null;
}

// X点Y before 亿 / 万 / 倍 / 个百分点: one decimal (三点五亿 → 3.5亿).
function decimalAt(first, second, afterText) {
  const match = second.text.match(/^([零〇一二三四五六七八九]+)([万萬亿億]?)$/);
  if (!match || !(match[2] || DECIMAL_UNIT.test(afterText))) return null;
  const whole = first.text === "零" ? 0 : smallNumber(first.text, { liang: true });
  return whole === null ? null : { head: "", out: `${whole}.${spelledDigits(match[1])}${match[2]}` };
}

// 三点二十, 三点五分: a time, unless 点 is "a point" or "a bit" (这一点十分重要).
function timeAt(first, second, before, afterText) {
  const hour = partSuffix(first.text, 0, 24, { liang: true });
  if (!hour || NOT_AN_HOUR_AFTER.has(hour.head ? hour.head.slice(-1) : before)) return null;
  const minute = smallNumber(second.text);
  const after = afterText[0] ?? "";
  if (minute === null || minute > 59 || (after !== "分" && minute < 10)) return null;
  if (second.text === "十" && after === "分" && afterText[1] !== "钟") return null; // 十分 = very
  return { head: hour.head, out: `${hour.value}点${minute}` };
}

// Two runs joined by 月 (a date with a day) or 点 (a time or a decimal).
function pairAt(tokens, i) {
  const [first, joint, second] = [tokens[i], tokens[i + 1], tokens[i + 2]];
  if (!first?.run || !second?.run || !joint || joint.run) return null;
  // All of it: 个百分点 holds a numeral run (百) of its own.
  const afterText = tokens.slice(i + 3, i + 6).map((t) => t.text).join("");
  const before = tokens[i - 1]?.text.slice(-1) ?? "";
  if (joint.text === "月") {
    const month = partSuffix(first.text, 1, 12);
    const day = smallNumber(second.text);
    if (!month || day === null || day < 1 || day > 31 || NOT_A_DAY_BEFORE.test(afterText)) return null;
    return { head: month.head, out: `${month.value}月${day}` };
  }
  if (joint.text === "点") return decimalAt(first, second, afterText) ?? timeAt(first, second, before, afterText);
  return null;
}

function convertRun(run, before, after) {
  // Next to 点 a run is only ever converted as a time or a decimal (pairAt).
  if (LIST_BEFORE.has(before) || before === "点" || after === "点") return run;
  if (SPELLED_DIGITS.test(run)) return DOUBLED.test(run) ? run : spelledDigits(run);
  if (run.length < 2 || before === "几" || after === "几") return run;
  const value = parseChineseCardinal(run);
  // 十二月 is a month's name; 十二个月 is a count.
  if (value === null || value < 10 || (after === "月" && value <= 12)) return run;
  return formatCardinal(value, run);
}

function normalizeChineseNumbers(text) {
  if (typeof text !== "string" || !HAS_NUMERAL.test(text)) return text;
  const withPercent = convertPercent(text);
  const spans = protectedSpans(withPercent);
  const isProtected = (token) => spans.some(([s, e]) => token.start < e && token.start + token.text.length > s);
  const tokens = tokenize(withPercent);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.run || isProtected(token)) {
      out.push(token.text);
      continue;
    }
    const pair = isProtected(tokens[i + 2] || token) ? null : pairAt(tokens, i);
    if (pair) {
      out.push(convertRun(pair.head, tokens[i - 1]?.text.slice(-1), ""), pair.out);
      i += 2;
      continue;
    }
    out.push(convertRun(token.text, tokens[i - 1]?.text.slice(-1), tokens[i + 1]?.text[0]));
  }
  return out.join("");
}

module.exports = { normalizeChineseNumbers, parseChineseCardinal };
