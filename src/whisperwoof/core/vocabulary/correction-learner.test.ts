/**
 * Memory auto-learn: the pure diff that turns "the user fixed a pasted
 * transcript" into "words to remember". Imports the production
 * `extractCorrections` / `extractCorrectionPairs` from
 * `src/utils/correctionLearner.js`, which ipcHandlers `_learnCorrections`
 * calls after each debounced text-edited event.
 */

import { describe, it, expect } from "vitest";
import { extractCorrections, extractCorrectionPairs } from "../../../utils/correctionLearner";

describe("extractCorrections", () => {
  it("learns a single misheard word the user fixed", () => {
    expect(
      extractCorrections("deploy to Superbase now", "deploy to Supabase now", []),
    ).toEqual(["Supabase"]);
  });

  it("learns a word the STT split in two", () => {
    expect(
      extractCorrections("deploy to super base now", "deploy to Supabase now", []),
    ).toEqual(["Supabase"]);
  });

  it("finds the pasted region inside a longer field", () => {
    const before = "Some earlier notes in this file that the user wrote by hand. ";
    const field = `${before}deploy to Supabase now`;
    expect(extractCorrections("deploy to Superbase now", field, [])).toEqual(["Supabase"]);
  });

  it("skips words already in the dictionary (case-insensitive)", () => {
    expect(
      extractCorrections("deploy to Superbase now", "deploy to Supabase now", ["supabase"]),
    ).toEqual([]);
  });

  it("ignores untouched text", () => {
    expect(extractCorrections("hello there", "hello there", [])).toEqual([]);
  });

  it("ignores full rewrites", () => {
    expect(
      extractCorrections("send the report today", "ship quarterly numbers tomorrow", []),
    ).toEqual([]);
  });

  it("ignores unrelated word swaps", () => {
    expect(extractCorrections("meet at the cafe", "meet at the library", [])).toEqual([]);
  });

  it("ignores case-only fixes", () => {
    expect(extractCorrections("ask bob today", "ask Bob today", [])).toEqual([]);
  });

  it("ignores fixes shorter than 3 characters", () => {
    expect(extractCorrections("call el now", "call Al now", [])).toEqual([]);
  });

  it("learns each corrected word once per edit", () => {
    expect(
      extractCorrections(
        "use Superbase and Superbase auth",
        "use Supabase and Supabase auth",
        [],
      ),
    ).toEqual(["Supabase"]);
  });

  it("splits two adjacent fixed words into separate words", () => {
    expect(
      extractCorrections("ask shunade cuberniz today please", "ask Sinead Kubernetes today please", []),
    ).toEqual(["Sinead", "Kubernetes"]);
  });

  it("returns [] for empty inputs", () => {
    expect(extractCorrections("", "x", [])).toEqual([]);
    expect(extractCorrections("x", "", [])).toEqual([]);
  });
});

describe("extractCorrectionPairs", () => {
  it("pairs a split word with its fix as one phrase", () => {
    expect(extractCorrectionPairs("deploy to super base now", "deploy to Supabase now")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });

  it("pairs a single misheard word", () => {
    expect(extractCorrectionPairs("deploy to Superbase now", "deploy to Supabase now")).toEqual([
      { from: "Superbase", to: "Supabase" },
    ]);
  });

  it("keeps separate fixes in one edit apart", () => {
    expect(
      extractCorrectionPairs(
        "ask shunade to ping cuberniz today",
        "ask Sinead to ping Kubernetes today",
      ),
    ).toEqual([
      { from: "shunade", to: "Sinead" },
      { from: "cuberniz", to: "Kubernetes" },
    ]);
  });

  it("learns a split word in short dictations too", () => {
    expect(extractCorrectionPairs("super base rocks", "Supabase rocks")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
    expect(extractCorrectionPairs("super base", "Supabase")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });

  it("rejects a rewrite even when each changed word is close", () => {
    expect(extractCorrectionPairs("the cat sat mat", "the Cats Sad Mats")).toEqual([]);
  });

  it("keeps words typed next to a fix out of the pair", () => {
    expect(extractCorrectionPairs("we should use super base", "we should use Supabase today")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
    expect(extractCorrectionPairs("deploy to super base now", "deploy to the Supabase now")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
    expect(extractCorrectionPairs("um super base is down", "Supabase is down")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });

  it("keeps accented letters at word edges", () => {
    expect(extractCorrectionPairs("ask Beyonce about it", "ask Beyoncé about it")).toEqual([
      { from: "Beyonce", to: "Beyoncé" },
    ]);
  });

  it("does not filter by the dictionary (repeat fixes still count)", () => {
    expect(extractCorrectionPairs("to Superbase now", "to Supabase now")).toHaveLength(1);
  });

  it("returns [] for rewrites, unrelated swaps, case-only and short fixes", () => {
    expect(extractCorrectionPairs("send the report today", "ship quarterly numbers tomorrow")).toEqual([]);
    expect(extractCorrectionPairs("meet at the cafe", "meet at the library")).toEqual([]);
    expect(extractCorrectionPairs("ask bob today", "ask Bob today")).toEqual([]);
    expect(extractCorrectionPairs("call el now", "call Al now")).toEqual([]);
    expect(extractCorrectionPairs("", "x")).toEqual([]);
  });

  it("reports each pair once per edit", () => {
    expect(
      extractCorrectionPairs("use Superbase and Superbase auth", "use Supabase and Supabase auth"),
    ).toEqual([{ from: "Superbase", to: "Supabase" }]);
  });
});

describe("secrets are never learned", () => {
  it("learns nothing from an edit that put a password or key in the field", () => {
    expect(
      extractCorrectionPairs("the wifi password is blue horse forty two", "the wifi password is BlueHorse42!")
    ).toEqual([]);
    expect(extractCorrectionPairs("my key is s k proj", "my key is sk-proj-abcdefghijklmnopqrstuvwxyz1234")).toEqual([]);
  });

  it("still learns ordinary corrections", () => {
    expect(extractCorrectionPairs("we use super base for the back end", "we use Supabase for the back end")).toEqual([
      { from: "super base", to: "Supabase" },
    ]);
  });
});

describe("Chinese clauses are never learned as words", () => {
  // Words are split on spaces and Chinese has none: a clause between two
  // English words is one "word", and editing it used to store the clause.
  it("learns nothing from a fix inside a Chinese clause", () => {
    expect(
      extractCorrectionPairs(
        "好的 我打算明天上午和David开会 然后再说",
        "好的 我打算明天上午和david开会之后 然后再说",
      ),
    ).toEqual([]);
  });

  it("learns nothing from a short clause either", () => {
    expect(
      extractCorrectionPairs("let me 看一下这个问题 then reply", "let me 看一下那个问题 then reply"),
    ).toEqual([]);
  });

  it("skips the pair when only one side is a clause", () => {
    // only the corrected side ("…和他打电话吧")
    expect(
      extractCorrectionPairs("好的 今天晚上打电话 然后", "好的 今天晚上和他打电话吧 然后"),
    ).toEqual([]);
    // only the misheard side ("我准备…")
    expect(
      extractCorrectionPairs("好的 我准备今天晚上打电话 然后", "好的 准备今天晚上打电话 然后"),
    ).toEqual([]);
  });

  it("still learns a Chinese term fixed between English words", () => {
    expect(
      extractCorrectionPairs("I use 通一千问 for code every day", "I use 通义千问 for code every day"),
    ).toEqual([{ from: "通一千问", to: "通义千问" }]);
  });

  it("still learns an English word fixed in a mixed dictation", () => {
    expect(
      extractCorrectionPairs("我们用 super base 做后端", "我们用 Supabase 做后端"),
    ).toEqual([{ from: "super base", to: "Supabase" }]);
  });
});
