import { describe, it, expect } from 'vitest';
import registry from '../../../models/modelRegistryData.json';
import { validateLanguageForModel } from '../../../utils/languageSupport';

describe('parakeet-unified-en-0.6b registry entry', () => {
  const entry = (registry as { parakeetModels: Record<string, unknown> }).parakeetModels['parakeet-unified-en-0.6b'];

  it('exists in modelRegistryData.json', () => {
    expect(entry).toBeDefined();
  });

  it('has the expected shape', () => {
    expect(entry).toMatchObject({
      name: 'Parakeet Unified EN 0.6B',
      size: '631MB',
      sizeMb: 631,
      language: 'en',
      supportedLanguages: ['en'],
      descriptionKey: 'models.descriptions.parakeet.parakeet_unified_en_0_6b',
    });
  });

  it('points at the sherpa-onnx int8 release tarball', () => {
    const e = entry as { downloadUrl: string; extractDir: string };
    expect(e.downloadUrl).toContain('sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming.tar.bz2');
    expect(e.extractDir).toBe('sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming');
  });
});

describe('validateLanguageForModel — parakeet-unified-en-0.6b', () => {
  it('accepts English', () => {
    expect(validateLanguageForModel('en', 'parakeet-unified-en-0.6b')).toBe('en');
    expect(validateLanguageForModel('en-US', 'parakeet-unified-en-0.6b')).toBe('en');
  });

  it('rejects every non-English language', () => {
    for (const lang of ['es', 'fr', 'de', 'it', 'ja', 'pt', 'ru', 'zh', 'ko', 'hi']) {
      expect(validateLanguageForModel(lang, 'parakeet-unified-en-0.6b')).toBeUndefined();
    }
  });

  it('returns undefined for empty/auto', () => {
    expect(validateLanguageForModel(undefined, 'parakeet-unified-en-0.6b')).toBeUndefined();
    expect(validateLanguageForModel('auto', 'parakeet-unified-en-0.6b')).toBeUndefined();
  });
});

describe('validateLanguageForModel regression — parakeet-tdt-0.6b-v3 still multilingual', () => {
  it('still accepts non-English languages on the multilingual model', () => {
    for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru']) {
      expect(validateLanguageForModel(lang, 'parakeet-tdt-0.6b-v3')).toBe(lang);
    }
  });
});
