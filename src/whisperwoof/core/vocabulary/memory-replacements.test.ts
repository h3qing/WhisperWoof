/**
 * Memory replacements: what the user taught by fixing transcripts
 * ("super base" -> Supabase) is swapped into the next transcript before
 * polish. This is the only Memory lever for engines that take no hints
 * (Parakeet, X-ASR, SenseVoice).
 */
import { describe, it, expect } from "vitest";
import { MAX_ENTRIES, applyLearnedCorrection, unlearnCorrection } from "../../bridge/vocabulary-pure";
import {
  MIN_SINGLE_WORD_FIXES,
  buildReplacementRules,
  applyReplacements,
  planSessionLearning,
} from "./memory-replacements";

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

  it("leaves an alternative the user typed as typed (not counted as learned)", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["hitching"], source: "manual" }];
    const [entry] = learn(manual, "hitching", "Heqing");
    expect(entry!.learnedCounts ?? {}).toEqual({});
    expect(entry!.alternatives).toEqual(["hitching"]);
  });

  it("bumps the app context of an existing entry", () => {
    const entries = applyLearnedCorrection(learn([], "x y", "Foo", "com.a"), {
      from: "x y",
      to: "Foo",
      bundleId: "com.a",
      now: "t2",
      id: "z",
    });
    expect(entries[0]!.appContexts).toEqual({ "com.a": { count: 2, firstSeen: NOW, lastSeen: "t2" } });
  });

  it("does not add a new word once Memory is full", () => {
    const full: Entry[] = Array.from({ length: MAX_ENTRIES }, (_, i) => ({
      id: `e${i}`,
      word: `w${i}`,
      alternatives: [],
      source: "manual",
    }));
    expect(learn(full, "super base", "Supabase")).toBe(full);
  });
});

describe("unlearnCorrection", () => {
  it("removes an auto-learn entry that existed only for this fix", () => {
    expect(unlearnCorrection(learn([], "super base", "Supa"), { from: "super base", to: "Supa" })).toEqual([]);
  });

  it("takes back one count of a fix learned more than once", () => {
    const twice = learn(learn([], "Superbase", "Supabase"), "Superbase", "Supabase");
    const [entry] = unlearnCorrection(twice, { from: "Superbase", to: "Supabase" });
    expect(entry).toMatchObject({ alternatives: ["Superbase"], learnedCounts: { superbase: 1 } });
  });

  it("drops only the learned alternative from an entry that has other reasons to exist", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["he ching"], source: "manual" }];
    const [entry] = unlearnCorrection(learn(manual, "he king", "Heqing"), { from: "he king", to: "Heqing" });
    expect(entry).toMatchObject({ source: "manual", alternatives: ["he ching"], learnedCounts: {} });
  });

  it("leaves typed alternatives and unknown words alone", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["he ching"], source: "manual" }];
    expect(unlearnCorrection(manual, { from: "he ching", to: "Heqing" })).toBe(manual);
    expect(unlearnCorrection(manual, { from: "x", to: "Nope" })).toBe(manual);
  });
});

describe("planSessionLearning", () => {
  it("records a fix once per pasted text across repeated edit events", () => {
    const pairs = [{ from: "Superbase", to: "Supabase" }];
    const first = planSessionLearning(pairs, new Map());
    const second = planSessionLearning(pairs, first.session);
    expect(first.record).toEqual(pairs);
    expect(second).toMatchObject({ record: [], revert: [] });
  });

  it("replaces a half-typed fix with the finished one", () => {
    const first = planSessionLearning([{ from: "super base", to: "Supa" }], new Map());
    const second = planSessionLearning([{ from: "super base", to: "Supabase" }], first.session);
    expect(second.revert).toEqual([{ from: "super base", to: "Supa" }]);
    expect(second.record).toEqual([{ from: "super base", to: "Supabase" }]);
  });

  it("does not change the session it was given", () => {
    const session = new Map<string, string>();
    planSessionLearning([{ from: "a b", to: "Ab" }], session);
    expect(session.size).toBe(0);
  });
});

describe("buildReplacementRules", () => {
  it("applies a learned multi-word mishearing right away", () => {
    expect(buildReplacementRules(learn([], "super base", "Supabase"))).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });

  it("waits for a second identical fix before replacing a single word", () => {
    expect(MIN_SINGLE_WORD_FIXES).toBe(2);
    const once = learn([], "Superbase", "Supabase");
    expect(buildReplacementRules(once)).toEqual([]);
    expect(buildReplacementRules(learn(once, "Superbase", "Supabase"))).toEqual([
      { from: "Superbase", to: "Supabase" },
    ]);
  });

  it("keeps an alternative the user typed as a rule after the same fix is learned", () => {
    const manual: Entry[] = [{ id: "m", word: "kubectl", alternatives: ["cube cuddle"], source: "manual" }];
    expect(buildReplacementRules(learn(manual, "cube cuddle", "kubectl"))).toEqual([
      { from: "cube cuddle", to: "kubectl" },
    ]);
  });

  it("emits one rule per mishearing across entries", () => {
    const entries: Entry[] = [
      { id: "a", word: "Supabase", alternatives: ["super base"], source: "manual" },
      { id: "b", word: "Superbase", alternatives: ["Super Base"], source: "manual" },
    ];
    expect(buildReplacementRules(entries)).toEqual([{ from: "super base", to: "Supabase" }]);
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
