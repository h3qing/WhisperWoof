/**
 * Memory replacements: what the user taught by fixing transcripts
 * ("super base" -> Supabase) is swapped into the next transcript before
 * polish. This is the only Memory lever for engines that take no hints
 * (Parakeet, X-ASR, SenseVoice).
 */
import { describe, it, expect } from "vitest";
import { applyLearnedCorrection } from "../../bridge/vocabulary-pure";
import { buildReplacementRules, applyReplacements } from "./memory-replacements";

const NOW = "2026-09-24T00:00:00.000Z";

interface Entry {
  id: string;
  word: string;
  alternatives: string[];
  source: string;
  learnedCounts?: Record<string, number>;
  appContexts?: Record<string, { count: number; firstSeen: string; lastSeen: string }>;
}

function learn(entries: Entry[], from: string, to: string, bundleId?: string): Entry[] {
  return applyLearnedCorrection(entries, { from, to, bundleId, now: NOW, id: `id-${to}` });
}

describe("applyLearnedCorrection", () => {
  it("creates an auto-learn entry that remembers what was misheard", () => {
    const [entry] = learn([], "super base", "Supabase", "com.microsoft.VSCode");
    expect(entry).toMatchObject({
      id: "id-Supabase",
      word: "Supabase",
      source: "auto-learn",
      alternatives: ["super base"],
      learnedCounts: { "super base": 1 },
      appContexts: { "com.microsoft.VSCode": { count: 1, firstSeen: NOW, lastSeen: NOW } },
    });
  });

  it("counts a repeat of the same fix instead of duplicating it", () => {
    const entries = learn(learn([], "Superbase", "Supabase"), "superbase", "Supabase");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.alternatives).toEqual(["Superbase"]);
    expect(entries[0]!.learnedCounts).toEqual({ superbase: 2 });
  });

  it("adds a learned mishearing to an existing manual entry without changing its source", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["he ching"], source: "manual" }];
    const [entry] = learn(manual, "he king", "Heqing");
    expect(entry).toMatchObject({
      source: "manual",
      alternatives: ["he ching", "he king"],
      learnedCounts: { "he king": 1 },
    });
  });

  it("returns a new array and leaves the input untouched", () => {
    const before: Entry[] = [{ id: "m", word: "Heqing", alternatives: [], source: "manual" }];
    const after = learn(before, "he king", "Heqing");
    expect(after).not.toBe(before);
    expect(before[0]!.alternatives).toEqual([]);
  });
});

describe("buildReplacementRules", () => {
  it("applies a learned multi-word mishearing right away", () => {
    expect(buildReplacementRules(learn([], "super base", "Supabase"))).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });

  it("waits for a second identical fix before replacing a single word", () => {
    const once = learn([], "Superbase", "Supabase");
    expect(buildReplacementRules(once)).toEqual([]);
    expect(buildReplacementRules(learn(once, "Superbase", "Supabase"))).toEqual([
      { from: "Superbase", to: "Supabase" },
    ]);
  });

  it("never auto-replaces with a plain lowercase word (their -> there)", () => {
    const twice = learn(learn([], "their", "there"), "their", "there");
    const split = learn([], "every day", "everyday");
    expect(buildReplacementRules([...twice, ...split])).toEqual([]);
  });

  it("treats accented and digit words as terms", () => {
    const entries = [...learn([], "resume a", "résumé"), ...learn([], "gpt four", "GPT4")];
    expect(buildReplacementRules(entries).map((r: { to: string }) => r.to)).toEqual(["résumé", "GPT4"]);
  });

  it("applies alternatives the user typed without waiting", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["he ching"], source: "manual" }];
    expect(buildReplacementRules(manual)).toEqual([{ from: "he ching", to: "Heqing" }]);
  });

  it("orders longer phrases first and skips self-matches", () => {
    const entries: Entry[] = [
      { id: "a", word: "Claude", alternatives: ["clod", "claude"], source: "manual" },
      { id: "b", word: "Claude Code", alternatives: ["clod code"], source: "manual" },
    ];
    expect(buildReplacementRules(entries)).toEqual([
      { from: "clod code", to: "Claude Code" },
      { from: "clod", to: "Claude" },
    ]);
  });

  it("handles empty input", () => {
    expect(buildReplacementRules([])).toEqual([]);
    expect(buildReplacementRules(null)).toEqual([]);
  });
});

describe("applyReplacements", () => {
  const rules = [
    { from: "clod code", to: "Claude Code" },
    { from: "super base", to: "Supabase" },
    { from: "clod", to: "Claude" },
  ];

  it("swaps whole-word matches, case-insensitively, and reports them", () => {
    expect(applyReplacements("Deploy to Super Base, then ask clod.", rules)).toEqual({
      text: "Deploy to Supabase, then ask Claude.",
      applied: [
        { from: "Super Base", to: "Supabase" },
        { from: "clod", to: "Claude" },
      ],
    });
  });

  it("matches across hyphens and extra spaces", () => {
    expect(applyReplacements("super-base and super   base", rules).text).toBe("Supabase and Supabase");
  });

  it("prefers the longest phrase and never re-replaces its output", () => {
    expect(applyReplacements("open clod code now", rules).text).toBe("open Claude Code now");
  });

  it("leaves words that merely contain a match alone", () => {
    expect(applyReplacements("clodhopper and superbases", rules).text).toBe("clodhopper and superbases");
  });

  it("works next to Chinese text", () => {
    expect(applyReplacements("把项目部署到super base上", rules).text).toBe("把项目部署到Supabase上");
  });

  it("returns the text unchanged with no rules or no text", () => {
    expect(applyReplacements("hello", [])).toEqual({ text: "hello", applied: [] });
    expect(applyReplacements("", rules)).toEqual({ text: "", applied: [] });
  });
});
