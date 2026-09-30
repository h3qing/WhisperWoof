/**
 * What the dictation overlay says between captures: Mando talks in the live
 * panel's own capsule (a sign under him, a line or two beside him), one notice
 * at a time. It replaced the toast stack, which grew the overlay window to
 * 470 × 500 over someone else's app and caught every click in it.
 */

export type NoticeTone = 'info' | 'success' | 'error';

export interface NoticeAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface IndicatorNotice {
  id: string;
  /** The capsule sign under Mando: one short English word, like the live panel's. */
  sign: string;
  title: string;
  description?: string;
  tone?: NoticeTone;
  actions?: NoticeAction[];
  /** Mando's "huh?" (head tilt and "?"): errors by default, and "No voice". */
  puzzled?: boolean;
  /** How long it stays once it's on screen; hovering holds it. */
  durationMs?: number;
}

export type NoticeInput = Omit<IndicatorNotice, 'id'>;

/** Older notices waiting behind the one on screen are dropped past this. */
export const NOTICE_QUEUE_MAX = 3;
/** After the pointer leaves a notice it was holding, it goes this soon. */
export const NOTICE_AFTER_HOVER_MS = 2000;
/** Buttons ignore clicks this soon after a notice appears (a click meant for Mando). */
export const NOTICE_ARM_MS = 500;
/** Time on screen: 3.5–8 s (DESIGN.md "Overlay notice"); a pointer holds it up to `held`. */
export const NOTICE_MS = {
  brief: 3500,
  withDetail: 5000,
  error: 7000,
  question: 8000,
  held: 30000,
} as const;
/** Dictated text quoted in a notice is cut to this many characters. */
export const NOTICE_EXCERPT_CHARS = 80;

export function noticeDurationMs(notice: NoticeInput): number {
  if (notice.durationMs) return notice.durationMs;
  if (notice.actions?.length) return NOTICE_MS.question;
  if (notice.tone === 'error') return NOTICE_MS.error;
  return notice.description ? NOTICE_MS.withDetail : NOTICE_MS.brief;
}

/** Cut dictated text for a notice, on whole characters (never half an emoji). */
export function noticeExcerpt(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= NOTICE_EXCERPT_CHARS) return text;
  return chars.slice(0, NOTICE_EXCERPT_CHARS).join('') + '…';
}

/** Whether a notice shown at `shownAt` takes button clicks yet. */
export function noticeArmed(shownAt: number, now: number): boolean {
  return now - shownAt >= NOTICE_ARM_MS;
}

/** Which notice the pointer entered, and which notice it last left. */
export interface NoticeHold {
  hoveredId: string | null;
  releasedId: string | null;
}

export const NO_HOLD: NoticeHold = { hoveredId: null, releasedId: null };

/** The pointer entered (held) or left the notice with this id. */
export function holdAfterPointer(hold: NoticeHold, noticeId: string, held: boolean): NoticeHold {
  if (held) return { hoveredId: noticeId, releasedId: null };
  return hold.hoveredId === noticeId ? { hoveredId: null, releasedId: noticeId } : NO_HOLD;
}

/**
 * How long the notice on screen has left. The pointer on it holds it (up to
 * `NOTICE_MS.held`, so a parked pointer can't keep it forever); leaving it
 * gives it a short grace. A notice that takes the spot of the one the pointer
 * was on gets its full time: the pointer never entered it.
 */
export function noticeTimeoutMs(notice: IndicatorNotice, hold: NoticeHold): number {
  if (hold.hoveredId === notice.id) return NOTICE_MS.held;
  return hold.releasedId === notice.id ? NOTICE_AFTER_HOVER_MS : noticeDurationMs(notice);
}

/** A quick confirmation ("Copied", "Done"): the first to go when too many wait. */
function isBrief(notice: IndicatorNotice): boolean {
  return !!notice.durationMs && notice.durationMs <= NOTICE_MS.brief;
}

/**
 * Newest last. Past NOTICE_QUEUE_MAX, one waiting notice is dropped (never the
 * one on screen, index 0): the oldest quick confirmation, else the oldest.
 */
export function enqueueNotice(queue: IndicatorNotice[], notice: IndicatorNotice): IndicatorNotice[] {
  const next = [...queue, notice];
  if (next.length <= NOTICE_QUEUE_MAX) return next;
  const waiting = next.slice(1);
  const briefAt = waiting.findIndex(isBrief);
  const dropAt = (briefAt === -1 ? 0 : briefAt) + 1;
  return next.filter((_, i) => i !== dropAt);
}

export function removeNotice(queue: IndicatorNotice[], id: string): IndicatorNotice[] {
  return queue.filter((notice) => notice.id !== id);
}

/**
 * Notices wait while the overlay is busy (a capture, the live panel's
 * "Pasted" hold, Mando's hop or head tilt, his right-click menu) or hidden
 * (auto-hide): the capsule takes Mando's spot, and a notice nobody can see
 * shouldn't spend its time.
 */
export function canShowNotice(overlay: {
  recording: boolean;
  processing: boolean;
  starting: boolean;
  livePanel: boolean;
  mandoAnimating: boolean;
  menuOpen: boolean;
  hidden: boolean;
}): boolean {
  return !Object.values(overlay).some(Boolean);
}

/**
 * The notice the overlay draws: the live one, or, while the window keeps
 * drawing its last frame as it hides (live mode with auto-hide), the last
 * notice shown, so the "Pasted" frame from before it doesn't flash back.
 */
export function pickShownNotice(input: {
  notice: IndicatorNotice | null;
  lastNotice: IndicatorNotice | null;
  /** The overlay is holding its last frame (see pickLivePanelFrame). */
  holdingLastFrame: boolean;
  /** Hidden, or a capture started: the last notice is forgotten. */
  forget: boolean;
}): IndicatorNotice | null {
  if (input.notice) return input.notice;
  return input.holdingLastFrame && !input.forget ? input.lastNotice : null;
}
