import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NO_HOLD,
  canShowNotice,
  enqueueNotice,
  holdAfterPointer,
  noticeTimeoutMs,
  pickShownNotice,
  removeNotice,
  type IndicatorNotice,
  type NoticeHold,
  type NoticeInput,
} from '../../core/indicator/notices';

/** The overlay's notice queue; `next` is the one to show when the overlay is free. */
export function useIndicatorNotices() {
  const [queue, setQueue] = useState<IndicatorNotice[]>([]);
  const lastId = useRef(0);

  const notify = useCallback((input: NoticeInput) => {
    lastId.current += 1;
    const id = `notice-${lastId.current}`;
    setQueue((prev) => enqueueNotice(prev, { ...input, id }));
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setQueue((prev) => removeNotice(prev, id));
  }, []);

  return { next: queue[0] ?? null, hasNotices: queue.length > 0, notify, dismiss };
}

/**
 * A notice's clock starts when it's actually on screen (not when it was
 * queued behind a capture) and stops while the pointer is on it. Returns the
 * hover handler for the notice.
 */
export function useNoticeClock(notice: IndicatorNotice | null, dismiss: (id: string) => void) {
  const [hold, setHold] = useState<NoticeHold>(NO_HOLD);
  // Off screen (a capture took its spot): it never got its mouseleave, and
  // it starts fresh when it's back.
  if (!notice && hold !== NO_HOLD) setHold(NO_HOLD);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => dismiss(notice.id), noticeTimeoutMs(notice, hold));
    return () => clearTimeout(timer);
  }, [notice, hold, dismiss]);

  return useCallback(
    (held: boolean) => {
      if (notice) setHold((prev) => holdAfterPointer(prev, notice.id, held));
    },
    [notice]
  );
}

/**
 * The notice the overlay draws in Mando's spot: the next one once the overlay
 * is free (canShowNotice), on its clock. While the window keeps drawing its
 * last frame as it hides, that's the last notice shown (pickShownNotice).
 */
export function useOverlayNotice({
  next,
  dismiss,
  busy,
  holdingLastFrame,
}: {
  next: IndicatorNotice | null;
  dismiss: (id: string) => void;
  busy: Parameters<typeof canShowNotice>[0];
  holdingLastFrame: boolean;
}) {
  const notice = next && canShowNotice(busy) ? next : null;
  const holdNotice = useNoticeClock(notice, dismiss);
  const [lastNotice, setLastNotice] = useState<IndicatorNotice | null>(null);
  const forget = busy.livePanel || busy.starting || busy.hidden;
  if (notice && notice !== lastNotice) setLastNotice(notice);
  if (!notice && lastNotice && forget) setLastNotice(null);
  const shownNotice = pickShownNotice({ notice, lastNotice, holdingLastFrame, forget });
  return { shownNotice, holdNotice };
}
