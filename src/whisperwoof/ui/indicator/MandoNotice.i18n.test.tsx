import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../../../i18n';
import { MandoNotice } from './MandoNotice';

// The sign under Mando is a sign (English everywhere, like the live panel's);
// the close button follows the user's language.
describe('MandoNotice in a Chinese UI', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('keeps the sign in English and labels the close button in Chinese', () => {
    const html = renderToStaticMarkup(
      createElement(MandoNotice, {
        notice: { id: 'n', sign: 'Tip', title: '每段录音只认一种语言' },
        onDismiss: () => {},
      })
    );
    expect(html).toContain('>Tip</span>');
    expect(html).toContain('aria-label="忽略"');
  });
});
