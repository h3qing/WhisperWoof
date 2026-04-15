/**
 * Tests for Vocabulary Pack pure logic.
 *
 * Covers pack validation, install state management, hint merging,
 * prompt truncation, and pack update detection.
 */

import { describe, it, expect } from "vitest";
import {
  WHISPER_PROMPT_TOKEN_LIMIT,
  CHARS_PER_TOKEN,
  MAX_HINT_CHARS,
  listPacksWithState,
  createDefaultInstallState,
  enablePack,
  disablePack,
  togglePackEntry,
  getActivePackEntries,
  mergePackHints,
  truncateHintsToPrompt,
  packHasUpdate,
  validatePacks,
} from "./pack-manager-pure";

import { validatePack, packSummary, PACK_CATEGORIES } from "./pack-types";

// --- Test fixtures ---

interface PackEntry {
  word: string;
  alternatives?: string[];
  category?: string;
}

interface VocabularyPack {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags?: string[];
  defaultEnabled?: boolean;
  entries: PackEntry[];
}

interface PackInstallState {
  packId: string;
  enabled: boolean;
  installedVersion: string;
  disabledEntries?: string[];
}

const FOOD_PACK: VocabularyPack = {
  id: "food-and-drink",
  name: "Food & Drink",
  description: "International cuisine terms",
  version: "1.0.0",
  author: "WhisperWoof",
  category: "food",
  tags: ["cuisine", "cooking"],
  defaultEnabled: true,
  entries: [
    { word: "pho", alternatives: ["fuh", "foe"] },
    { word: "gnocchi", alternatives: ["nyoh key"] },
    { word: "bruschetta", alternatives: ["broo sket tah"] },
    { word: "quinoa", alternatives: ["keen wah"] },
    { word: "açaí", alternatives: ["ah sah ee", "acai"] },
  ],
};

const BRANDS_PACK: VocabularyPack = {
  id: "brands-and-products",
  name: "Brands & Products",
  description: "Popular consumer brands",
  version: "1.0.0",
  author: "WhisperWoof",
  category: "brands",
  defaultEnabled: true,
  entries: [
    { word: "Hermès", alternatives: ["air mez", "hermes"] },
    { word: "Chipotle", alternatives: ["chih poht lay"] },
    { word: "Claude Code", alternatives: ["clod code"] },
  ],
};

const TECH_PACK: VocabularyPack = {
  id: "tech-dev",
  name: "Tech & Dev",
  description: "Developer terminology",
  version: "2.0.0",
  author: "WhisperWoof",
  category: "tech",
  defaultEnabled: false,
  entries: [
    { word: "Kubernetes", alternatives: ["koo ber net eez"] },
    { word: "TypeScript", alternatives: ["type script"] },
  ],
};

// --- Pack validation ---

describe("validatePack", () => {
  it("validates a well-formed pack", () => {
    const result = validatePack(FOOD_PACK);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null / non-object input", () => {
    expect(validatePack(null).valid).toBe(false);
    expect(validatePack(undefined).valid).toBe(false);
    expect(validatePack("string").valid).toBe(false);
  });

  it("rejects pack missing required fields", () => {
    const result = validatePack({ id: "test", entries: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: string) => e.includes("name"))).toBe(true);
    expect(result.errors.some((e: string) => e.includes("version"))).toBe(true);
  });

  it("rejects pack with non-array entries", () => {
    const result = validatePack({
      id: "test",
      name: "Test",
      version: "1.0.0",
      author: "Test",
      category: "test",
      entries: "not an array",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("'entries' must be an array");
  });

  it("rejects entries with missing or empty word", () => {
    const result = validatePack({
      ...FOOD_PACK,
      entries: [{ word: "" }, { word: "valid" }, { alternatives: ["test"] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("Entry 0"))).toBe(true);
    expect(result.errors.some((e: string) => e.includes("Entry 2"))).toBe(true);
  });

  it("rejects entries with non-array alternatives", () => {
    const result = validatePack({
      ...FOOD_PACK,
      entries: [{ word: "test", alternatives: "not array" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("alternatives"))).toBe(true);
  });
});

describe("validatePacks", () => {
  it("separates valid and invalid packs", () => {
    const { valid, errors } = validatePacks([FOOD_PACK, { id: "bad" }, BRANDS_PACK]);
    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe("bad");
  });

  it("handles null / empty input", () => {
    expect(validatePacks(null).valid).toHaveLength(0);
    expect(validatePacks([]).valid).toHaveLength(0);
  });
});

// --- Pack summary ---

describe("packSummary", () => {
  it("computes entry count and category breakdown", () => {
    const summary = packSummary(FOOD_PACK);
    expect(summary.id).toBe("food-and-drink");
    expect(summary.entryCount).toBe(5);
    expect(summary.name).toBe("Food & Drink");
    expect(summary.version).toBe("1.0.0");
  });

  it("handles pack with no entries", () => {
    const summary = packSummary({ ...FOOD_PACK, entries: [] });
    expect(summary.entryCount).toBe(0);
  });

  it("handles null pack", () => {
    const summary = packSummary(null);
    expect(summary.entryCount).toBe(0);
  });
});

// --- Install state management ---

describe("createDefaultInstallState", () => {
  it("respects defaultEnabled: true", () => {
    const state = createDefaultInstallState(FOOD_PACK);
    expect(state.packId).toBe("food-and-drink");
    expect(state.enabled).toBe(true);
    expect(state.installedVersion).toBe("1.0.0");
    expect(state.disabledEntries).toEqual([]);
  });

  it("respects defaultEnabled: false", () => {
    const state = createDefaultInstallState(TECH_PACK);
    expect(state.enabled).toBe(false);
  });
});

describe("enablePack", () => {
  it("enables a pack with no prior state", () => {
    const state = enablePack(null, TECH_PACK);
    expect(state.enabled).toBe(true);
    expect(state.packId).toBe("tech-dev");
    expect(state.installedVersion).toBe("2.0.0");
  });

  it("enables a previously disabled pack, preserving disabledEntries", () => {
    const prior: PackInstallState = {
      packId: "tech-dev",
      enabled: false,
      installedVersion: "1.0.0",
      disabledEntries: ["Kubernetes"],
    };
    const state = enablePack(prior, TECH_PACK);
    expect(state.enabled).toBe(true);
    expect(state.installedVersion).toBe("2.0.0");
    expect(state.disabledEntries).toEqual(["Kubernetes"]);
  });
});

describe("disablePack", () => {
  it("disables a pack", () => {
    const prior: PackInstallState = {
      packId: "food-and-drink",
      enabled: true,
      installedVersion: "1.0.0",
      disabledEntries: [],
    };
    const state = disablePack(prior, FOOD_PACK);
    expect(state.enabled).toBe(false);
  });

  it("creates disabled state from scratch", () => {
    const state = disablePack(null, FOOD_PACK);
    expect(state.enabled).toBe(false);
    expect(state.packId).toBe("food-and-drink");
  });
});

describe("togglePackEntry", () => {
  const baseState: PackInstallState = {
    packId: "food-and-drink",
    enabled: true,
    installedVersion: "1.0.0",
    disabledEntries: [],
  };

  it("adds a word to disabledEntries", () => {
    const state = togglePackEntry(baseState, "pho");
    expect(state.disabledEntries).toContain("pho");
  });

  it("removes a word from disabledEntries (re-enable)", () => {
    const withDisabled = { ...baseState, disabledEntries: ["pho"] };
    const state = togglePackEntry(withDisabled, "pho");
    expect(state.disabledEntries).not.toContain("pho");
  });

  it("is case-insensitive for matching", () => {
    const withDisabled = { ...baseState, disabledEntries: ["Pho"] };
    const state = togglePackEntry(withDisabled, "pho");
    expect(state.disabledEntries).not.toContain("Pho");
  });

  it("does not mutate the original state", () => {
    const original = { ...baseState, disabledEntries: ["pho"] };
    const copy = { ...original, disabledEntries: [...original.disabledEntries] };
    togglePackEntry(original, "pho");
    expect(original).toEqual(copy);
  });
});

// --- Active entries ---

describe("getActivePackEntries", () => {
  const enabledState: PackInstallState = {
    packId: "food-and-drink",
    enabled: true,
    installedVersion: "1.0.0",
    disabledEntries: [],
  };

  it("returns all entries for an enabled pack with no overrides", () => {
    const entries = getActivePackEntries(FOOD_PACK, enabledState);
    expect(entries).toHaveLength(5);
  });

  it("filters out user-disabled entries", () => {
    const state = { ...enabledState, disabledEntries: ["pho", "quinoa"] };
    const entries = getActivePackEntries(FOOD_PACK, state);
    expect(entries).toHaveLength(3);
    expect(entries.map((e: PackEntry) => e.word)).not.toContain("pho");
    expect(entries.map((e: PackEntry) => e.word)).not.toContain("quinoa");
  });

  it("returns empty for disabled pack", () => {
    const state = { ...enabledState, enabled: false };
    expect(getActivePackEntries(FOOD_PACK, state)).toHaveLength(0);
  });

  it("returns empty for null state", () => {
    expect(getActivePackEntries(FOOD_PACK, null)).toHaveLength(0);
  });

  it("returns empty for null pack", () => {
    expect(getActivePackEntries(null, enabledState)).toHaveLength(0);
  });
});

// --- Hint merging ---

describe("mergePackHints", () => {
  const enabledState = (packId: string): PackInstallState => ({
    packId,
    enabled: true,
    installedVersion: "1.0.0",
    disabledEntries: [],
  });

  it("puts user hints before pack hints", () => {
    const userHints = ["MyCustomWord", "AnotherWord"];
    const packStates = [{ pack: FOOD_PACK, state: enabledState("food-and-drink") }];
    const merged = mergePackHints(userHints, packStates);

    expect(merged[0]).toBe("MyCustomWord");
    expect(merged[1]).toBe("AnotherWord");
    expect(merged).toContain("pho");
    expect(merged.indexOf("MyCustomWord")).toBeLessThan(merged.indexOf("pho"));
  });

  it("deduplicates across user hints and pack entries", () => {
    const userHints = ["pho", "gnocchi"];
    const packStates = [{ pack: FOOD_PACK, state: enabledState("food-and-drink") }];
    const merged = mergePackHints(userHints, packStates);

    const phoOccurrences = merged.filter((h: string) => h.toLowerCase() === "pho");
    expect(phoOccurrences).toHaveLength(1);
  });

  it("includes alternatives from pack entries", () => {
    const packStates = [{ pack: FOOD_PACK, state: enabledState("food-and-drink") }];
    const merged = mergePackHints([], packStates);

    expect(merged).toContain("fuh"); // pho alternative
    expect(merged).toContain("keen wah"); // quinoa alternative
  });

  it("merges multiple packs", () => {
    const packStates = [
      { pack: FOOD_PACK, state: enabledState("food-and-drink") },
      { pack: BRANDS_PACK, state: enabledState("brands-and-products") },
    ];
    const merged = mergePackHints([], packStates);

    expect(merged).toContain("pho");
    expect(merged).toContain("Hermès");
    expect(merged).toContain("Claude Code");
  });

  it("skips disabled packs", () => {
    const disabledState: PackInstallState = {
      packId: "food-and-drink",
      enabled: false,
      installedVersion: "1.0.0",
      disabledEntries: [],
    };
    const merged = mergePackHints([], [{ pack: FOOD_PACK, state: disabledState }]);
    expect(merged).toHaveLength(0);
  });

  it("handles empty inputs", () => {
    expect(mergePackHints([], [])).toHaveLength(0);
    expect(mergePackHints(null, null)).toHaveLength(0);
  });
});

// --- Prompt truncation ---

describe("truncateHintsToPrompt", () => {
  it("returns all hints if they fit", () => {
    const hints = ["pho", "gnocchi", "quinoa"];
    const result = truncateHintsToPrompt(hints);
    expect(result).toBe("pho, gnocchi, quinoa");
  });

  it("truncates to fit within maxChars", () => {
    const hints = Array.from({ length: 200 }, (_, i) => `word${i}`);
    const result = truncateHintsToPrompt(hints, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.length).toBeGreaterThan(0);
    expect(result.endsWith(", ")).toBe(false); // No trailing separator
  });

  it("respects the default MAX_HINT_CHARS limit", () => {
    const longHints = Array.from({ length: 500 }, (_, i) => `LongVocabularyWord${i}`);
    const result = truncateHintsToPrompt(longHints);
    expect(result.length).toBeLessThanOrEqual(MAX_HINT_CHARS);
  });

  it("returns empty string for empty input", () => {
    expect(truncateHintsToPrompt([])).toBe("");
    expect(truncateHintsToPrompt(null)).toBe("");
  });

  it("handles single very long word exceeding limit", () => {
    const result = truncateHintsToPrompt(["a".repeat(10)], 5);
    // Single word doesn't fit — returns empty
    expect(result).toBe("");
  });

  it("preserves word boundaries (no partial words)", () => {
    const hints = ["short", "medium_word", "another"];
    const result = truncateHintsToPrompt(hints, 20);
    // "short, medium_word" = 18 chars, fits
    // "short, medium_word, another" = 27 chars, too long
    expect(result).toBe("short, medium_word");
  });
});

// --- Pack listing with state ---

describe("listPacksWithState", () => {
  it("merges pack summaries with install state", () => {
    const states: PackInstallState[] = [
      { packId: "food-and-drink", enabled: true, installedVersion: "1.0.0", disabledEntries: ["pho"] },
      { packId: "brands-and-products", enabled: false, installedVersion: "1.0.0", disabledEntries: [] },
    ];
    const result = listPacksWithState([FOOD_PACK, BRANDS_PACK], states);

    expect(result).toHaveLength(2);
    expect(result[0]!.enabled).toBe(true);
    expect(result[0]!.disabledEntryCount).toBe(1);
    expect(result[1]!.enabled).toBe(false);
  });

  it("defaults to disabled for packs without install state", () => {
    const result = listPacksWithState([FOOD_PACK], []);
    expect(result[0]!.enabled).toBe(false);
    expect(result[0]!.installedVersion).toBeNull();
  });

  it("includes pack metadata in results", () => {
    const result = listPacksWithState([FOOD_PACK], []);
    expect(result[0]!.name).toBe("Food & Drink");
    expect(result[0]!.entryCount).toBe(5);
    expect(result[0]!.category).toBe("food");
  });
});

// --- Pack update detection ---

describe("packHasUpdate", () => {
  it("detects version mismatch", () => {
    const state: PackInstallState = {
      packId: "tech-dev",
      enabled: true,
      installedVersion: "1.0.0",
      disabledEntries: [],
    };
    expect(packHasUpdate(TECH_PACK, state)).toBe(true); // TECH_PACK is 2.0.0
  });

  it("returns false when versions match", () => {
    const state: PackInstallState = {
      packId: "food-and-drink",
      enabled: true,
      installedVersion: "1.0.0",
      disabledEntries: [],
    };
    expect(packHasUpdate(FOOD_PACK, state)).toBe(false);
  });

  it("returns false for null state", () => {
    expect(packHasUpdate(FOOD_PACK, null)).toBe(false);
  });
});

// --- Constants ---

describe("constants", () => {
  it("has sensible Whisper prompt limits", () => {
    expect(WHISPER_PROMPT_TOKEN_LIMIT).toBe(224);
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(MAX_HINT_CHARS).toBe(896);
  });

  it("PACK_CATEGORIES contains expected categories", () => {
    expect(PACK_CATEGORIES).toContain("essentials");
    expect(PACK_CATEGORIES).toContain("food");
    expect(PACK_CATEGORIES).toContain("brands");
    expect(PACK_CATEGORIES).toContain("medical");
    expect(PACK_CATEGORIES).toContain("tech");
  });
});
