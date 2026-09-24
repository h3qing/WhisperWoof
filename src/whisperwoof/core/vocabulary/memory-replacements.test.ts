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
  confirmAlternative,
  declineAlternative,
} from "../../bridge/vocabulary-pure";
import {
  MIN_LEARNED_FIXES,
  MAX_ALTERNATIVES_PER_WORD,
  buildReplacementRules,
  applyReplacements,
  planSessionLearning,
  makeKnownWordChecker,
  splitReversals,
  swapOffer,
} from "./memory-replacements";

const NOW = "2026-09-24T00:00:00.000Z";

interface Entry {
  id: string;
  word: string;
  alternatives: string[];
  source: string;
  learnedCounts?: Record<string, number>;
  declinedAlternatives?: string[];
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
  const twice = (entries: Entry[], from: string, to: string) => learn(learn(entries, from, to), from, to);

  it("never turns a learned fix into a rule by itself, only an approved one", () => {
    const learned = twice([], "super base", "Supabase");
    expect(buildReplacementRules(learned)).toEqual([]);
    const approved = confirmAlternative(learned, { from: "super base", to: "Supabase" });
    expect(buildReplacementRules(approved)).toEqual([{ from: "super base", to: "Supabase" }]);
  });

  it("applies alternatives the user typed", () => {
    const manual: Entry[] = [{ id: "m", word: "Heqing", alternatives: ["he ching"], source: "manual" }];
    expect(buildReplacementRules(manual)).toEqual([{ from: "he ching", to: "Heqing" }]);
  });

  it("keeps a typed alternative as a rule after the same fix is learned", () => {
    const manual: Entry[] = [{ id: "m", word: "kubectl", alternatives: ["cube cuddle"], source: "manual" }];
    expect(buildReplacementRules(learn(manual, "cube cuddle", "kubectl"))).toEqual([
      { from: "cube cuddle", to: "kubectl" },
    ]);
  });

  it("gives a mishearing claimed twice to the first word that has it", () => {
    const entries: Entry[] = [
      { id: "a", word: "Supabase", alternatives: ["super base"], source: "manual" },
      { id: "b", word: "Superbase", alternatives: ["Super Base"], source: "manual" },
    ];
    expect(buildReplacementRules(entries)).toEqual([{ from: "super base", to: "Supabase" }]);
  });

  it("ignores malformed entries instead of failing all rules", () => {
    const bad = [
      { id: "a", word: "Kubernetes", alternatives: "cube a", source: "import" },
      { id: "b", word: "X", alternatives: [42, null], source: "import" },
      { id: "c", alternatives: ["no word"], source: "import" },
      { id: "d", word: "Heqing", alternatives: ["he ching"], source: "manual" },
    ] as unknown as Entry[];
    expect(buildReplacementRules(bad)).toEqual([{ from: "he ching", to: "Heqing" }]);
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

  it("caps alternatives per word", () => {
    const many: Entry[] = [
      { id: "m", word: "Heqing", alternatives: Array.from({ length: 50 }, (_, i) => `he ching ${i}`), source: "manual" },
    ];
    expect(buildReplacementRules(many)).toHaveLength(MAX_ALTERNATIVES_PER_WORD);
  });

  it("handles empty input", () => {
    expect(buildReplacementRules([])).toEqual([]);
    expect(buildReplacementRules(null)).toEqual([]);
  });
});

describe("swapOffer", () => {
  // A stand-in for the system word list (/usr/share/dict/words on macOS).
  const KNOWN = new Set(["their", "there", "ill", "well", "monday", "adam", "andy", "team", "let", "bill", "test", "go"]);
  const isKnownWord = (w: string) => KNOWN.has(w.toLowerCase());
  const offer = (entries: Entry[], from: string, to: string) => swapOffer(entries, { from, to }, { isKnownWord });
  const twice = (entries: Entry[], from: string, to: string) => learn(learn(entries, from, to), from, to);

  it("offers after the same fix twice, not once", () => {
    expect(MIN_LEARNED_FIXES).toBe(2);
    expect(offer(learn([], "super base", "Supabase"), "super base", "Supabase")).toBe(false);
    expect(offer(twice([], "super base", "Supabase"), "super base", "Supabase")).toBe(true);
    expect(offer(twice([], "Superbase", "Supabase"), "Superbase", "Supabase")).toBe(true);
  });

  it("never offers to swap a real word, including plurals and past tenses", () => {
    for (const [from, to] of [["Their", "There"], ["ill", "I'll"], ["Monday", "Tuesday"], ["lets", "let's"], ["bills", "Bill's"], ["tested", "Tess"], ["going", "Goin"]]) {
      expect(offer(twice([], from!, to!), from!, to!)).toBe(false);
    }
  });

  it("never offers numbers, extend/trim edits, function-word phrases or lowercase targets", () => {
    expect(offer(twice([], "10", "10am"), "10", "10am")).toBe(false);
    expect(offer(twice([], "super base", "super base team"), "super base", "super base team")).toBe(false);
    expect(offer(twice([], "a team", "Adam"), "a team", "Adam")).toBe(false);
    expect(offer(twice([], "every day", "everyday"), "every day", "everyday")).toBe(false);
  });

  it("never offers a single word without a word list", () => {
    const entries = twice([], "Superbase", "Supabase");
    expect(swapOffer(entries, { from: "Superbase", to: "Supabase" })).toBe(false);
  });

  it("never re-offers a declined or already approved swap", () => {
    const learned = twice([], "super base", "Supabase");
    const declined = declineAlternative(learned, { from: "super base", to: "Supabase" });
    expect(offer(twice(declined, "super base", "Supabase"), "super base", "Supabase")).toBe(false);
    const approved = confirmAlternative(learned, { from: "super base", to: "Supabase" });
    expect(offer(approved, "super base", "Supabase")).toBe(false);
  });

  it("never offers the inverse of an existing rule", () => {
    const typed: Entry[] = [{ id: "t", word: "Vercel", alternatives: ["versel"], source: "manual" }];
    const flipped = twice(typed, "Vercel", "versel");
    expect(offer(flipped, "Vercel", "versel")).toBe(false);
  });
});

describe("confirmAlternative / declineAlternative", () => {
  it("confirming turns a learned mishearing into an approved one", () => {
    const [entry] = confirmAlternative(learn([], "super base", "Supabase"), { from: "super base", to: "Supabase" });
    expect(entry).toMatchObject({ alternatives: ["super base"], learnedCounts: {} });
  });

  it("declining forgets the mishearing and remembers not to ask again", () => {
    const [entry] = declineAlternative(learn([], "super base", "Supabase"), { from: "Super-Base", to: "Supabase" });
    expect(entry).toMatchObject({ word: "Supabase", alternatives: [], learnedCounts: {}, declinedAlternatives: ["super base"] });
  });

  it("declining also removes an approved or typed swap (the user reverted it)", () => {
    const typed: Entry[] = [{ id: "t", word: "Supabase", alternatives: ["super base"], source: "manual" }];
    const [entry] = declineAlternative(typed, { from: "super base", to: "Supabase" });
    expect(entry!.alternatives).toEqual([]);
    expect(buildReplacementRules([entry!])).toEqual([]);
  });

  it("a declined mishearing is not learned again", () => {
    const declined = declineAlternative(learn([], "super base", "Supabase"), { from: "super base", to: "Supabase" });
    const [entry] = learn(declined, "super base", "Supabase");
    expect(entry).toMatchObject({ alternatives: [], learnedCounts: {} });
  });

  it("leaves unknown words alone", () => {
    const list: Entry[] = [{ id: "t", word: "Heqing", alternatives: [], source: "manual" }];
    expect(confirmAlternative(list, { from: "x", to: "Nope" })).toBe(list);
    expect(declineAlternative(list, { from: "x", to: "Nope" })).toBe(list);
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

  it("treats apostrophes inside words, underscores and dotted names as part of a word", () => {
    const r = [{ from: "don", to: "Dawn" }, { from: "base", to: "Supabase" }];
    expect(applyReplacements("I don't know", r).text).toBe("I don't know");
    expect(applyReplacements("my_base and base.py", r).text).toBe("my_base and base.py");
    expect(applyReplacements("ask don. then base, then done", r).text).toBe("ask Dawn. then Supabase, then done");
  });

  it("still swaps before a possessive 's and inside quotes", () => {
    const r = [{ from: "super base", to: "Supabase" }];
    expect(applyReplacements("the super base's API", r).text).toBe("the Supabase's API");
    expect(applyReplacements("try 'super base' or ‘super base’", r).text).toBe("try 'Supabase' or ‘Supabase’");
  });

  it("keeps combining marks inside a word", () => {
    const r = [{ from: "Beyonce", to: "Beyoncé" }];
    expect(applyReplacements("Beyonce\u0301 sang", r).text).toBe("Beyonce\u0301 sang");
  });

  it("works next to Chinese text", () => {
    expect(applyReplacements("把项目部署到super base上", rules).text).toBe("把项目部署到Supabase上");
  });

  it("returns the text unchanged with no rules or no text", () => {
    expect(applyReplacements("hello", [])).toEqual({ text: "hello", applied: [] });
    expect(applyReplacements("", rules)).toEqual({ text: "", applied: [] });
  });
});
