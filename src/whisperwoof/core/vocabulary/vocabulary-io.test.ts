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

describe("vocabulary recordCorrection + applyMemoryReplacements", () => {
  it("replaces a learned multi-word mishearing from the first fix", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supabase", bundleId: "com.microsoft.VSCode" });
    expect(vocab.applyMemoryReplacements("deploy to super base")).toEqual({
      text: "deploy to Supabase",
      applied: [{ from: "super base", to: "Supabase" }],
    });
    expect(vocab.getVocabularyForApp("com.microsoft.VSCode").map((e: { word: string }) => e.word)).toEqual([
      "Supabase",
    ]);
  });

  it("replaces a single misheard word only after the second fix", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "Superbase", to: "Supabase" });
    expect(vocab.applyMemoryReplacements("to Superbase").text).toBe("to Superbase");
    vocab.recordCorrection({ from: "Superbase", to: "Supabase" });
    expect(vocab.applyMemoryReplacements("to Superbase").text).toBe("to Supabase");
  });

  it("keeps learned mishearings out of STT hints", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    expect(vocab.getSttHints()).toEqual(["Supabase"]);
  });

  it("stops replacing once the learned word is undone", () => {
    const vocab = loadVocabulary();
    vocab.recordCorrection({ from: "super base", to: "Supabase" });
    vocab.forgetLearnedWords(["Supabase"]);
    expect(vocab.applyMemoryReplacements("deploy to super base").text).toBe("deploy to super base");
  });
});
