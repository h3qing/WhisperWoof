/**
 * Tests for Polish Presets — prompt content verification and preset system.
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

type Preset = { id: string; name: string; description: string; prompt: string };
const PRESET_MAP = PRESETS as Record<string, Preset>;

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
      const p = preset as Preset;
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
// Core prompt content — every cleanup-style preset must specify its core job
// ---------------------------------------------------------------------------

describe("Core prompt content", () => {
  it("clean preset covers filler words, punctuation, grammar, and output discipline", () => {
    const prompt = PRESET_MAP.clean.prompt;
    expect(prompt).toMatch(/filler words/i);
    expect(prompt).toMatch(/punctuation/i);
    expect(prompt).toMatch(/grammar/i);
    expect(prompt).toMatch(/return only/i);
  });

  it("professional preset removes hedging and demands a confident tone", () => {
    const prompt = PRESET_MAP.professional.prompt;
    expect(prompt).toMatch(/hedging language/i);
    expect(prompt).toMatch(/confident/i);
    expect(prompt).toMatch(/return only/i);
  });

  it("minimal preset locks down all structural changes", () => {
    const prompt = PRESET_MAP.minimal.prompt;
    expect(prompt).toMatch(/do NOT change grammar/i);
    expect(prompt).toMatch(/do NOT add formatting/i);
    expect(prompt).toMatch(/do NOT rephrase/i);
  });

  it("structured preset asks for Markdown headings", () => {
    const prompt = PRESET_MAP.structured.prompt;
    expect(prompt).toMatch(/markdown/i);
    expect(prompt).toMatch(/##/);
  });
});

// ---------------------------------------------------------------------------
// Regression guards
//
// Small local models (llama3.2:1b/3b, qwen2.5:3b — the Ollama defaults this
// project ships with) cannot reliably follow subjective instructions like
// "detect topic changes" or "format each item on its own line." When they
// try, the failure modes are:
//   - duplicating cleaned content across paragraphs
//   - applying random Title Case
//   - prepending "Here is the cleaned-up version:" preambles
//   - refusing simple inputs as if they were chat questions
//
// These tests guard against re-introducing the offending instructions in the
// `clean` and `professional` presets that are most commonly used.
// See commit `dddf61f87` for the original failure case.
// ---------------------------------------------------------------------------

describe("Regression guards (no subjective rules in default presets)", () => {
  it("clean preset does not contain a PARAGRAPH SEPARATION rule", () => {
    const prompt = PRESET_MAP.clean.prompt;
    expect(prompt).not.toMatch(/PARAGRAPH SEPARATION/);
    expect(prompt).not.toMatch(/detect topic changes/i);
    expect(prompt).not.toMatch(/start a new paragraph/i);
  });

  it("professional preset does not contain a PARAGRAPH SEPARATION rule", () => {
    const prompt = PRESET_MAP.professional.prompt;
    expect(prompt).not.toMatch(/PARAGRAPH SEPARATION/);
    expect(prompt).not.toMatch(/detect topic changes/i);
  });

  it("clean preset does not contain a 'do NOT collapse' list rule", () => {
    const prompt = PRESET_MAP.clean.prompt;
    expect(prompt).not.toMatch(/do not collapse/i);
    expect(prompt).not.toMatch(/each item on its own line/i);
  });

  it("professional preset does not contain a 'never collapse' list rule", () => {
    const prompt = PRESET_MAP.professional.prompt;
    expect(prompt).not.toMatch(/never collapse/i);
    expect(prompt).not.toMatch(/each item on its own line/i);
  });
});

// ---------------------------------------------------------------------------
// getBuiltInPresetPrompt()
// ---------------------------------------------------------------------------

describe("getBuiltInPresetPrompt", () => {
  it("returns the prompt for a valid preset ID", () => {
    const prompt = getBuiltInPresetPrompt("clean");
    expect(prompt).toBe(PRESET_MAP.clean.prompt);
  });

  it("returns the prompt for each built-in preset", () => {
    for (const key of Object.keys(PRESETS)) {
      const prompt = getBuiltInPresetPrompt(key);
      expect(prompt).toBe(PRESET_MAP[key].prompt);
    }
  });

  it("returns default (clean) prompt for unknown preset ID", () => {
    const prompt = getBuiltInPresetPrompt("nonexistent-preset");
    expect(prompt).toBe(PRESET_MAP.clean.prompt);
  });

  it("returns default prompt for null/undefined", () => {
    const prompt = getBuiltInPresetPrompt(null as unknown as string);
    expect(prompt).toBe(PRESET_MAP.clean.prompt);
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
