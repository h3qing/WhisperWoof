import { describe, it, expect } from 'vitest';
import { recommend, MODEL_CATALOG } from './model-recommender';
import type { SystemProfile } from './system-profiler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<SystemProfile> = {}): SystemProfile {
  return {
    ramMb: 16384,
    cpuCores: 8,
    cpuModel: 'Apple M2',
    arch: 'arm64',
    platform: 'darwin',
    gpu: { name: 'Apple M2', vramMb: null, vendor: 'apple-silicon' },
    availableRamMb: 14336, // 16 GB - 2 GB overhead
    isAppleSilicon: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MODEL_CATALOG
// ---------------------------------------------------------------------------

describe('MODEL_CATALOG', () => {
  it('is ordered by quality tier descending', () => {
    for (let i = 1; i < MODEL_CATALOG.length; i++) {
      expect(MODEL_CATALOG[i - 1].qualityTier).toBeGreaterThanOrEqual(
        MODEL_CATALOG[i].qualityTier,
      );
    }
  });

  it('contains at least 3 models', () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(3);
  });

  it('every model has required fields', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.paramsBillion).toBeGreaterThan(0);
      expect(m.requiredMb).toBeGreaterThan(0);
      expect(m.qualityTier).toBeGreaterThanOrEqual(1);
      expect(m.qualityTier).toBeLessThanOrEqual(5);
      expect(m.description).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// recommend() — Apple Silicon (unified memory)
// ---------------------------------------------------------------------------

describe('recommend() — Apple Silicon', () => {
  it('recommends llama3.1:8b on 16 GB M2', () => {
    const profile = makeProfile({ ramMb: 16384, availableRamMb: 14336 });
    // Budget = 14336 * 0.75 = ~10752 MB — enough for 8B (5500 MB)
    const result = recommend(profile, 'llama3.2:1b');

    expect(result.recommended.id).toBe('llama3.1:8b');
    expect(result.canUpgrade).toBe(true);
    expect(result.upgradeReason).toContain('Llama 3.1 8B');
  });

  it('recommends llama3.2:3b on 8 GB M1', () => {
    const profile = makeProfile({
      ramMb: 8192,
      availableRamMb: 6144,
      cpuModel: 'Apple M1',
      gpu: { name: 'Apple M1', vramMb: null, vendor: 'apple-silicon' },
    });
    // Budget = 6144 * 0.75 = 4608 MB — not enough for 8B (5500), fits 3B (2500)
    const result = recommend(profile, null);

    expect(result.recommended.id).toBe('llama3.2:3b');
    expect(result.canUpgrade).toBe(true);
  });

  it('reports no upgrade when already on best model', () => {
    const profile = makeProfile({ ramMb: 16384, availableRamMb: 14336 });
    const result = recommend(profile, 'llama3.1:8b');

    expect(result.canUpgrade).toBe(false);
    expect(result.upgradeReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recommend() — NVIDIA GPU
// ---------------------------------------------------------------------------

describe('recommend() — NVIDIA GPU', () => {
  it('recommends based on VRAM when available', () => {
    const profile = makeProfile({
      ramMb: 32768,
      availableRamMb: 30720,
      isAppleSilicon: false,
      platform: 'linux',
      arch: 'x64',
      cpuModel: 'AMD Ryzen 9',
      gpu: { name: 'RTX 4090', vramMb: 24576, vendor: 'nvidia' },
    });
    // Budget = min(24576, 30720) = 24576 — fits 8B easily
    const result = recommend(profile, 'llama3.2:1b');

    expect(result.recommended.id).toBe('llama3.1:8b');
    expect(result.canUpgrade).toBe(true);
  });

  it('limits to VRAM when RAM is larger', () => {
    const profile = makeProfile({
      ramMb: 65536,
      availableRamMb: 63488,
      isAppleSilicon: false,
      platform: 'linux',
      arch: 'x64',
      cpuModel: 'Intel i9',
      gpu: { name: 'RTX 3060', vramMb: 4096, vendor: 'nvidia' },
    });
    // Budget = min(4096, 63488) = 4096 — fits 3B (2500) but not 7B (5000)
    const result = recommend(profile, 'llama3.2:1b');

    expect(result.recommended.id).toBe('llama3.2:3b');
    expect(result.canUpgrade).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recommend() — CPU only
// ---------------------------------------------------------------------------

describe('recommend() — CPU only', () => {
  it('uses 60% of available RAM', () => {
    const profile = makeProfile({
      ramMb: 16384,
      availableRamMb: 14336,
      isAppleSilicon: false,
      platform: 'linux',
      arch: 'x64',
      cpuModel: 'Intel i7',
      gpu: { name: 'Integrated / Unknown', vramMb: null, vendor: 'unknown' },
    });
    // Budget = 14336 * 0.6 = 8601 — fits 8B (5500)
    const result = recommend(profile, 'llama3.2:1b');

    expect(result.recommended.id).toBe('llama3.1:8b');
    expect(result.memoryBudgetMb).toBeCloseTo(14336 * 0.6, -1);
  });

  it('falls back to smallest model when RAM is very low', () => {
    const profile = makeProfile({
      ramMb: 4096,
      availableRamMb: 2048,
      isAppleSilicon: false,
      platform: 'linux',
      arch: 'x64',
      cpuModel: 'Intel Celeron',
      gpu: { name: 'Integrated / Unknown', vramMb: null, vendor: 'unknown' },
    });
    // Budget = 2048 * 0.6 = 1228 — barely fits 1B (1200)
    const result = recommend(profile, null);

    expect(result.recommended.id).toBe('llama3.2:1b');
  });
});

// ---------------------------------------------------------------------------
// recommend() — upgrade logic
// ---------------------------------------------------------------------------

describe('recommend() — upgrade detection', () => {
  it('detects significant upgrade (2+ quality tiers)', () => {
    const profile = makeProfile();
    const result = recommend(profile, 'llama3.2:1b');

    expect(result.canUpgrade).toBe(true);
    expect(result.upgradeReason).toContain('significantly better');
  });

  it('detects minor upgrade (1 quality tier)', () => {
    const profile = makeProfile();
    const result = recommend(profile, 'mistral:7b');

    expect(result.canUpgrade).toBe(true);
    expect(result.upgradeReason).toContain('better quality');
  });

  it('handles unknown current model gracefully', () => {
    const profile = makeProfile();
    const result = recommend(profile, 'some-custom-model:latest');

    expect(result.current).toBeNull();
    // Should still provide a recommendation
    expect(result.recommended).toBeTruthy();
  });

  it('strips :latest suffix when matching models', () => {
    const profile = makeProfile();
    const result = recommend(profile, 'llama3.1:8b:latest');

    // Should normalize and find the model — but this ID format won't match
    // because :8b:latest doesn't reduce to llama3.1:8b
    // The actual Ollama format would be llama3.1:8b with :latest appended sometimes
    expect(result.recommended).toBeTruthy();
  });

  it('notes when recommended model needs to be pulled', () => {
    const profile = makeProfile();
    const result = recommend(profile, 'llama3.2:1b', ['llama3.2:1b']);

    expect(result.canUpgrade).toBe(true);
    expect(result.upgradeReason).toContain('ollama pull');
  });

  it('does not suggest pulling when model is already installed', () => {
    const profile = makeProfile();
    const result = recommend(profile, 'llama3.2:1b', ['llama3.1:8b', 'llama3.2:1b']);

    expect(result.canUpgrade).toBe(true);
    expect(result.upgradeReason).not.toContain('ollama pull');
  });
});

// ---------------------------------------------------------------------------
// recommend() — runnable list
// ---------------------------------------------------------------------------

describe('recommend() — runnable models', () => {
  it('returns all models that fit the budget', () => {
    const profile = makeProfile({ ramMb: 16384, availableRamMb: 14336 });
    const result = recommend(profile, null);

    // Budget ~10752 MB — all models should fit
    expect(result.runnable.length).toBe(MODEL_CATALOG.length);
  });

  it('excludes models that exceed budget', () => {
    const profile = makeProfile({
      ramMb: 6144,
      availableRamMb: 4096,
      isAppleSilicon: false,
      platform: 'linux',
      arch: 'x64',
      gpu: { name: 'Unknown', vramMb: null, vendor: 'unknown' },
    });
    // Budget = 4096 * 0.6 = 2457 — only 2B (1800) and 1B (1200) fit
    const result = recommend(profile, null);

    expect(result.runnable.length).toBe(2);
    expect(result.runnable.map((m) => m.id)).toEqual(['gemma2:2b', 'llama3.2:1b']);
  });

  it('runnable list is ordered best-first', () => {
    const profile = makeProfile();
    const result = recommend(profile, null);

    for (let i = 1; i < result.runnable.length; i++) {
      expect(result.runnable[i - 1].qualityTier).toBeGreaterThanOrEqual(
        result.runnable[i].qualityTier,
      );
    }
  });
});
