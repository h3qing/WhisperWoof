/**
 * Summaries of Cardputer recordings — pure parts (docs/design/cardputer-inbox.md):
 * how a meeting transcript is cut for the model (5-minute map windows, reduce
 * groups, ★ windows), how the model's answers are read (leniently: a small
 * local model), and summary.md / result.json at level "summary".
 *
 * A to-do is `confident` only when someone explicitly committed to it and an
 * owner was named. Links point at transcript.md block ids (^tHHMMSS);
 * to-dos get ^act-<n>.
 */

const { cleanText, blockIds, clock } = require("../core/cardputer/transcript-doc");
const { rfc3339 } = require("./cardputer-inbox-pure");

const WINDOW_MS = 300_000;
const MAP_MAX_CHARS = 6_000;
const REDUCE_MAX_CHARS = 8_000;
const STAR_BEFORE_MS = 30_000;
const STAR_AFTER_MS = 10_000;
const MAX_ACTIONS = 20;
const MAX_SESSION_MS = 4_294_967_295;
const NONE = "（无）";

const truncate = (text, max) => [...text].slice(0, max).join("");

// Rule first: a memo that starts with one of these is a to-do, no model asked.
const TODO_RULE =
  /^[\s"'“”‘’「『（(【[-]*(待办|todo|to-do|to do|提醒我|提醒一下|记得|别忘了|remind me)/i;
const NOT_A_VALUE = /^(未知|无|未定|不明|没有|-|—|none|unknown|n\/a|null|tbd)?$/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)、])\s*(?:\[\s?[xX ]?\s?\]\s*)?/;
const MAP_HEADING = /^[#*\s]*(要点|决定|待办)[*\s]*[:：]?[*\s]*$/;
const REDUCE_HEADING = /^#{1,6}\s*(摘要|重点|讨论要点|决定|待办|后续)/;
const MAP_SECTIONS = { 要点: "points", 决定: "decisions", 待办: "actions" };
const REDUCE_SECTIONS = {
  摘要: "summary",
  重点: "stars",
  讨论要点: "points",
  决定: "decisions",
  待办: "ignored",
  后续: "followups",
};

function isTodoByRule(text) {
  return TODO_RULE.test(String(text ?? ""));
}

/** The model's yes/no: true, false, or null when it said something else. */
function parseYesNo(text) {
  const t = String(text ?? "")
    .trim()
    .toLowerCase();
  if (/^(no\b|n$|否|不是|不对|不)/.test(t)) return false;
  if (/^(yes\b|y$|是|对)/.test(t)) return true;
  return null;
}

function stripTags(text) {
  return String(text ?? "")
    .replace(/<\/?\s*(transcript|notes|marks)\s*>/gi, "")
    .trim();
}

/** One line, no label or quotes, at most 80 characters; null when empty. */
function cleanTitle(text) {
  const line =
    stripTags(text)
      .split("\n")
      .find((l) => l.trim()) ?? "";
  const bare = cleanText(line)
    .replace(/^(标题|title)\s*[:：]\s*/i, "")
    .replace(/^["'“”‘’「『《]+|["'“”‘’」』》]+$/g, "")
    .replace(/[。.!！]+$/, "")
    .trim();
  return bare ? truncate(bare, 80) : null;
}

/** "mm:ss" or "h:mm:ss" → ms, else null. */
function parseClock(text) {
  const m = String(text ?? "")
    .trim()
    .match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

/** Transcript sentences in 5-minute windows (empty ones skipped), split when too long for one call. */
function planMapWindows(sentences, { windowMs = WINDOW_MS, maxChars = MAP_MAX_CHARS } = {}) {
  const byWindow = sentences.reduce((acc, s) => {
    const k = Math.floor(s.t_ms / windowMs);
    const last = acc[acc.length - 1];
    if (last && last.k === k)
      return [...acc.slice(0, -1), { ...last, sentences: [...last.sentences, s] }];
    return [...acc, { k, sentences: [s] }];
  }, []);
  return byWindow.flatMap(({ k, sentences: inWindow }) =>
    splitBySize(inWindow, maxChars).map((part) =>
      Object.freeze({ startMs: k * windowMs, endMs: (k + 1) * windowMs, sentences: part })
    )
  );
}

function splitBySize(items, maxChars, size = (s) => s.text.length) {
  return items.reduce((parts, item) => {
    const last = parts[parts.length - 1];
    const used = last ? last.reduce((n, s) => n + size(s), 0) : 0;
    if (last && used + size(item) <= maxChars) return [...parts.slice(0, -1), [...last, item]];
    return [...parts, [item]];
  }, []);
}

/** Consecutive notes grouped so each group stays within `budget` characters. */
function planReduceGroups(notes, budget = REDUCE_MAX_CHARS) {
  return splitBySize(notes, budget, (n) => n.length);
}

/** The transcript 30 s before to 10 s after each ★ (marks of other kinds are skipped). */
function starWindows(sentences, marks) {
  return marks
    .filter((m) => m.k === "star")
    .map((m, i) => ({
      n: i + 1,
      t_ms: m.t_ms,
      sentences: sentences.filter(
        (s) => s.t_ms >= m.t_ms - STAR_BEFORE_MS && s.t_ms <= m.t_ms + STAR_AFTER_MS
      ),
    }));
}

function valueOf(text) {
  const v = cleanText(text);
  return NOT_A_VALUE.test(v) ? null : v;
}

function actionField(key) {
  if (/^(负责人|owner|who)$/i.test(key)) return "owner";
  if (/^(截止|due|deadline)$/i.test(key)) return "due";
  if (/^(时间|time)$/i.test(key)) return "time";
  if (/^(明确|explicit|commitment)$/i.test(key)) return "explicit";
  return null;
}

/** "- task | 负责人: X | 截止: Y | 时间: mm:ss | 明确: 是" → action, or null. */
function parseActionLine(line) {
  const [head, ...rest] = String(line ?? "")
    .replace(BULLET, "")
    .split(/[|｜]/);
  const text = cleanText(head);
  if (!text) return null;
  const fields = Object.fromEntries(
    rest
      .map((part) => part.match(/^\s*([^:：]+?)\s*[:：]\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [actionField(key.trim()), value])
      .filter(([key]) => key)
  );
  const owner = valueOf(fields.owner);
  const explicit = /^(是|yes|true)$/i.test(cleanText(fields.explicit));
  return {
    text,
    owner,
    due: valueOf(fields.due),
    t_ms: parseClock(fields.time),
    confident: explicit && owner !== null,
  };
}

function sectionLines(text, headingRe, sections, initial) {
  const out = {};
  let current = initial;
  for (const raw of String(text ?? "").split("\n")) {
    const heading = raw.trim().match(headingRe);
    if (heading) {
      current = sections[heading[1]];
      continue;
    }
    const line = raw.replace(BULLET, "").trim();
    if (current && line && line !== NONE && line !== "无")
      out[current] = [...(out[current] ?? []), raw];
  }
  return out;
}

/** A map answer → { points, decisions, actions }. */
function parseMapNotes(text) {
  const lines = sectionLines(stripTags(text), MAP_HEADING, MAP_SECTIONS, "points");
  const plain = (key) =>
    (lines[key] ?? []).map((l) => cleanText(l.replace(BULLET, ""))).filter(Boolean);
  return {
    points: plain("points"),
    decisions: plain("decisions"),
    actions: (lines.actions ?? []).map(parseActionLine).filter(Boolean),
  };
}

/** The reduce answer → { title, summary, stars: Map(n → text), points, decisions, followups }. */
function parseReduce(text) {
  const body = stripTags(text);
  const titleLine = body.split("\n").find((l) => /^\s*(标题|title)\s*[:：]/i.test(l));
  const lines = sectionLines(body, REDUCE_HEADING, REDUCE_SECTIONS, null);
  const plain = (key) =>
    (lines[key] ?? []).map((l) => cleanText(l.replace(BULLET, ""))).filter(Boolean);
  const stars = new Map(
    (lines.stars ?? [])
      .map((l) => l.match(/★\s*(\d+)\s*[:：]\s*(.+)$/))
      .filter(Boolean)
      .map(([, n, note]) => [Number(n), cleanText(note)])
  );
  return {
    title: titleLine ? cleanTitle(titleLine) : null,
    summary: plain("summary"),
    stars,
    points: plain("points"),
    decisions: plain("decisions"),
    followups: plain("followups"),
  };
}

const WINDOW_SLACK_MS = 60_000;

/** An action keeps the time the model gave only when it is in (or near) its window; else the window's first line. */
function windowActions(actions, window) {
  const fallback = window.sentences[0]?.t_ms ?? window.startMs;
  const fits = (t) =>
    Number.isFinite(t) &&
    t >= window.startMs - WINDOW_SLACK_MS &&
    t <= window.endMs + WINDOW_SLACK_MS;
  return actions.map((a) => ({ ...a, t_ms: fits(a.t_ms) ? a.t_ms : fallback }));
}

const actionKey = (text) => text.toLowerCase().replace(/[\s\p{P}]/gu, "");

/** At most 20 actions, numbered, deduplicated, within the contract's limits. */
function finalActions(actions, durationMs) {
  const seen = new Set();
  const unique = actions.filter((a) => {
    const key = actionKey(a.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const limit = Math.min(durationMs, MAX_SESSION_MS);
  return unique.slice(0, MAX_ACTIONS).map((a, i) => ({
    n: i + 1,
    text: truncate(cleanText(a.text), 200),
    owner: a.owner ? truncate(a.owner, 40) : null,
    due: a.due ? truncate(a.due, 40) : null,
    t_ms: Number.isFinite(a.t_ms) ? Math.min(Math.max(0, a.t_ms), limit) : null,
    confident: a.confident === true && Boolean(a.owner),
  }));
}

function nearestIndex(sentences, t) {
  return sentences.reduce(
    (best, s, i) =>
      best < 0 || Math.abs(s.t_ms - t) < Math.abs(sentences[best].t_ms - t) ? i : best,
    -1
  );
}

function anchor(t, sentences, ids) {
  const i = nearestIndex(sentences, t);
  return i < 0 ? `@${clock(t)}` : `[@${clock(t)}](transcript.md#^${ids[i]})`;
}

const yaml = (value) => (value == null ? "null" : JSON.stringify(value));

function frontmatter({ manifest, title, pipeline }) {
  const { started } = manifest;
  const lines = [
    "---",
    `title: ${yaml(title)}`,
    `date: ${yaml(rfc3339(started.wall_ms, started.tz_min))}`,
    "source: cardputer",
    `session: ${manifest.session}`,
    `mode: ${manifest.mode}`,
    `project: ${yaml(manifest.project?.key ?? null)}`,
    `duration: ${yaml(clock(manifest.duration_ms))}`,
    "audio:",
    ...manifest.segments.map((s) => `  - ${s.file}`),
    "transcript: transcript.md",
    `pipeline: ${yaml([pipeline.app, pipeline.stt, pipeline.llm, pipeline.prompt].filter(Boolean).join(" · "))}`,
    "---",
  ];
  return `${lines.join("\n")}\n`;
}

const list = (items) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${NONE}`);

function starLines({ stars, notes, sentences, ids }) {
  return stars.map((star) => {
    const near = star.sentences[nearestIndex(star.sentences, star.t_ms)];
    const note = notes.get(star.n) || near?.text || NONE;
    return `- ★ ${note} ${anchor(star.t_ms, sentences, ids)}`;
  });
}

function actionLines({ actions, sentences, ids }) {
  return actions.map((a) => {
    const who = [a.owner, a.due].filter(Boolean);
    const parens = who.length ? `（${who.join("，")}）` : " ";
    const link = a.t_ms === null ? "" : anchor(a.t_ms, sentences, ids);
    return `- [ ] ${a.text}${parens}${link} ^act-${a.n}`.replace(/\s+\^act/, " ^act");
  });
}

/** summary.md of a meeting: frontmatter, then the fixed headings. */
function renderMeetingSummary({ manifest, title, reduce, stars, actions, sentences, pipeline }) {
  const ids = blockIds(sentences);
  const starText = starLines({ stars, notes: reduce.stars, sentences, ids });
  const actionText = actionLines({ actions, sentences, ids });
  const sections = [
    ["## 摘要", reduce.summary.length ? reduce.summary.join("\n\n") : NONE],
    ["## 重点（你的标记）", starText.length ? starText.join("\n") : `- ${NONE}`],
    ["## 讨论要点", list(reduce.points)],
    ["## 决定", list(reduce.decisions)],
    ["## 待办", actionText.length ? actionText.join("\n") : `- ${NONE}`],
    ["## 后续", list(reduce.followups)],
  ];
  const body = sections.map(([heading, text]) => `${heading}\n\n${text}\n`).join("\n");
  return `${frontmatter({ manifest, title, pipeline })}\n${body}`;
}

/** summary.md of a memo: frontmatter, the cleaned text and its kind. */
function renderMemoSummary({ manifest, title, text, intent, pipeline }) {
  const kind = intent === "todo" ? "待办" : "记录";
  return `${frontmatter({ manifest, title, pipeline })}\n${text}\n\n类型：${kind}\n`;
}

function label(value) {
  if (typeof value !== "string") return null;
  const n = [...value].length;
  return n >= 1 && n <= 64 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

/** result.json at level "summary". */
function summaryResult({ manifest, outputs, title, memo, actions, pipeline, finishedAt }) {
  return Object.freeze({
    v: 1,
    session: manifest.session,
    attempt: manifest.attempt,
    state: "done",
    level: "summary",
    mode: manifest.mode,
    title: title ?? null,
    memo: memo ?? null,
    outputs,
    actions,
    pipeline: {
      app: pipeline.app,
      stt: pipeline.stt,
      llm: label(pipeline.llm),
      prompt: label(pipeline.prompt),
    },
    error: null,
    finished_at: finishedAt,
  });
}

module.exports = {
  WINDOW_MS,
  REDUCE_MAX_CHARS,
  isTodoByRule,
  parseYesNo,
  stripTags,
  cleanTitle,
  parseClock,
  planMapWindows,
  planReduceGroups,
  starWindows,
  parseActionLine,
  parseMapNotes,
  parseReduce,
  windowActions,
  finalActions,
  renderMeetingSummary,
  renderMemoSummary,
  summaryResult,
  truncate,
};
