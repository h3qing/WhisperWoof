import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

// The overlay's notices are one capsule (360 x 72): a title on one line when a
// sentence sits under it, the sentence in at most two. This checks the copy
// the overlay says, in every locale, against that room.
const LOCALES_DIR = resolve(__dirname, '../../../locales');
const locales = readdirSync(LOCALES_DIR).filter((l) =>
  existsSync(resolve(LOCALES_DIR, l, 'translation.json'))
);
const load = (locale: string) =>
  JSON.parse(readFileSync(resolve(LOCALES_DIR, locale, 'translation.json'), 'utf8'));
const get = (obj: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
// Rough width in Latin characters: CJK glyphs are about twice as wide.
const width = (s: string) =>
  [...s].reduce((n, c) => n + (/[　-鿿＀-￯]/.test(c) ? 1.8 : 1), 0);

const NOTICE_KEYS: Record<string, string[]> = {
  'app.toasts.hotkeyChanged.title': [],
  'app.toasts.hotkeyUnavailable.title': [],
  'app.toasts.hotkeyUnavailable.description': [],
  'app.toasts.accessibilityMissing.title': [],
  'app.toasts.accessibilityMissing.description': [],
  'app.toasts.mixedLanguageTip.title': [],
  'app.toasts.mixedLanguageTip.description': [],
  'app.toasts.addedToDict': ['{{words}}'],
  'app.toasts.undo': [],
  'app.toasts.swapOffer': ['{{from}}', '{{to}}'],
  'app.toasts.swapAlways': [],
  'app.toasts.swapNotNow': [],
};

// Titles shown with a sentence under them (one line in the capsule).
const TITLES_WITH_SENTENCE = [
  'app.toasts.hotkeyUnavailable.title',
  'app.toasts.accessibilityMissing.title',
  'app.toasts.mixedLanguageTip.title',
];

// The sentences this change shortened to fit the capsule.
const SHORTENED_SENTENCES = [
  'app.toasts.hotkeyUnavailable.description',
  'app.toasts.accessibilityMissing.description',
  'app.toasts.mixedLanguageTip.description',
];

describe('overlay notice copy', () => {
  it('finds every locale', () => {
    expect(locales).toEqual(expect.arrayContaining(['en', 'de', 'ja', 'pt', 'zh-CN']));
  });

  it.each(locales)('%s has every string a notice says, placeholders intact', (locale) => {
    const strings = load(locale);
    for (const [key, placeholders] of Object.entries(NOTICE_KEYS)) {
      const value = get(strings, key);
      expect(typeof value, `${locale} ${key}`).toBe('string');
      for (const p of placeholders) expect(value, `${locale} ${key}`).toContain(p);
    }
  });

  it.each(locales)('%s keeps titles that have a sentence under them to one line', (locale) => {
    const strings = load(locale);
    for (const key of TITLES_WITH_SENTENCE) {
      expect(width(get(strings, key) as string), `${locale} ${key}`).toBeLessThanOrEqual(34);
    }
  });

  it.each(locales)('%s keeps the shortened sentences to two lines of the capsule', (locale) => {
    const strings = load(locale);
    for (const key of SHORTENED_SENTENCES) {
      expect(width(get(strings, key) as string), `${locale} ${key}`).toBeLessThanOrEqual(80);
    }
  });
});
