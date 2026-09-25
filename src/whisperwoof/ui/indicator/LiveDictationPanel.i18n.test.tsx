import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../../../i18n';
import { LiveDictationPanel } from './LiveDictationPanel';
import { RouteChip } from './RouteChip';

// The pill under Mando is a sign, so it reads the same in every UI language;
// the words around it (placeholder, notices) follow the user's language.
describe('live panel pill in a Chinese UI', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('keeps the pill in English and the placeholder in Chinese', () => {
    const html = renderToStaticMarkup(
      createElement(LiveDictationPanel, {
        view: { phase: 'listening', committed: '', partial: '' },
        speaking: false,
        celebrating: false,
      })
    );
    expect(html).toContain('>Listening<');
    expect(html).toContain('开始说话吧');
  });

  it('names routes and progress in English', () => {
    const polishing = renderToStaticMarkup(
      createElement(LiveDictationPanel, {
        view: { phase: 'polishing', committed: '好', partial: '' },
        speaking: false,
        celebrating: false,
        route: 'save-as-markdown',
      })
    );
    expect(polishing).toContain('Polishing…');
    expect(renderToStaticMarkup(createElement(RouteChip, { route: 'project' }))).toContain('Project');
  });
});
