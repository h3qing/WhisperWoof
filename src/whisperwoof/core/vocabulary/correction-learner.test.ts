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

  it("treats two adjacent fixed words as one phrase", () => {
    expect(
      extractCorrections("ask shunade cuberniz today please", "ask Sinead Kubernetes today please", []),
    ).toEqual(["Sinead Kubernetes"]);
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
