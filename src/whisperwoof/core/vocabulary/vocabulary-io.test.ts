/**
 * Memory's disk layer (bridge/vocabulary.js) against a real temp folder:
 * removeWord hands back what it removed (the IPC layer reads its source),
 * forgetLearnedWords backs the "Learned X - Undo" toast, and forgotten
 * words stop reaching STT hints.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

let dir = "";
const require = createRequire(import.meta.url);

function loadVocabulary() {
  // The bridge is CommonJS and resolves its file path from electron at load time.
  const electronPath = require.resolve("electron");
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { app: { getPath: () => dir, isReady: () => false } },
  } as unknown as NodeJS.Module;
  delete require.cache[require.resolve("../../bridge/vocabulary.js")];
  return require("../../bridge/vocabulary.js");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ww-vocab-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("vocabulary removeWord", () => {
  it("returns the removed entry so the IPC layer can see its source", () => {
    const vocab = loadVocabulary();
    const { entry } = vocab.addWord("Supabase", { source: "auto-learn" });
    expect(vocab.removeWord(entry.id)).toEqual({ success: true, entry });
    expect(vocab.getVocabulary()).toEqual([]);
  });

  it("reports not-found without touching storage", () => {
    const vocab = loadVocabulary();
    vocab.addWord("Heqing");
    expect(vocab.removeWord("nope")).toEqual({ success: false, error: "Word not found" });
    expect(vocab.getVocabulary()).toHaveLength(1);
  });
});

describe("vocabulary forgetLearnedWords", () => {
  it("drops only auto-learned matches and reports the count", () => {
    const vocab = loadVocabulary();
    vocab.addWord("Supabase", { source: "auto-learn" });
    vocab.addWord("Heqing", { source: "manual" });
    expect(vocab.forgetLearnedWords(["supabase", "heqing"])).toEqual({ success: true, removed: 1 });
    expect(vocab.getVocabulary().map((e: { word: string }) => e.word)).toEqual(["Heqing"]);
  });

  it("is a no-op when nothing matches, so a double Undo is harmless", () => {
    const vocab = loadVocabulary();
    vocab.addWord("Supabase", { source: "auto-learn" });
    vocab.forgetLearnedWords(["Supabase"]);
    expect(vocab.forgetLearnedWords(["Supabase"])).toEqual({ success: true, removed: 0 });
  });

  it("persists to disk", () => {
    const vocab = loadVocabulary();
    vocab.addWord("Supabase", { source: "auto-learn" });
    vocab.forgetLearnedWords(["Supabase"]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "whisperwoof-vocabulary.json"), "utf-8"));
    expect(onDisk).toEqual([]);
  });

  it("stops forgotten words reaching STT hints (alternatives never do)", () => {
    const vocab = loadVocabulary();
    vocab.addWord("Supabase", { source: "auto-learn", alternatives: ["super base"] });
    expect(vocab.getSttHints()).toEqual(["Supabase"]);
    vocab.forgetLearnedWords(["Supabase"]);
    expect(vocab.getSttHints()).toEqual([]);
  });
});

describe("vocabulary recordCorrection, offers and approved swaps", () => {
  // Multi-word pairs only here: single-word offers consult the system word
  // list, which CI machines don't have (covered in memory-replacements.test).
  it("offers a swap on the second identical fix, and swaps only once approved", () => {
    const vocab = loadVocabulary();
    expect(vocab.recordCorrection({ from: "super base", to: "Supabase", bundleId: "com.microsoft.VSCode" })).toEqual({
      success: true,
      offer: null,
    });
    expect(vocab.recordCorrection({ from: "super base", to: "Supabase", bundleId: "com.microsoft.VSCode" })).toEqual({
      success: true,
      offer: { from: "super base", to: "Supabase" },
    });
    expect(vocab.applyMemoryReplacements("deploy to super base").text).toBe("deploy to super base");

    vocab.confirmSwap({ from: "super base", to: "Supabase" });
    expect(vocab.applyMemoryReplacements("deploy to super base")).toEqual({
      text: "deploy to Supabase",
      applied: [{ from: "super base", to: "Supabase" }],
    });
    expect(vocab.getVocabularyForApp("com.microsoft.VSCode").map((e: { word: string }) => e.word)).toEqual([
      "Supabase",
    ]);
  });

  it("never asks again after Not now, and never swaps", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    vocab.declineSwap({ from: "super base", to: "Supabase" });
    expect(vocab.recordCorrection({ from: "super base", to: "Supabase" }).offer).toBeNull();
    expect(vocab.recordCorrection({ from: "super base", to: "Supabase" }).offer).toBeNull();
    expect(vocab.applyMemoryReplacements("deploy to super base").text).toBe("deploy to super base");
    expect(vocab.getSttHints()).toEqual(["Supabase"]);
  });

  it("keeps learned mishearings out of STT hints", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    expect(vocab.getSttHints()).toEqual(["Supabase"]);
  });

  it("takes back a half-typed fix so the finished one wins", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supa" });
    expect(vocab.unlearnCorrection({ from: "super base", to: "Supa" })).toEqual({ removedWord: "Supa" });
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    const { offer } = vocab.recordCorrection({ from: "super base", to: "Supabase" });
    expect(offer).toEqual({ from: "super base", to: "Supabase" });
    expect(vocab.unlearnCorrection({ from: "nope", to: "Nope" })).toEqual({ removedWord: null });
  });

  it("stops swapping once the word is undone or the swap is reverted", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    vocab.confirmSwap({ from: "super base", to: "Supabase" });
    vocab.declineSwap({ from: "super base", to: "Supabase" });
    expect(vocab.applyMemoryReplacements("deploy to super base").text).toBe("deploy to super base");
  });
});

describe("vocabulary getMemorySwaps", () => {
  it("lists approved and typed swaps, not pending or declined ones, sorted by word", () => {
    const vocab = loadVocabulary();
    vocab.addWord("Heqing", { alternatives: ["he ching"] });
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    vocab.recordCorrection({ from: "cube cuddle", to: "Kubectl" });
    expect(vocab.getMemorySwaps()).toEqual([{ from: "he ching", to: "Heqing" }]);

    vocab.confirmSwap({ from: "super base", to: "Supabase" });
    vocab.confirmSwap({ from: "cube cuddle", to: "Kubectl" });
    expect(vocab.getMemorySwaps()).toEqual([
      { from: "he ching", to: "Heqing" },
      { from: "cube cuddle", to: "Kubectl" },
      { from: "super base", to: "Supabase" },
    ]);

    vocab.declineSwap({ from: "cube cuddle", to: "Kubectl" });
    expect(vocab.getMemorySwaps().map((s: { to: string }) => s.to)).toEqual(["Heqing", "Supabase"]);
  });
});
