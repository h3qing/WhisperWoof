import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveDictationPanel } from './LiveDictationPanel';
import type { LiveNotice, LivePanelView } from '../../core/live/live-dictation';

// The signature of the design: words the recognizer may still rewrite sit in
// frosted glass (`live-words`); committed words are plain ink.
function render(view: LivePanelView): string {
  return renderToStaticMarkup(
    createElement(LiveDictationPanel, { view, speaking: true, celebrating: false })
  );
}

describe('LiveDictationPanel live words', () => {
  it('puts the provisional tail in glass and leaves committed text as ink', () => {
    const html = render({ phase: 'streaming', committed: 'Send the report by ', partial: 'Thursday at' });
    expect(html).toMatch(/<span class="live-words[^"]*">Thursday at<\/span>/);
    expect(html).toContain('Send the report by <span');
  });

  it('shows no glass once nothing is provisional', () => {
    const html = render({ phase: 'streaming', committed: 'Send the report by Thursday.', partial: '' });
    expect(html).not.toContain('live-words');
  });

  it('no longer draws the dotted underline', () => {
    const html = render({ phase: 'streaming', committed: 'Send ', partial: 'it' });
    expect(html).not.toContain('dotted');
  });
});

describe('LiveDictationPanel notice', () => {
  function renderWith(view: LivePanelView, notice: LiveNotice | null): string {
    return renderToStaticMarkup(
      createElement(LiveDictationPanel, { view, speaking: false, celebrating: false, notice })
    );
  }
  const listening: LivePanelView = { phase: 'listening', committed: '', partial: '' };

  it('says why no words will appear instead of "Start talking…"', () => {
    const html = renderWith(listening, 'model-missing');
    expect(html).toContain("Live preview model isn&#x27;t downloaded");
    expect(html).not.toContain('Start talking');
  });

  it('keeps the words that did arrive before the stream failed', () => {
    const html = renderWith({ phase: 'streaming', committed: '今天下午', partial: '三点' }, 'unavailable');
    expect(html).toContain('今天下午');
    expect(html).not.toContain('didn&#x27;t start');
  });

  it('shows the pasted text, not the notice, once it lands', () => {
    const html = renderWith({ phase: 'done', committed: '今天下午三点开个会。', partial: '' }, 'unavailable');
    expect(html).toContain('今天下午三点开个会。');
    expect(html).not.toContain('didn&#x27;t start');
  });

  it('fades only the oldest of three lines, never a single line', () => {
    const html = renderWith({ phase: 'streaming', committed: '好', partial: '' }, null);
    expect(html).toContain('linear-gradient(to top, black 52px, transparent 66px)');
  });
});
