/**
 * Tests for Polish Presets — prompt content verification and preset system.
 *
 * These tests verify that:
 * 1. All presets contain required formatting instructions (list line breaks, paragraph separation)
 * 2. The preset system functions (getBuiltInPresetPrompt, getBuiltInPreset) work correctly
 * 3. Preset structure is correct
 *
 * Imports from polish-presets-pure.js (no electron dependency) so these tests
 * run without mocking electron. Custom preset persistence (which requires electron)
 * is not tested here — it lives in polish-presets.js.
 */

import { describe, it, expect } from "vitest";

const {
  PRESETS,
  DEFAULT_PRESET_ID,
  getBuiltInPresetPrompt,
  getBuiltInPreset,
} = await import("../../bridge/polish-presets-pure");

// ---------------------------------------------------------------------------
// Preset structure
// ---------------------------------------------------------------------------

describe("Preset structure", () => {
  it("has all five built-in presets", () => {
    expect(Object.keys(PRESETS)).toEqual([
      "clean",
      "professional",
      "casual",
      "minimal",
      "structured",
    ]);
  });

  it("each preset has required fields", () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const p = preset as { id: string; name: string; description: string; prompt: string };
      expect(p.id).toBe(key);
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
      expect(typeof p.description).toBe("string");
      expect(p.description.length).toBeGreaterThan(0);
      expect(typeof p.prompt).toBe("string");
      expect(p.prompt.length).toBeGreaterThan(0);
    }
  });

  it("default preset is clean", () => {
    expect(DEFAULT_PRESET_ID).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// List formatting instructions — every applicable preset must tell the LLM
// to format lists with line breaks (one item per line)
// ---------------------------------------------------------------------------

describe("List formatting instructions", () => {
  it("clean preset instructs line-break-separated lists", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).clean.prompt;
    expect(prompt).toMatch(/each item on its own line/i);
    expect(prompt).toMatch(/not collapse/i);
  });

  it("professional preset instructs line-break-separated lists", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).professional.prompt;
    expect(prompt).toMatch(/each item on its own line/i);
    expect(prompt).toMatch(/never collapse/i);
  });

  it("casual preset instructs list formatting when speaker clearly intends a list", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).casual.prompt;
    expect(prompt).toMatch(/each item on its own line/i);
  });

  it("structured preset instructs lists with each item on its own line", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).structured.prompt;
    expect(prompt).toMatch(/each item on its own line/i);
  });

  it("minimal preset does NOT instruct list formatting (by design)", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).minimal.prompt;
    expect(prompt).toMatch(/do NOT add formatting/i);
    expect(prompt).not.toMatch(/each item on its own line/i);
  });
});

// ---------------------------------------------------------------------------
// Paragraph separation instructions — presets should tell the LLM to
// separate different topics into distinct paragraphs
// ---------------------------------------------------------------------------

describe("Paragraph separation instructions", () => {
  it("clean preset instructs paragraph separation on topic shift", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).clean.prompt;
    expect(prompt).toMatch(/new paragraph/i);
    expect(prompt).toMatch(/topic/i);
    expect(prompt).toMatch(/blank line/i);
  });

  it("professional preset instructs paragraph separation on topic shift", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).professional.prompt;
    expect(prompt).toMatch(/new paragraph/i);
    expect(prompt).toMatch(/topic/i);
    expect(prompt).toMatch(/blank line/i);
  });

  it("casual preset instructs paragraph separation on topic shift", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).casual.prompt;
    expect(prompt).toMatch(/new paragraph/i);
    expect(prompt).toMatch(/topic/i);
  });

  it("structured preset instructs topic separation into sections", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).structured.prompt;
    expect(prompt).toMatch(/topic/i);
    expect(prompt).toMatch(/section/i);
  });

  it("minimal preset does NOT instruct paragraph separation (by design)", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).minimal.prompt;
    expect(prompt).not.toMatch(/new paragraph/i);
    expect(prompt).not.toMatch(/blank line between/i);
  });
});

// ---------------------------------------------------------------------------
// Prompt content — specific instruction phrases that guard against regressions
// ---------------------------------------------------------------------------

describe("Prompt content guards", () => {
  it("clean preset mentions LIST FORMATTING as a labeled rule", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).clean.prompt;
    expect(prompt).toContain("LIST FORMATTING");
  });

  it("clean preset mentions PARAGRAPH SEPARATION as a labeled rule", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).clean.prompt;
    expect(prompt).toContain("PARAGRAPH SEPARATION");
  });

  it("professional preset mentions LIST FORMATTING as a labeled rule", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).professional.prompt;
    expect(prompt).toContain("LIST FORMATTING");
  });

  it("professional preset mentions PARAGRAPH SEPARATION as a labeled rule", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).professional.prompt;
    expect(prompt).toContain("PARAGRAPH SEPARATION");
  });

  it("clean preset still contains core cleanup rules", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).clean.prompt;
    expect(prompt).toMatch(/filler words/i);
    expect(prompt).toMatch(/punctuation/i);
    expect(prompt).toMatch(/grammar/i);
    expect(prompt).toMatch(/return only/i);
  });

  it("professional preset still contains professional tone rules", () => {
    const prompt = (PRESETS as Record<string, { prompt: string }>).professional.prompt;
    expect(prompt).toMatch(/hedging language/i);
    expect(prompt).toMatch(/confident/i);
    expect(prompt).toMatch(/return only/i);
  });
});

// ---------------------------------------------------------------------------
// getBuiltInPresetPrompt()
// ---------------------------------------------------------------------------

describe("getBuiltInPresetPrompt", () => {
  it("returns the prompt for a valid preset ID", () => {
    const prompt = getBuiltInPresetPrompt("clean");
    expect(prompt).toBe((PRESETS as Record<string, { prompt: string }>).clean.prompt);
  });

  it("returns the prompt for each built-in preset", () => {
    for (const key of Object.keys(PRESETS)) {
      const prompt = getBuiltInPresetPrompt(key);
      expect(prompt).toBe((PRESETS as Record<string, { prompt: string }>)[key].prompt);
    }
  });

  it("returns default (clean) prompt for unknown preset ID", () => {
    const prompt = getBuiltInPresetPrompt("nonexistent-preset");
    expect(prompt).toBe((PRESETS as Record<string, { prompt: string }>).clean.prompt);
  });

  it("returns default prompt for null/undefined", () => {
    const prompt = getBuiltInPresetPrompt(null as unknown as string);
    expect(prompt).toBe((PRESETS as Record<string, { prompt: string }>).clean.prompt);
  });
});

// ---------------------------------------------------------------------------
// getBuiltInPreset()
// ---------------------------------------------------------------------------

describe("getBuiltInPreset", () => {
  it("returns the full preset object for a valid ID", () => {
    const preset = getBuiltInPreset("professional");
    expect(preset.id).toBe("professional");
    expect(preset.name).toBe("Professional");
    expect(typeof preset.prompt).toBe("string");
  });

  it("returns default (clean) preset for unknown ID", () => {
    const preset = getBuiltInPreset("nonexistent");
    expect(preset.id).toBe("clean");
  });

  it("returns default (clean) preset for undefined", () => {
    const preset = getBuiltInPreset(undefined as unknown as string);
    expect(preset.id).toBe("clean");
  });
});
