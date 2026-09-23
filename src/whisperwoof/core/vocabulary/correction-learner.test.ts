/**
 * Memory auto-learn: the pure diff that turns "the user fixed a pasted
 * transcript" into "words to remember". Imports the production
 * `extractCorrections` from `src/utils/correctionLearner.js`, which
 * ipcHandlers `_processCorrections` calls on every text-edited event.
 */

import { describe, it, expect } from "vitest";
import { extractCorrections } from "../../../utils/correctionLearner";

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

  it("ignores case-only and very short fixes", () => {
    expect(extractCorrections("ask bob today", "ask Bob today", [])).toEqual([]);
    expect(extractCorrections("go to al now", "go to Al now", [])).toEqual([]);
  });

  it("returns [] for empty inputs", () => {
    expect(extractCorrections("", "x", [])).toEqual([]);
    expect(extractCorrections("x", "", [])).toEqual([]);
  });
});
