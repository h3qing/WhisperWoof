import { describe, it, expect } from 'vitest';
import {
  NOTICE_AFTER_HOVER_MS,
  NOTICE_ARM_MS,
  NOTICE_MS,
  NOTICE_QUEUE_MAX,
  NO_HOLD,
  canShowNotice,
  enqueueNotice,
  holdAfterPointer,
  noticeArmed,
  noticeDurationMs,
  noticeExcerpt,
  noticeTimeoutMs,
  pickShownNotice,
  removeNotice,
  type IndicatorNotice,
} from './notices';

const notice = (id: string, extra: Partial<IndicatorNotice> = {}): IndicatorNotice => ({
  id,
  sign: 'Tip',
  title: `notice ${id}`,
  ...extra,
});

describe('noticeDurationMs', () => {
  it('keeps a title-only notice short', () => {
    expect(noticeDurationMs(notice('a'))).toBe(3500);
  });

  it('gives a sentence under the title a little longer', () => {
    expect(noticeDurationMs(notice('a', { description: 'Start a new recording.' }))).toBe(5000);
  });

  it('gives errors and questions time to be read and answered', () => {
    expect(noticeDurationMs(notice('a', { tone: 'error', description: 'x' }))).toBe(7000);
    const question = notice('a', { actions: [{ label: 'Always', onClick: () => {} }] });
    expect(noticeDurationMs(question)).toBe(8000);
  });

  it('never lingers past 8 seconds by default', () => {
    const everything = notice('a', {
      tone: 'error',
      description: 'x',
      actions: [{ label: 'Undo', onClick: () => {} }],
    });
    expect(noticeDurationMs(everything)).toBeLessThanOrEqual(8000);
  });

  it('honors an explicit duration', () => {
    expect(noticeDurationMs(notice('a', { durationMs: 3000 }))).toBe(3000);
  });
});

describe('noticeTimeoutMs', () => {
  const a = notice('a', { description: 'x' });

  it('runs the full time when nobody points at it', () => {
    expect(noticeTimeoutMs(a, NO_HOLD)).toBe(5000);
  });

  it('stops while the pointer is on it', () => {
    expect(noticeTimeoutMs(a, { hoveredId: 'a', releasedId: null })).toBe(NOTICE_MS.held);
  });

  it('goes soon after the pointer leaves it', () => {
    expect(noticeTimeoutMs(a, { hoveredId: null, releasedId: 'a' })).toBe(NOTICE_AFTER_HOVER_MS);
  });

  it('gives the next notice its full time, not the grace of the one before', () => {
    expect(noticeTimeoutMs(notice('b', { description: 'x' }), { hoveredId: null, releasedId: 'a' })).toBe(5000);
  });
});

describe('enqueueNotice', () => {
  it('adds the newest last without changing the queue it was given', () => {
    const queue = [notice('a')];
    const next = enqueueNotice(queue, notice('b'));
    expect(next.map((n) => n.id)).toEqual(['a', 'b']);
    expect(queue.map((n) => n.id)).toEqual(['a']);
  });

  it('drops the oldest waiting notices, never the one on screen', () => {
    let queue: IndicatorNotice[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) queue = enqueueNotice(queue, notice(id));
    expect(queue).toHaveLength(NOTICE_QUEUE_MAX);
    expect(queue.map((n) => n.id)).toEqual(['a', 'd', 'e']);
  });
});

describe('removeNotice', () => {
  it('removes by id and leaves the rest in order', () => {
    const queue = [notice('a'), notice('b'), notice('c')];
    expect(removeNotice(queue, 'b').map((n) => n.id)).toEqual(['a', 'c']);
    expect(removeNotice(queue, 'zzz')).toHaveLength(3);
  });
});

describe('canShowNotice', () => {
  const idle = {
    recording: false,
    processing: false,
    starting: false,
    livePanel: false,
    mandoAnimating: false,
    menuOpen: false,
    hidden: false,
  };

  it('shows when the overlay is idle', () => {
    expect(canShowNotice(idle)).toBe(true);
  });

  it.each(Object.keys(idle))('waits while %s', (key) => {
    expect(canShowNotice({ ...idle, [key]: true })).toBe(false);
  });
});

describe('notice rules at their edges', () => {
  it('gives a question on an error the time to answer it, not just to read it', () => {
    const errorQuestion = notice('a', {
      tone: 'error',
      actions: [{ label: 'Undo', onClick: () => {} }],
    });
    expect(noticeDurationMs(errorQuestion)).toBe(8000);
  });

  it('treats no buttons and a zero duration as "use the default", never "stay forever"', () => {
    expect(noticeDurationMs(notice('a', { actions: [] }))).toBe(3500);
    expect(noticeDurationMs(notice('a', { durationMs: 0, description: 'x' }))).toBe(5000);
  });

  it('keeps holding while the pointer is back on the notice it just left', () => {
    expect(noticeTimeoutMs(notice('a'), { hoveredId: 'a', releasedId: 'a' })).toBe(NOTICE_MS.held);
  });

  it('keeps a full queue as it is and never changes the queue it was given when it drops one', () => {
    const full = [notice('a'), notice('b'), notice('c')];
    expect(enqueueNotice(full.slice(0, 2), notice('c')).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    const next = enqueueNotice(full, notice('d'));
    expect(next.map((n) => n.id)).toEqual(['a', 'c', 'd']);
    expect(full.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(removeNotice(full, 'a')).not.toBe(full);
  });
});

describe('holdAfterPointer', () => {
  it('holds the notice the pointer entered, and gives it a short grace when it leaves', () => {
    const held = holdAfterPointer(NO_HOLD, 'a', true);
    expect(held).toEqual({ hoveredId: 'a', releasedId: null });
    expect(holdAfterPointer(held, 'a', false)).toEqual({ hoveredId: null, releasedId: 'a' });
  });

  it('gives the next notice its full time when the pointer leaves one it never entered', () => {
    // A was dismissed under the pointer; B took its spot; the pointer leaves.
    const heldOnA = holdAfterPointer(NO_HOLD, 'a', true);
    const b = notice('b', { actions: [{ label: 'Undo', onClick: () => {} }] });
    expect(noticeTimeoutMs(b, heldOnA)).toBe(NOTICE_MS.question);
    const left = holdAfterPointer(heldOnA, 'b', false);
    expect(left).toBe(NO_HOLD);
    expect(noticeTimeoutMs(b, left)).toBe(NOTICE_MS.question);
  });
});

describe('noticeArmed', () => {
  it('ignores clicks right after a notice appears, then takes them', () => {
    expect(noticeArmed(1000, 1000)).toBe(false);
    expect(noticeArmed(1000, 1000 + NOTICE_ARM_MS - 1)).toBe(false);
    expect(noticeArmed(1000, 1000 + NOTICE_ARM_MS)).toBe(true);
  });
});

describe('noticeExcerpt', () => {
  it('leaves 80 characters alone and cuts 81 with an ellipsis', () => {
    expect(noticeExcerpt('a'.repeat(80))).toBe('a'.repeat(80));
    expect(noticeExcerpt('a'.repeat(81))).toBe('a'.repeat(80) + '…');
  });

  it('counts Chinese characters as characters', () => {
    const zh = '还是说本来计划就不用回收'.repeat(10);
    expect(Array.from(noticeExcerpt(zh))).toHaveLength(81);
  });

  it('never cuts an emoji in half', () => {
    const cut = noticeExcerpt('a'.repeat(79) + '😀tail');
    expect(cut).toBe('a'.repeat(79) + '😀…');
    expect(cut).not.toMatch(/[\uD800-\uDBFF]…$/);
  });
});

describe('pickShownNotice', () => {
  const a = notice('a');
  const b = notice('b');

  it('shows the live notice whenever there is one', () => {
    expect(pickShownNotice({ notice: b, lastNotice: a, holdingLastFrame: true, forget: true })).toBe(b);
  });

  it('keeps drawing the last notice while the window hides on its last frame', () => {
    expect(pickShownNotice({ notice: null, lastNotice: a, holdingLastFrame: true, forget: false })).toBe(a);
  });

  it('drops it once hidden or a capture starts, and when no last frame is held', () => {
    expect(pickShownNotice({ notice: null, lastNotice: a, holdingLastFrame: true, forget: true })).toBeNull();
    expect(pickShownNotice({ notice: null, lastNotice: a, holdingLastFrame: false, forget: false })).toBeNull();
    expect(pickShownNotice({ notice: null, lastNotice: null, holdingLastFrame: true, forget: false })).toBeNull();
  });
});

describe('enqueueNotice when too many wait', () => {
  const brief = (id: string) => notice(id, { durationMs: NOTICE_MS.brief });

  it('drops a quick confirmation before a one-time tip or an error', () => {
    // Debug on screen; the tip, "Copied" and a cloud fallback arrive together.
    let queue: IndicatorNotice[] = [];
    queue = enqueueNotice(queue, brief('debug'));
    queue = enqueueNotice(queue, notice('tip', { description: 'x' }));
    queue = enqueueNotice(queue, brief('copied'));
    queue = enqueueNotice(queue, notice('cloud', { description: 'x' }));
    expect(queue.map((n) => n.id)).toEqual(['debug', 'tip', 'cloud']);
  });

  it('never drops the notice on screen, even when it is a quick one', () => {
    let queue: IndicatorNotice[] = [];
    for (const id of ['a', 'b', 'c', 'd']) queue = enqueueNotice(queue, id === 'a' ? brief(id) : notice(id));
    expect(queue.map((n) => n.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('a pointer parked on a notice', () => {
  it('holds it for a while, not forever', () => {
    expect(noticeTimeoutMs(notice('a'), holdAfterPointer(NO_HOLD, 'a', true))).toBe(NOTICE_MS.held);
    expect(NOTICE_MS.held).toBeLessThanOrEqual(60000);
  });
});
