import { describe, it, expect } from 'vitest';
import { createElement, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useIndicatorNotices } from './useIndicatorNotices';
import type { IndicatorNotice } from '../../core/indicator/notices';

// No DOM here: the queue is driven with render-phase updates, which React's
// server renderer applies (it re-renders the component until they settle).
// The timers in useNoticeClock need a live DOM and are covered by E2E.
type Api = ReturnType<typeof useIndicatorNotices>;

function run(script: (api: Api) => string[]) {
  let api: Api | null = null;
  let ids: string[] = [];
  function Harness() {
    api = useIndicatorNotices();
    const ran = useRef(false);
    if (!ran.current) {
      ran.current = true;
      ids = script(api);
    }
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return { api: api as unknown as Api, ids };
}

const say = (title: string): Omit<IndicatorNotice, 'id'> => ({ sign: 'Tip', title });

describe('useIndicatorNotices', () => {
  it('starts with nothing to say', () => {
    const { api } = run(() => []);
    expect(api.next).toBeNull();
    expect(api.hasNotices).toBe(false);
  });

  it('gives every notice its own id and shows the first one first', () => {
    const { api, ids } = run(({ notify }) => [notify(say('a')), notify(say('b'))]);
    expect(new Set(ids).size).toBe(2);
    expect(api.next?.title).toBe('a');
    expect(api.next?.id).toBe(ids[0]);
    expect(api.hasNotices).toBe(true);
  });

  it('shows the next one once the first is dismissed, and drops the oldest waiting past three', () => {
    const { api } = run(({ notify, dismiss }) => {
      const first = notify(say('a'));
      ['b', 'c', 'd'].forEach((t) => notify(say(t)));
      dismiss(first);
      return [];
    });
    // a was on screen, b was dropped when d arrived, then a was dismissed.
    expect(api.next?.title).toBe('c');
  });
});
