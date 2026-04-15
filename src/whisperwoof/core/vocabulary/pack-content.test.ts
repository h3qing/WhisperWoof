/**
 * Tests that validate the built-in vocabulary pack JSON files.
 *
 * These tests load the actual pack files from resources/vocabulary-packs/
 * and verify they conform to the pack schema, contain no duplicates,
 * and have reasonable content.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { validatePack } from "./pack-types";

const PACKS_DIR = path.resolve(__dirname, "../../../../resources/vocabulary-packs");

function loadPack(filename: string) {
  const filePath = path.join(PACKS_DIR, filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function getPackFiles(): string[] {
  if (!fs.existsSync(PACKS_DIR)) return [];
  return fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith(".json"));
}

describe("built-in pack files", () => {
  const packFiles = getPackFiles();

  it("packs directory exists and contains JSON files", () => {
    expect(fs.existsSync(PACKS_DIR)).toBe(true);
    expect(packFiles.length).toBeGreaterThan(0);
  });

  it.each(packFiles)("%s passes schema validation", (filename) => {
    const pack = loadPack(filename);
    const result = validatePack(pack);
    expect(result.valid, `Validation errors: ${result.errors.join(", ")}`).toBe(true);
  });

  it.each(packFiles)("%s has unique pack ID matching filename", (filename) => {
    const pack = loadPack(filename);
    const expectedId = filename.replace(".json", "");
    expect(pack.id).toBe(expectedId);
  });

  it.each(packFiles)("%s has no duplicate words", (filename) => {
    const pack = loadPack(filename);
    const words = pack.entries.map((e: { word: string }) => e.word.toLowerCase());
    const unique = new Set(words);
    const duplicates = words.filter((w: string, i: number) => words.indexOf(w) !== i);
    expect(duplicates, `Duplicate words found: ${duplicates.join(", ")}`).toHaveLength(0);
    expect(unique.size).toBe(pack.entries.length);
  });

  it.each(packFiles)("%s has at least 10 entries", (filename) => {
    const pack = loadPack(filename);
    expect(pack.entries.length).toBeGreaterThanOrEqual(10);
  });

  it.each(packFiles)("%s entries all have non-empty words", (filename) => {
    const pack = loadPack(filename);
    for (const entry of pack.entries) {
      expect(entry.word.trim().length, `Empty word found`).toBeGreaterThan(0);
    }
  });

  it.each(packFiles)("%s alternatives are arrays of strings", (filename) => {
    const pack = loadPack(filename);
    for (const entry of pack.entries) {
      if (entry.alternatives) {
        expect(Array.isArray(entry.alternatives)).toBe(true);
        for (const alt of entry.alternatives) {
          expect(typeof alt).toBe("string");
          expect(alt.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("pack uniqueness across files", () => {
  it("no two packs share the same ID", () => {
    const packFiles = getPackFiles();
    const ids = packFiles.map((f) => loadPack(f).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("default-enabled packs exist", () => {
    const packFiles = getPackFiles();
    const defaultEnabled = packFiles
      .map((f) => loadPack(f))
      .filter((p: { defaultEnabled?: boolean }) => p.defaultEnabled);
    expect(defaultEnabled.length).toBeGreaterThan(0);
  });
});

describe("everyday-essentials.json", () => {
  it("contains key loanword categories", () => {
    const pack = loadPack("everyday-essentials.json");
    const words = pack.entries.map((e: { word: string }) => e.word.toLowerCase());

    // French loanwords
    expect(words).toContain("résumé");
    expect(words).toContain("déjà vu");

    // Japanese loanwords
    expect(words).toContain("karaoke");
    expect(words).toContain("emoji");

    // Irish names
    expect(words).toContain("siobhan");

    // Common places
    expect(words).toContain("worcestershire");
  });
});

describe("food-and-drink.json", () => {
  it("covers major cuisine categories", () => {
    const pack = loadPack("food-and-drink.json");
    const words = pack.entries.map((e: { word: string }) => e.word.toLowerCase());

    // Asian
    expect(words).toContain("pho");
    expect(words).toContain("ramen");

    // Italian
    expect(words).toContain("gnocchi");
    expect(words).toContain("bruschetta");

    // French
    expect(words).toContain("croissant");

    // Latin American
    expect(words).toContain("quinoa");
    expect(words).toContain("chipotle");

    // Middle Eastern
    expect(words).toContain("falafel");
    expect(words).toContain("shakshuka");
  });
});

describe("brands-and-products.json", () => {
  it("covers major brand categories", () => {
    const pack = loadPack("brands-and-products.json");
    const words = pack.entries.map((e: { word: string }) => e.word.toLowerCase());

    // Fashion
    expect(words).toContain("hermès");

    // Tech
    expect(words).toContain("claude code");
    expect(words).toContain("openclaw");

    // Auto
    expect(words).toContain("porsche");

    // Consumer
    expect(words).toContain("ikea");
  });
});
