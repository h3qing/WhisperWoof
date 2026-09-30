import { describe, it, expect, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MandoNotice } from './MandoNotice';
import { PANEL_HEIGHT_PX, PANEL_WIDTH_PX } from './LiveDictationPanel';
import { WINDOW_SIZES, vibrancyForSize } from '../../../helpers/windowConfig.js';
import type { IndicatorNotice } from '../../core/indicator/notices';

function render(notice: Omit<IndicatorNotice, 'id'>, native = false): string {
  return renderToStaticMarkup(
    createElement(MandoNotice, { notice: { id: 'n1', ...notice }, native, onDismiss: () => {} })
  );
}

describe('MandoNotice', () => {
  it('is the live panel capsule: 360 x 72, Mando with a sign, the line beside him', () => {
    const html = render({ sign: 'Tip', title: 'One language per recording' }, true);
    expect(html).toContain('width:360px');
    expect(html).toContain('height:72px');
    expect(html).toContain('glass-native');
    expect(html).toContain('>Tip</span>');
    expect(html).toContain('One language per recording');
  });

  it('draws its own glass when the window is not exactly the capsule', () => {
    const html = render({ sign: 'Tip', title: 'x' });
    expect(html).toContain('glass glass-rim');
    expect(html).toContain('width:352px');
  });

  it('has none of the old toast parts (accent bar, countdown line)', () => {
    const html = render({ sign: 'Tip', title: 'x', description: 'y' });
    expect(html).not.toContain('toast-surface');
    expect(html).not.toContain('toast-progress');
    expect(html).not.toContain('w-0.5');
  });

  it('keeps long text to the capsule and puts all of it in the hover title', () => {
    const html = render({ sign: 'Error', title: 'Recording failed', description: 'a long reason', tone: 'error' });
    expect(html).toContain('title="Recording failed\na long reason"');
    expect(html).toMatch(/class="m-0 text-\[13px\][^"]*truncate/);
    expect(html).toMatch(/class="m-0 text-\[12px\][^"]*line-clamp-2/);
  });

  it('lets a title without a sentence under it take two lines', () => {
    const html = render({ sign: 'Memory', title: 'Always change “cube” to “Kube”?' });
    expect(html).toMatch(/class="m-0 text-\[13px\][^"]*line-clamp-2/);
  });

  it('puts buttons under the line, the primary one in the accent', () => {
    const html = render({
      sign: 'Memory',
      title: 'Always change “cube” to “Kube”?',
      actions: [
        { label: 'Not now', onClick: () => {} },
        { label: 'Always', onClick: () => {}, primary: true },
      ],
    });
    expect(html.indexOf('Not now')).toBeLessThan(html.indexOf('Always<'));
    expect(html).toMatch(/<button[^>]*bg-primary\/88[^>]*>Always<\/button>/);
    expect(html).toMatch(/<button[^>]*border-border[^>]*>Not now<\/button>/);
  });

  it('says errors out loud and tilts Mando\'s head', () => {
    const html = render({ sign: 'Error', title: 'Microphone unavailable', tone: 'error' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('text-destructive');
    expect(html).toContain('mando-puzzled');
  });

  it('can always be dismissed', () => {
    expect(render({ sign: 'Tip', title: 'x' })).toContain('aria-label="Dismiss"');
  });
});

describe('MandoNotice tones and text', () => {
  it('says ordinary things politely, with the sign in Mando\'s colour and Mando sitting still', () => {
    const html = render({ sign: 'Tip', title: 'x' });
    expect(html).toContain('role="status"');
    expect(html).toContain('bg-mando/15 text-mando-deep');
    expect(html).not.toContain('mando-puzzled');
  });

  it('paints a success sign green', () => {
    const html = render({ sign: 'Copied', title: 'Copied to clipboard', tone: 'success' });
    expect(html).toContain('role="status"');
    expect(html).toContain('bg-success/15 text-success');
  });

  it('keeps a sentence to one line when buttons sit under it', () => {
    const html = render({
      sign: 'Saved',
      title: 'Saved as note',
      description: 'Buy milk on the way home',
      actions: [{ label: 'Open', onClick: () => {} }],
    });
    expect(html).toMatch(/class="m-0 text-\[12px\][^"]*truncate/);
    expect(html).not.toMatch(/class="m-0 text-\[12px\][^"]*line-clamp-2/);
  });

  it('puts only the title in the hover text when there is no sentence', () => {
    expect(render({ sign: 'Tip', title: 'Hotkey changed' })).toContain('title="Hotkey changed"');
  });

  it('draws no button row without actions (only the close button)', () => {
    const html = render({ sign: 'Tip', title: 'x', description: 'y' });
    expect(html).not.toContain('mt-1 flex gap-1.5');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('is exactly the overlay\'s LIVE_PANEL window, the one with the native material', () => {
    expect(WINDOW_SIZES.LIVE_PANEL).toEqual({ width: PANEL_WIDTH_PX, height: PANEL_HEIGHT_PX });
    expect(vibrancyForSize('LIVE_PANEL')).toBe('hud');
    expect((WINDOW_SIZES as Record<string, unknown>).WITH_TOAST).toBeUndefined();
    expect((WINDOW_SIZES as Record<string, unknown>).EXPANDED).toBeUndefined();
  });
});

// The handlers are read off the element tree MandoNotice returns (rendered
// inside a probe so its hooks run); there is no DOM to fire events in.
type Props = Parameters<typeof MandoNotice>[0];

function tree(props: Props): ReactElement {
  let out: ReactElement | null = null;
  function Probe() {
    out = MandoNotice(props);
    return out;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!out) throw new Error('MandoNotice rendered nothing');
  return out;
}

function findAll(node: ReactNode, match: (el: ReactElement<Record<string, unknown>>) => boolean) {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement<Record<string, unknown>>(n)) return;
    if (match(n)) found.push(n);
    walk(n.props.children as ReactNode);
  };
  walk(node);
  return found;
}

describe('MandoNotice handlers', () => {
  const base = { id: 'n1', sign: 'Tip', title: 'x' };

  it('holds the notice while the pointer is on it and lets go when it leaves', () => {
    const onHold = vi.fn();
    const root = tree({ notice: base, onDismiss: () => {}, onHold });
    (root.props as { onMouseEnter: () => void }).onMouseEnter();
    (root.props as { onMouseLeave: () => void }).onMouseLeave();
    expect(onHold.mock.calls).toEqual([[true], [false]]);
  });

  it('is fine being pointed at when nobody listens for the hold', () => {
    const root = tree({ notice: base, onDismiss: () => {} });
    expect(() => (root.props as { onMouseEnter: () => void }).onMouseEnter()).not.toThrow();
    expect(() => (root.props as { onMouseLeave: () => void }).onMouseLeave()).not.toThrow();
  });

  it('closes with the x and gives each button its own action', () => {
    const onDismiss = vi.fn();
    const notNow = vi.fn();
    const always = vi.fn();
    const root = tree({
      notice: {
        ...base,
        actions: [
          { label: 'Not now', onClick: notNow },
          { label: 'Always', onClick: always, primary: true },
        ],
      },
      onDismiss,
    });
    const closes = findAll(root, (el) => el.type === 'button' && el.props['aria-label'] === 'Dismiss');
    expect(closes).toHaveLength(1);
    (closes[0]?.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const buttons = findAll(root, (el) => el.props.type === 'button' && el.type !== 'button');
    expect(buttons.map((b) => b.props.children)).toEqual(['Not now', 'Always']);
    expect(buttons.map((b) => b.props.variant)).toEqual(['outline', 'default']);
    expect(notNow).not.toHaveBeenCalled();
    // No effect runs here, so the notice counts as shown long ago: clicks go through.
    (buttons[0]?.props.onClick as () => void)();
    expect(notNow).toHaveBeenCalledTimes(1);
    expect(always).not.toHaveBeenCalled();
    (buttons[1]?.props.onClick as () => void)();
    expect(always).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('MandoNotice poses and screen readers', () => {
  it('gives "No voice" Mando\'s huh? without making it an error', () => {
    const html = render({ sign: 'No voice', title: 'No audio detected', puzzled: true });
    expect(html).toContain('mando-puzzled');
    expect(html).toContain('role="status"');
  });

  it('lets an error sit still when asked', () => {
    expect(render({ sign: 'Error', title: 'x', tone: 'error', puzzled: false })).not.toContain('mando-puzzled');
  });

  it('announces errors assertively and everything else politely', () => {
    expect(render({ sign: 'Error', title: 'x', tone: 'error' })).toContain('aria-live="assertive"');
    expect(render({ sign: 'Tip', title: 'x' })).toContain('aria-live="polite"');
  });
});
