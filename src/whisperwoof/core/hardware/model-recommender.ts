/**
 * ModelRecommender — Recommend the best local Ollama model for the user's hardware.
 *
 * Maps hardware capabilities (RAM, GPU VRAM, Apple Silicon unified memory)
 * to the best Ollama model the machine can comfortably run for text polish.
 *
 * Key insight: model memory requirement is roughly params * 2 bytes (fp16)
 * plus overhead. We use conservative estimates so the system stays responsive.
 */

import type { SystemProfile } from './system-profiler';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelSpec {
  /** Ollama model identifier, e.g. "llama3.2:3b" */
  readonly id: string;
  /** Human-friendly name */
  readonly name: string;
  /** Parameter count in billions */
  readonly paramsBillion: number;
  /** Approximate RAM/VRAM needed in MB (fp16 + KV cache + overhead) */
  readonly requiredMb: number;
  /** Quality tier: 1 (basic) to 5 (excellent) */
  readonly qualityTier: number;
  /** Short description of capabilities */
  readonly description: string;
}

export interface ModelRecommendation {
  /** The recommended model */
  readonly recommended: ModelSpec;
  /** The user's current model (null if not set) */
  readonly current: ModelSpec | null;
  /** True if the user could benefit from upgrading */
  readonly canUpgrade: boolean;
  /** Human-readable upgrade reason, null if already optimal */
  readonly upgradeReason: string | null;
  /** All models the hardware can run, ordered best-first */
  readonly runnable: readonly ModelSpec[];
  /** The effective memory budget used for recommendation (MB) */
  readonly memoryBudgetMb: number;
}

// ---------------------------------------------------------------------------
// Model catalog — ordered by quality (best first)
// ---------------------------------------------------------------------------

export const MODEL_CATALOG: readonly ModelSpec[] = Object.freeze([
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    paramsBillion: 8,
    requiredMb: 5500,
    qualityTier: 5,
    description: 'Best quality for text polish. Excellent grammar and style.',
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    paramsBillion: 7,
    requiredMb: 5000,
    qualityTier: 4,
    description: 'Strong all-around model. Good at following instructions.',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    paramsBillion: 3,
    requiredMb: 2500,
    qualityTier: 3,
    description: 'Good balance of quality and speed. Solid for everyday polish.',
  },
  {
    id: 'gemma2:2b',
    name: 'Gemma 2 2B',
    paramsBillion: 2,
    requiredMb: 1800,
    qualityTier: 2,
    description: 'Lightweight and fast. Decent grammar correction.',
  },
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    paramsBillion: 1,
    requiredMb: 1200,
    qualityTier: 1,
    description: 'Smallest option. Basic cleanup, very fast.',
  },
]);

// ---------------------------------------------------------------------------
// Recommendation logic
// ---------------------------------------------------------------------------

function getMemoryBudgetMb(profile: SystemProfile): number {
  if (profile.isAppleSilicon) {
    // Apple Silicon: unified memory, Ollama can use ~75% of available RAM
    return Math.round(profile.availableRamMb * 0.75);
  }

  if (profile.gpu.vramMb !== null && profile.gpu.vramMb > 0) {
    // Discrete GPU: use VRAM as budget (Ollama offloads to GPU)
    // Also consider if RAM allows loading the model initially
    return Math.min(profile.gpu.vramMb, profile.availableRamMb);
  }

  // CPU-only / integrated GPU: use ~60% of available RAM
  return Math.round(profile.availableRamMb * 0.6);
}

function findModelById(id: string): ModelSpec | null {
  // Normalize: strip any ":latest" suffix for comparison
  const normalized = id.replace(/:latest$/, '');
  return MODEL_CATALOG.find((m) => m.id === normalized) ?? null;
}

export function recommend(
  profile: SystemProfile,
  currentModelId: string | null,
  installedModels: readonly string[] = [],
): Readonly<ModelRecommendation> {
  const memoryBudgetMb = getMemoryBudgetMb(profile);

  // Filter to models that fit in the memory budget (catalog is already best-first)
  const runnable = MODEL_CATALOG.filter((m) => m.requiredMb <= memoryBudgetMb);

  // Best runnable model (first in the list since catalog is quality-ordered)
  const recommended = runnable.length > 0
    ? runnable[0]
    : MODEL_CATALOG[MODEL_CATALOG.length - 1]; // Fall back to smallest

  // Find the user's current model in the catalog
  const current = currentModelId ? findModelById(currentModelId) : null;

  // Determine if upgrade is possible
  let canUpgrade = false;
  let upgradeReason: string | null = null;

  if (current === null && currentModelId) {
    // Using a model not in our catalog — can't compare, but suggest if better option exists
    canUpgrade = recommended.qualityTier >= 3;
    if (canUpgrade) {
      upgradeReason = `Your hardware can run ${recommended.name}, which is optimized for text polish.`;
    }
  } else if (current === null) {
    // No model selected yet
    canUpgrade = true;
    upgradeReason = `Your hardware can run ${recommended.name} for high-quality text polish.`;
  } else if (recommended.qualityTier > current.qualityTier) {
    canUpgrade = true;
    const qualityGain = recommended.qualityTier - current.qualityTier;
    if (qualityGain >= 2) {
      upgradeReason =
        `You're using ${current.name} but your hardware can handle ${recommended.name} ` +
        `for significantly better polish quality.`;
    } else {
      upgradeReason =
        `Your hardware can run ${recommended.name} for better quality than ${current.name}.`;
    }
  }

  // Check if recommended model is already installed in Ollama
  const recommendedInstalled = installedModels.some((m) => {
    const normalized = m.replace(/:latest$/, '');
    return normalized === recommended.id;
  });

  if (canUpgrade && !recommendedInstalled && upgradeReason) {
    upgradeReason += ' You\'ll need to pull it first: ollama pull ' + recommended.id;
  }

  return Object.freeze({
    recommended,
    current,
    canUpgrade,
    upgradeReason,
    runnable: Object.freeze(runnable),
    memoryBudgetMb,
  });
}
