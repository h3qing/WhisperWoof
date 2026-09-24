/**
 * Memory replacements: what the user taught by fixing transcripts
 * ("super base" -> Supabase) is swapped into the next transcript before
 * polish. This is the only Memory lever for engines that take no hints
 * (Parakeet, X-ASR, SenseVoice).
 */
import { describe, it, expect } from "vitest";
import {
  MAX_ENTRIES,
  applyLearnedCorrection,
  unlearnCorrection,
  dropAlternative,
} from "../../bridge/vocabulary-pure";
import {
  MIN_LEARNED_FIXES,
  MAX_ALTERNATIVES_PER_WORD,
  buildReplacementRules,
  applyReplacements,
  planSessionLearning,
  makeKnownWordChecker,
  splitReversals,
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
  // A stand-in for the system word list (/usr/share/dict/words on macOS).
  const KNOWN = new Set(["their", "there", "ill", "well", "monday", "adam", "andy", "team", "super", "base"]);
  const isKnownWord = (w: string) => KNOWN.has(w.toLowerCase());
  const twice = (entries: Entry[], from: string, to: string) => learn(learn(entries, from, to), from, to);
  const rules = (entries: Entry[]) => buildReplacementRules(entries, { isKnownWord });

  it("needs the same fix twice before any learned rule applies", () => {
    expect(MIN_LEARNED_FIXES).toBe(2);
    expect(rules(learn([], "super base", "Supabase"))).toEqual([]);
    expect(rules(twice([], "super base", "Supabase"))).toEqual([{ from: "super base", to: "Supabase" }]);
  });

  it("swaps a single misheard word only when it isn't a real word", () => {
    expect(rules(twice([], "Superbase", "Supabase"))).toEqual([{ from: "Superbase", to: "Supabase" }]);
    expect(rules(twice([], "Beyonce", "Beyoncé"))).toEqual([{ from: "Beyonce", to: "Beyoncé" }]);
    for (const [from, to] of [["Their", "There"], ["ill", "I'll"], ["Well", "We'll"], ["Monday", "Tuesday"]]) {
      expect(rules(twice([], from!, to!))).toEqual([]);
    }
  });

  it("never swaps numbers or fixes that only extend or trim the text", () => {
    expect(rules(twice([], "10", "10am"))).toEqual([]);
    expect(rules(twice([], "super base", "super base team"))).toEqual([]);
  });

  it("never swaps a phrase that contains everyday function words", () => {
    for (const [from, to] of [["and I", "Andy"], ["a team", "Adam"], ["and a", "Ana"], ["hose a", "José"]]) {
      expect(rules(twice([], from!, to!))).toEqual([]);
    }
  });

  it("never swaps a multi-word phrase into a plain lowercase word", () => {
    expect(rules(twice([], "every day", "everyday"))).toEqual([]);
    expect(rules(twice([], "gpt four", "GPT4"))).toEqual([{ from: "gpt four", to: "GPT4" }]);
  });

  it("skips single-word rules when no word list is available", () => {
    expect(buildReplacementRules(twice([], "Superbase", "Supabase"))).toEqual([]);
    expect(buildReplacementRules(twice([], "super base", "Supabase"))).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });

  it("keeps an alternative the user typed as a rule after the same fix is learned", () => {
    const manual: Entry[] = [{ id: "m", word: "kubectl", alternatives: ["cube cuddle"], source: "manual" }];
    expect(rules(learn(manual, "cube cuddle", "kubectl"))).toEqual([{ from: "cube cuddle", to: "kubectl" }]);
  });

  it("applies alternatives the user typed without waiting", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["he ching"], source: "manual" }];
    expect(rules(manual)).toEqual([{ from: "he ching", to: "Heqing" }]);
  });

  it("resolves a mishearing claimed twice: typed first, then the most-fixed", () => {
    const typed: Entry[] = [{ id: "t", word: "Supabase", alternatives: ["super base"], source: "manual" }];
    const learnedHalf = learn(learn([], "super base", "Supa"), "super base", "Supa");
    expect(rules([...learnedHalf, ...typed])).toEqual([{ from: "super base", to: "Supabase" }]);
    const three = learn(twice([], "super base", "Supabase"), "super base", "Supabase");
    expect(rules([...learnedHalf, ...three])).toEqual([{ from: "super base", to: "Supabase" }]);
  });

  it("ignores malformed entries instead of failing all rules", () => {
    const bad = [
      { id: "a", word: "Kubernetes", alternatives: "cube a", source: "import" },
      { id: "b", word: "X", alternatives: [42, null], source: "import" },
      { id: "c", alternatives: ["no word"], source: "import" },
      { id: "d", word: "Heqing", alternatives: ["he ching"], source: "manual" },
    ] as unknown as Entry[];
    expect(rules(bad)).toEqual([{ from: "he ching", to: "Heqing" }]);
  });

  it("orders longer phrases first and skips self-matches", () => {
    const entries: Entry[] = [
      { id: "a", word: "Claude", alternatives: ["clod", "claude"], source: "manual" },
      { id: "b", word: "Claude Code", alternatives: ["clod code"], source: "manual" },
    ];
    expect(rules(entries)).toEqual([
      { from: "clod code", to: "Claude Code" },
      { from: "clod", to: "Claude" },
    ]);
  });

  it("caps alternatives per word and rules overall", () => {
    const many: Entry[] = [
      { id: "m", word: "Heqing", alternatives: Array.from({ length: 50 }, (_, i) => `he ching ${i}`), source: "manual" },
    ];
    expect(rules(many)).toHaveLength(MAX_ALTERNATIVES_PER_WORD);
  });

  it("handles empty input", () => {
    expect(buildReplacementRules([])).toEqual([]);
    expect(buildReplacementRules(null)).toEqual([]);
  });
});

describe("makeKnownWordChecker", () => {
  it("answers from a newline word list, case-insensitively", () => {
    const isKnown = makeKnownWordChecker("Adam\nbase\ntheir\n");
    expect(isKnown!("adam")).toBe(true);
    expect(isKnown!("Their")).toBe(true);
    expect(isKnown!("superbase")).toBe(false);
    expect(isKnown!("ba")).toBe(false);
  });

  it("returns null without a word list", () => {
    expect(makeKnownWordChecker("")).toBeNull();
    expect(makeKnownWordChecker(null)).toBeNull();
  });
});

describe("splitReversals", () => {
  it("spots a fix that undoes a swap Memory just made", () => {
    const swaps = [{ from: "super base", to: "Supabase" }];
    const pairs = [
      { from: "Supabase", to: "super base" },
      { from: "cuberniz", to: "Kubernetes" },
    ];
    expect(splitReversals(pairs, swaps)).toEqual({
      reversals: [{ from: "super base", to: "Supabase" }],
      rest: [{ from: "cuberniz", to: "Kubernetes" }],
    });
  });

  it("passes everything through with no swaps", () => {
    const pairs = [{ from: "a b", to: "Ab" }];
    expect(splitReversals(pairs, [])).toEqual({ reversals: [], rest: pairs });
  });
});

describe("dropAlternative", () => {
  it("forgets a learned alternative and its count", () => {
    const [entry] = dropAlternative(learn([], "super base", "Supabase"), { from: "super base", to: "Supabase" });
    expect(entry).toMatchObject({ word: "Supabase", alternatives: [], learnedCounts: {} });
  });

  it("keeps alternatives the user typed", () => {
    const typed: Entry[] = [{ id: "t", word: "Supabase", alternatives: ["super base"], source: "manual" }];
    expect(dropAlternative(typed, { from: "super base", to: "Supabase" })).toBe(typed);
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

  it("treats apostrophes, underscores and dotted names as part of a word", () => {
    const r = [{ from: "don", to: "Dawn" }, { from: "base", to: "Supabase" }];
    expect(applyReplacements("I don't know", r).text).toBe("I don't know");
    expect(applyReplacements("my_base and base.py", r).text).toBe("my_base and base.py");
    expect(applyReplacements("ask don. then base, then done", r).text).toBe("ask Dawn. then Supabase, then done");
  });

  it("works next to Chinese text", () => {
    expect(applyReplacements("把项目部署到super base上", rules).text).toBe("把项目部署到Supabase上");
  });

  it("returns the text unchanged with no rules or no text", () => {
    expect(applyReplacements("hello", [])).toEqual({ text: "hello", applied: [] });
    expect(applyReplacements("", rules)).toEqual({ text: "", applied: [] });
  });
});
