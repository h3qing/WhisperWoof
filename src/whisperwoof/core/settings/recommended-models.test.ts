/**
 * New users get Whisper Turbo + Qwen3.5 2B, and the pickers badge exactly
 * those two as "Recommended" — the pair that proved the most stable in daily
 * zh/en dictation. The registry flags drive the badges, so they must not
 * drift from the ids the settings default and onboarding use.
 */
import { describe, it, expect } from "vitest";
import modelData from "../../../models/modelRegistryData.json";
import {
  RECOMMENDED_CLEANUP_MODEL,
  RECOMMENDED_WHISPER_MODEL,
  pickDownloadedLocalModel,
} from "./recommended-models";

type Flagged = { recommended?: boolean };

function recommendedIds(models: Record<string, Flagged>): string[] {
  return Object.entries(models)
    .filter(([, m]) => m.recommended === true)
    .map(([id]) => id);
}

describe("recommended on-device models", () => {
  it("badges only Whisper Turbo among local speech-to-text models", () => {
    expect(recommendedIds(modelData.whisperModels as Record<string, Flagged>)).toEqual([
      RECOMMENDED_WHISPER_MODEL,
    ]);
    expect(recommendedIds(modelData.parakeetModels as Record<string, Flagged>)).toEqual([]);
  });

  it("badges only Qwen3.5 2B among local cleanup models", () => {
    const flagged = modelData.localProviders.flatMap((p) =>
      (p.models as Array<{ id: string } & Flagged>).filter((m) => m.recommended === true)
    );
    expect(flagged.map((m) => m.id)).toEqual([RECOMMENDED_CLEANUP_MODEL]);
  });

  it("names models that exist in the registry", () => {
    expect(modelData.whisperModels).toHaveProperty(RECOMMENDED_WHISPER_MODEL);
    const localIds = modelData.localProviders.flatMap((p) => p.models.map((m) => m.id));
    expect(localIds).toContain(RECOMMENDED_CLEANUP_MODEL);
  });
});

describe("pickDownloadedLocalModel", () => {
  const qwen = [
    { id: "qwen3.5-9b-q4_k_m" },
    { id: "qwen3.5-4b-q4_k_m" },
    { id: RECOMMENDED_CLEANUP_MODEL, recommended: true },
  ];

  it("prefers the recommended model when it's downloaded, over registry order", () => {
    const downloaded = new Set(["qwen3.5-9b-q4_k_m", RECOMMENDED_CLEANUP_MODEL]);
    expect(pickDownloadedLocalModel(qwen, downloaded)).toBe(RECOMMENDED_CLEANUP_MODEL);
  });

  it("falls back to the first downloaded model", () => {
    expect(
      pickDownloadedLocalModel(qwen, new Set(["qwen3.5-4b-q4_k_m", "qwen3.5-9b-q4_k_m"]))
    ).toBe("qwen3.5-9b-q4_k_m");
  });

  it("returns no model when nothing in the family is downloaded", () => {
    expect(pickDownloadedLocalModel(qwen, new Set(["llama-3.2-3b"]))).toBe("");
    expect(pickDownloadedLocalModel([], new Set())).toBe("");
  });
});
