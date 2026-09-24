import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveDictationPanel } from './LiveDictationPanel';
import type { LivePanelView } from '../../core/live/live-dictation';

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
