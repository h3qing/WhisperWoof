/**
 * Summaries end to end (core/cardputer/summarize-session.js inside the inbox
 * runner) on temp folders with a fake SenseVoice and a fake local model:
 * memo cleanup + classification + title, meeting map/reduce with ★ notes,
 * summary.md before result.json (level "summary"), retries, and falling back
 * to level "transcript" when there is no model or it keeps failing.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { tempRoot, writeSession, fakeSenseVoice, readJson } from "./test-sessions";

const require = createRequire(import.meta.url);
const { createInboxRunner } = require("./inbox-runner");
const { createSummaryStage } = require("./summarize-session");
const contract = require("./contract");
const writeback = require("../../bridge/cardputer-writeback");
const doc = require("./transcript-doc");

const MODEL = "qwen3.5-2b-q4_k_m";
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

type Call = {
  kind: string;
  text: string;
  purpose: string;
  maxTokens: number;
  model: string;
  signal: unknown;
};

const MAP_ANSWER = [
  "要点:",
  "- 过了一遍 pricing",
  "决定:",
  "- 周五交付",
  "待办:",
  "- 给 Alice 发报价单 | 负责人: 我 | 截止: 周五 | 时间: 00:00 | 明确: 是",
  "- 看一下文档 | 负责人: 未知 | 截止: 无 | 时间: 10:00 | 明确: 否",
].join("\n");
const REDUCE_ANSWER =
  "标题: 客户同步\n## 摘要\n讨论了定价。\n## 重点（你的标记）\n★1: 报价单周五发\n## 讨论要点\n- 定价\n## 决定\n- 周五交付\n## 后续\n- 无";

function kindOf(systemPrompt: string) {
  if (systemPrompt.includes("text cleanup tool")) return "cleanup";
  if (systemPrompt.includes("exactly one word")) return "classify";
  if (systemPrompt.includes("short title")) return "title";
  if (systemPrompt.includes("one part (about 5 minutes)")) return "map";
  if (systemPrompt.includes("merge partial notes")) return "merge";
  if (systemPrompt.includes("final notes")) return "reduce";
  return "unknown";
}

function fakeModel(answers: Partial<Record<string, string>> = {}) {
  const calls: Call[] = [];
  const llm = vi.fn(
    async (
      text: string,
      o: {
        systemPrompt: string;
        purpose: string;
        maxTokens: number;
        model: string;
        signal: unknown;
      }
    ) => {
      const kind = kindOf(o.systemPrompt);
      calls.push({
        kind,
        text,
        purpose: o.purpose,
        maxTokens: o.maxTokens,
        model: o.model,
        signal: o.signal,
      });
      const defaults: Record<string, string> = {
        cleanup: "<transcript>\n周五前给 Alice 发报价单。\n</transcript>",
        classify: "yes",
        title: "标题：给 Alice 发报价单",
        map: MAP_ANSWER,
        reduce: REDUCE_ANSWER,
        merge: "要点:\n- merged",
      };
      if (kind === "map" && !answers.map) {
        // like a model would: only the to-dos whose line is in this part
        return MAP_ANSWER.split("\n")
          .filter(
            (l) => !l.includes("时间:") || text.includes(`[${l.match(/时间: (\d\d:\d\d)/)![1]}]`)
          )
          .join("\n");
      }
      return answers[kind] ?? defaults[kind] ?? "";
    }
  );
  return { llm, calls };
}

type SetupOptions = {
  model?: string | null;
  llm?: (text: string, o: any) => Promise<unknown>;
  transcribe?: (samples: Float32Array, sampleRate: number) => Promise<unknown>;
  sleep?: ReturnType<typeof vi.fn>;
};

function setup({
  model = MODEL,
  llm = fakeModel().llm,
  transcribe = fakeSenseVoice().transcribe,
  sleep = vi.fn(async (_ms: number) => {}),
}: SetupOptions = {}) {
  const root = tempRoot();
  roots.push(root);
  const writes: string[] = [];
  const runner = createInboxRunner({
    root,
    transcribe,
    ensureModel: async () => true,
    app: "WhisperWoof/test",
    tzOffsetMin: () => 480,
    complete: createSummaryStage({ llm, model: () => model, sleep }),
    write: (dir: string, name: string, data: string) => {
      writes.push(name === "status.json" ? `status:${JSON.parse(data).state}` : name);
      return writeback.writeAtomic(dir, name, data);
    },
  });
  return { root, runner, writes, sleep };
}

describe("Cardputer summaries", () => {
  it("cleans up a memo, classifies it, titles it, and writes summary.md before result.json", async () => {
    const model = fakeModel();
    const { root, runner, writes } = setup({ llm: model.llm });
    const { dir, session } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 3, t0_ms: 0 }],
    });

    await runner.runOnce();

    expect(writes).toEqual([
      "status:queued",
      "status:transcribing",
      "transcript.json",
      "transcript.md",
      "status:summarizing",
      "summary.md",
      "result.json",
    ]);
    const result = readJson(dir, "result.json");
    expect(contract.validateDoc("result", result)).toEqual({ code: "ok", fields: [] });
    expect(result).toMatchObject({
      session,
      state: "done",
      level: "summary",
      title: "给 Alice 发报价单",
      memo: { text: "周五前给 Alice 发报价单。", intent: "todo" },
      actions: [],
      pipeline: { llm: MODEL, prompt: "cardputer-memo-v1" },
    });
    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    expect(md).toContain("\n周五前给 Alice 发报价单。\n\n类型：待办\n");
    expect(result.outputs.summary.path).toBe("summary.md");
    expect(model.calls.map((c) => c.kind)).toEqual(["cleanup", "classify", "title"]);
    for (const c of model.calls) {
      expect(c).toMatchObject({ purpose: "map", model: MODEL });
      expect(c.maxTokens).toBeLessThanOrEqual(512);
      expect(c.signal).toBeInstanceOf(AbortSignal);
      expect(c.text).toMatch(/^<transcript>\n[\s\S]*\n<\/transcript>$/);
    }
  });

  it("takes a memo that starts with 待办 as a to-do without asking the model", async () => {
    const model = fakeModel({ cleanup: "待办：周五前发报价单。" });
    const transcribe = async () => ({
      text: "待办周五前发报价单。",
      tokens: ["待", "。"],
      timestamps: [0.2, 0.9],
    });
    const { root, runner } = setup({ llm: model.llm, transcribe });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    expect(readJson(dir, "result.json").memo.intent).toBe("todo");
    expect(model.calls.map((c) => c.kind)).toEqual(["cleanup", "title"]);
  });

  it("summarises a meeting: a map call per 5-minute window, one reduce with the ★ notes", async () => {
    const model = fakeModel();
    const { root, runner, writes } = setup({ llm: model.llm });
    // segment 1 never arrived: segment 2 starts 10 minutes in, so the lines fall in two windows
    const { dir } = writeSession(root, {
      mode: "meeting",
      segments: [
        { i: 0, seconds: 3, t0_ms: 0 },
        { i: 2, seconds: 3, t0_ms: 600_000 },
      ],
      gaps: [1],
      marks: [
        { t_ms: 600_400, k: "star" },
        { t_ms: 1000, k: "later_kind" },
      ],
    });

    await runner.runOnce();

    expect(model.calls.map((c) => c.kind)).toEqual(["map", "map", "reduce"]);
    const reduce = model.calls[2];
    expect(reduce).toMatchObject({ purpose: "reduce", model: MODEL });
    expect(reduce.maxTokens).toBeLessThanOrEqual(1024);
    expect(reduce.text).toContain("★1 (10:00)");
    expect(reduce.text).toContain("[10:00] 第2句。");
    expect(writes.slice(-3)).toEqual(["status:summarizing", "summary.md", "result.json"]);

    const result = readJson(dir, "result.json");
    expect(contract.validateDoc("result", result)).toEqual({ code: "ok", fields: [] });
    expect(result).toMatchObject({
      level: "summary",
      title: "客户同步",
      memo: null,
      pipeline: { prompt: "cardputer-meeting-v1" },
    });
    expect(result.actions).toEqual([
      { n: 1, text: "给 Alice 发报价单", owner: "我", due: "周五", t_ms: 0, confident: true },
      { n: 2, text: "看一下文档", owner: null, due: null, t_ms: 600_000, confident: false },
    ]);

    const md = fs.readFileSync(path.join(dir, "summary.md"), "utf8");
    const { sentences } = readJson(dir, "transcript.json");
    const ids = doc.blockIds(sentences);
    expect(md).toContain(`- ★ 报价单周五发 [@10:00](transcript.md#^${ids[1]})`);
    expect(md).toContain(
      `- [ ] 给 Alice 发报价单（我，周五）[@00:00](transcript.md#^${ids[0]}) ^act-1`
    );
    expect(md).toContain("^act-2");
    const transcriptMd = fs.readFileSync(path.join(dir, "transcript.md"), "utf8");
    for (const id of ids) expect(transcriptMd).toContain(`^${id}\n`); // every link has its target
  });

  it("merges the part notes first when they don't fit one reduce", async () => {
    const model = fakeModel({ map: `要点:\n- ${"很长的要点".repeat(600)}` });
    const { root, runner } = setup({ llm: model.llm });
    const { dir } = writeSession(root, {
      mode: "meeting",
      segments: [0, 2, 4, 6].map((i) => ({ i, seconds: 2, t0_ms: i * 150_000 })),
      gaps: [1, 3, 5],
    });
    await runner.runOnce();
    expect(model.calls.map((c) => c.kind)).toEqual([
      "map",
      "map",
      "map",
      "map",
      "merge",
      "merge",
      "reduce",
    ]);
    for (const c of model.calls.filter((c) => c.kind === "merge")) {
      expect(c).toMatchObject({ purpose: "reduce" });
      expect(c.maxTokens).toBeLessThanOrEqual(1024);
      expect(c.text.startsWith("<notes>")).toBe(true);
    }
    expect(model.calls.at(-1)!.text).toContain("- merged");
    expect(readJson(dir, "result.json")).toMatchObject({ level: "summary" });
  });

  it("retries a failing model 3 times, then keeps the transcript (level transcript)", async () => {
    const llm = vi.fn(async () => {
      throw new Error("llama-server request failed");
    });
    const { root, runner, writes, sleep } = setup({ llm });
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    expect(llm).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c: unknown[]) => c[0])).toEqual([2_000, 10_000, 30_000]);
    expect(readJson(dir, "result.json")).toMatchObject({
      state: "done",
      level: "transcript",
      error: null,
    });
    expect(writes).not.toContain("summary.md");
  });

  it("keeps the transcript only when no local model is chosen (never a cloud model)", async () => {
    const model = fakeModel();
    const { root, runner, writes } = setup({ model: null, llm: model.llm });
    const { dir } = writeSession(root, {
      mode: "meeting",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    expect(model.llm).not.toHaveBeenCalled();
    expect(readJson(dir, "result.json")).toMatchObject({ level: "transcript" });
    expect(writes).not.toContain("status:summarizing");
  });

  it("asks the model nothing about a silent recording", async () => {
    const model = fakeModel();
    const { root, runner } = setup({ llm: model.llm });
    const silent = Buffer.alloc(2 * 16000 * 2);
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0, pcm: silent }],
    });
    await runner.runOnce();
    expect(model.llm).not.toHaveBeenCalled();
    expect(readJson(dir, "result.json")).toMatchObject({ level: "transcript" });
    expect(readJson(dir, "transcript.json").sentences).toEqual([]);
  });

  it("stops with blocked/disabled when the inbox is turned off while it summarises", async () => {
    const holder: { runner?: { abort(): void } } = {};
    const llm = vi.fn(async (_text: string, o: { signal: AbortSignal }) => {
      holder.runner!.abort();
      expect(o.signal.aborted).toBe(true);
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    });
    const { root, runner } = setup({ llm });
    holder.runner = runner;
    const { dir } = writeSession(root, {
      mode: "memo",
      segments: [{ i: 0, seconds: 2, t0_ms: 0 }],
    });
    await runner.runOnce();
    expect(readJson(dir, "status.json")).toMatchObject({ state: "blocked", reason: "disabled" });
    expect(fs.existsSync(path.join(dir, "result.json"))).toBe(false);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});
