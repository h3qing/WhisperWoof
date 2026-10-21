/**
 * The summary stage of a Cardputer session (process-session's `complete`):
 * after the transcript is written, the user's selected local model makes
 * summary.md and result.json at level "summary".
 *
 * - memo: cleanup (the dictation cleanup prompt) → to-do or note (rule first,
 *   then the model's yes/no) → a title;
 * - meeting: one map call per 5-minute window, merges if the notes are too
 *   long, then one reduce with the user's ★ marks; to-dos come from the map
 *   answers, each pinned to a transcript line.
 *
 * `llm(text, { systemPrompt, purpose, maxTokens, model, signal })` is the
 * background queue (LocalReasoningService.processBackground: never logs
 * text, steps aside for dictation). Each call is retried 3 times with
 * back-off; if the summary still fails, or no local model is selected, the
 * result stays at level "transcript". No cloud model is ever used.
 */

const { joinTranscriptSegments } = require("../../../helpers/parakeetWsResult");
const prompts = require("../../bridge/cardputer-prompts");
const summary = require("../../bridge/cardputer-summary-pure");
const pure = require("../../bridge/cardputer-inbox-pure");
const { isTaken } = require("../../bridge/cardputer-writeback");

const LLM_RETRY_DELAYS_MS = Object.freeze([2_000, 10_000, 30_000]);
const MEMO_CHUNK_CHARS = 400; // one cleanup answer stays well under 512 tokens
const MAX_MERGE_ROUNDS = 4;
const MAP_TOKENS = 512;
const REDUCE_TOKENS = 1024;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAbort = (error) => error?.name === "AbortError";

async function withRetries(fn, { signal, sleep }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isAbort(error) || signal.aborted || attempt >= LLM_RETRY_DELAYS_MS.length) throw error;
      await sleep(LLM_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** A model call for this session: status blocked/busy while dictation has the model, retries. */
async function askModel(session, text, options) {
  const { ctx, llm, model, sleep } = session;
  const { systemPrompt } = options;
  const purpose = options.purpose ?? "map";
  const maxTokens = options.maxTokens ?? MAP_TOKENS;
  if (ctx.deps.gateDelayMs() > 0) await ctx.setStatus("blocked", "busy");
  const call = () => llm(text, { systemPrompt, purpose, maxTokens, model, signal: ctx.signal });
  const answer = await withRetries(call, { signal: ctx.signal, sleep });
  await ctx.setStatus("summarizing");
  return String(answer ?? "");
}

function asker(session) {
  return (text, options) => askModel(session, text, options);
}

function chunkSentences(sentences) {
  return summary.planMapWindows(sentences, {
    windowMs: Number.MAX_SAFE_INTEGER,
    maxChars: MEMO_CHUNK_CHARS,
  });
}

async function summarizeMemo({ ctx, sentences, ask, pipeline }) {
  const raw = joinTranscriptSegments(sentences.map((s) => s.text));
  const cleanedParts = [];
  for (const chunk of chunkSentences(sentences)) {
    const part = joinTranscriptSegments(chunk.sentences.map((s) => s.text));
    const answer = summary.stripTags(
      await ask(prompts.textBlock(part), { systemPrompt: prompts.memoCleanupSystem() })
    );
    cleanedParts.push(answer || part);
  }
  const cleaned = joinTranscriptSegments(cleanedParts) || raw;
  const byRule = summary.isTodoByRule(raw) || summary.isTodoByRule(cleaned);
  const asked = byRule
    ? true
    : summary.parseYesNo(
        await ask(prompts.textBlock(cleaned), {
          systemPrompt: prompts.memoClassifySystem(),
          maxTokens: 8,
        })
      );
  const intent = asked ? "todo" : "note";
  const titled = summary.cleanTitle(
    await ask(prompts.textBlock(cleaned), { systemPrompt: prompts.titleSystem(), maxTokens: 64 })
  );
  const title = titled ?? summary.cleanTitle(summary.truncate(cleaned, 30));
  const markdown = summary.renderMemoSummary({
    manifest: ctx.manifest,
    title,
    text: cleaned,
    intent,
    pipeline,
  });
  return { markdown, title, memo: { text: summary.truncate(cleaned, 2000), intent }, actions: [] };
}

/** Notes text for the reduce (points and decisions; to-dos are handled apart). */
function notesText(parsed) {
  const section = (name, items) => [`${name}:`, ...items.map((i) => "- " + i)].join("\n");
  return [section("要点", parsed.points), section("决定", parsed.decisions)].join("\n");
}

async function mergeUntilFits(notes, ask) {
  let current = notes;
  for (let round = 0; round < MAX_MERGE_ROUNDS; round++) {
    const groups = summary.planReduceGroups(current);
    if (groups.length <= 1) return current;
    const merged = [];
    for (const group of groups) {
      if (group.length === 1) merged.push(group[0]);
      else {
        const answer = await ask(prompts.mergeInput(group), {
          systemPrompt: prompts.meetingMergeSystem(),
          purpose: "reduce",
          maxTokens: REDUCE_TOKENS,
        });
        merged.push(notesText(summary.parseMapNotes(answer)));
      }
    }
    current = merged;
  }
  return current;
}

function meetingFallbackTitle(manifest) {
  const at = pure.rfc3339(manifest.started.wall_ms, manifest.started.tz_min);
  return `会议 ${at.slice(11, 16)}`;
}

async function summarizeMeeting({ ctx, sentences, ask, pipeline }) {
  const { manifest } = ctx;
  const windows = summary.planMapWindows(sentences);
  const parsed = [];
  for (const window of windows) {
    const answer = await ask(prompts.transcriptBlock(window.sentences), {
      systemPrompt: prompts.meetingMapSystem(),
    });
    const notes = summary.parseMapNotes(answer);
    parsed.push({ ...notes, actions: summary.windowActions(notes.actions, window) });
  }
  const notes = await mergeUntilFits(parsed.map(notesText), ask);
  const stars = summary.starWindows(sentences, manifest.marks);
  const reduce = summary.parseReduce(
    await ask(prompts.reduceInput({ notes, stars }), {
      systemPrompt: prompts.meetingReduceSystem(),
      purpose: "reduce",
      maxTokens: REDUCE_TOKENS,
    })
  );
  const actions = summary.finalActions(
    parsed.flatMap((p) => p.actions),
    manifest.duration_ms
  );
  const title = reduce.title ?? meetingFallbackTitle(manifest);
  const markdown = summary.renderMeetingSummary({
    manifest,
    title,
    reduce,
    stars,
    actions,
    sentences,
    pipeline,
  });
  return { markdown, title, memo: null, actions };
}

function transcriptOnly(ctx, outputs) {
  return pure.transcriptResult({
    manifest: ctx.manifest,
    outputs,
    app: ctx.deps.app,
    finishedAt: ctx.deps.at(),
  });
}

/**
 * → the `complete` stage for inbox-runner: ({ ctx, sentences, outputs, writeFile }) → result.json.
 * model() → the selected local model id, or null.
 */
function createSummaryStage({ llm, model, sleep = defaultSleep }) {
  return async ({ ctx, sentences, outputs, writeFile }) => {
    const modelId = model();
    if (!modelId || sentences.length === 0) return transcriptOnly(ctx, outputs);
    await ctx.setStatus("summarizing");
    const mode = ctx.manifest.mode;
    const pipeline = {
      app: ctx.deps.app,
      stt: pure.STT_ENGINE,
      llm: modelId,
      prompt: prompts.PROMPT_IDS[mode],
    };
    const ask = asker({ ctx, llm, model: modelId, sleep });
    let made;
    try {
      const make = mode === "memo" ? summarizeMemo : summarizeMeeting;
      made = await make({ ctx, sentences, ask, pipeline });
    } catch (error) {
      if (isAbort(error) || ctx.signal.aborted || isTaken(error)) throw error;
      return transcriptOnly(ctx, outputs); // the summary failed; the transcript stands
    }
    const sha256 = writeFile("summary.md", made.markdown);
    return summary.summaryResult({
      manifest: ctx.manifest,
      outputs: { ...outputs, summary: { path: "summary.md", sha256 } },
      title: made.title,
      memo: made.memo,
      actions: made.actions,
      pipeline,
      finishedAt: ctx.deps.at(),
    });
  };
}

module.exports = { createSummaryStage, LLM_RETRY_DELAYS_MS };
