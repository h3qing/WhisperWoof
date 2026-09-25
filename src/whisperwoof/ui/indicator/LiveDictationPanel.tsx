import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clipboard, FileText, FolderOpen } from 'lucide-react';
import { MandoSprite } from './MandoSprite';
import { pickMandoAction } from './mando-sprite';
import type { LiveNotice, LivePanelView } from '../../core/live/live-dictation';
import type { DictationRoute } from '../../core/router/dictation-route';

// Live dictation panel: replaces the Mando indicator while a live-mode capture
// runs. A one-line ticker: Mando on the left with a pill under him (where the
// words go, then what's happening to them), the words on the right. As you keep
// talking the line slides left and the oldest words fade off the left edge:
// you've already read them. Committed text is solid ink; the provisional tail
// (which the streaming model may still rewrite) sits in frosted caramel glass
// (`live-words`), the design's one signature element. After release the draft
// settles while the final pass + polish run, then the pasted text shows for a
// beat before the panel collapses.

// Fits WINDOW_SIZES.LIVE_PANEL (360 x 72).
const PANEL_WIDTH_PX = 360;
const PANEL_HEIGHT_PX = 72;
const MANDO_SIZE_PX = 36;
// Mando and the pill under him; fixed so the words don't shift when the pill
// changes from "Listening" to "Polishing…".
const SIDE_WIDTH_PX = 76;
// Room at the right for the cancel button App.jsx lays over the panel.
const CANCEL_GUTTER_PX = 34;
const FADE_PX = 28;

const ROUTE_ICON = {
  'copy-to-clipboard': Clipboard,
  'save-as-markdown': FileText,
  project: FolderOpen,
} as const;

interface LiveDictationPanelProps {
  view: LivePanelView;
  speaking: boolean;
  celebrating: boolean;
  onCelebrationEnd?: () => void;
  /** The window is exactly this panel and carries macOS vibrancy: fill it and
   *  add only light (glass-native). Otherwise the panel draws its own CSS glass. */
  native?: boolean;
  /** Where this dictation goes; anything but paste tints the pill and shows
   *  its icon from the moment Fn+letter is pressed. */
  route?: DictationRoute;
  /** Why no live words will appear this capture; shown in place of the text. */
  notice?: LiveNotice | null;
}

export function LiveDictationPanel({
  view,
  speaking,
  celebrating,
  onCelebrationEnd,
  native = false,
  route = 'paste-at-cursor',
  notice = null,
}: LiveDictationPanelProps) {
  const { t } = useTranslation();
  const { phase, committed, partial } = view;
  const recording = phase === 'listening' || phase === 'streaming';
  const processing = phase === 'correcting' || phase === 'polishing';
  const mando = pickMandoAction({
    speaking: recording && speaking,
    recordingSilent: recording && !speaking,
    processing,
    celebrating,
  });
  const showNotice = notice !== null && !committed && !partial && phase !== 'done';

  const routed = route !== 'paste-at-cursor';
  // The pill is a sign, not prose: English in every UI language.
  const en = { lng: 'en' } as const;
  const routeLabel = {
    'paste-at-cursor': t('app.live.listening', { ...en, defaultValue: 'Listening' }),
    'copy-to-clipboard': t('app.live.routeCopy', { ...en, defaultValue: 'Copy' }),
    'save-as-markdown': t('app.live.routeNote', { ...en, defaultValue: 'Note' }),
    project: t('app.live.routeProject', { ...en, defaultValue: 'Project' }),
  }[route];
  const label = {
    listening: routeLabel,
    streaming: routeLabel,
    correcting: t('app.live.correcting', { ...en, defaultValue: 'Checking…' }),
    polishing: t('app.live.polishing', { ...en, defaultValue: 'Polishing…' }),
    done: {
      'paste-at-cursor': t('app.live.done', { ...en, defaultValue: 'Pasted' }),
      'copy-to-clipboard': t('app.live.doneCopied', { ...en, defaultValue: 'Copied' }),
      'save-as-markdown': t('app.live.doneNote', { ...en, defaultValue: 'Saved' }),
      project: t('app.live.doneProject', { ...en, defaultValue: 'Filed' }),
    }[route],
  }[phase as Exclude<typeof phase, 'hidden'>];
  // Status colors stay for status: done is success; a routed dictation wears
  // the accent (as the route chip did) until then.
  const pillClass =
    phase === 'done'
      ? 'bg-success/15 text-success'
      : routed
        ? 'bg-primary text-primary-foreground'
        : processing
          ? 'bg-foreground/8 text-muted-foreground'
          : 'bg-mando/15 text-mando-deep';
  const PillIcon = phase === 'done' ? Check : routed ? ROUTE_ICON[route] : null;

  const noticeText =
    notice === 'model-missing'
      ? t('app.live.noticeModelMissing', {
          defaultValue:
            "Live preview model isn't downloaded (Settings → Transcription). Your text appears when you let go.",
        })
      : t('app.live.noticeUnavailable', {
          defaultValue: "Live preview didn't start. Your text appears when you let go.",
        });

  // Keep the end of the line (where new words land) in view: slide the line
  // left by however much it overflows.
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;
    setShift(Math.max(0, line.scrollWidth - box.clientWidth));
  }, [phase, committed, partial, showNotice, native]);

  const surface = native ? 'glass-native' : 'glass glass-rim rounded-[var(--radius-sheet)]';
  // CSS glass sits 4px inside its (transparent) window so the float shadow has room.
  const width = native ? PANEL_WIDTH_PX : PANEL_WIDTH_PX - 8;
  const fade = shift > 0 ? `linear-gradient(to right, transparent 0, black ${FADE_PX}px)` : 'none';

  return (
    <div
      className={`relative flex items-center text-left text-foreground ${surface}`}
      style={{
        width: `${width}px`,
        height: `${PANEL_HEIGHT_PX}px`,
        padding: `0 ${CANCEL_GUTTER_PX}px 0 6px`,
        cursor: 'inherit',
      }}
    >
      <style>{`
        @keyframes liveCaret { 50% { opacity: 0; } }
        @keyframes liveSettle { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.8; } }
      `}</style>
      <div
        className="flex shrink-0 flex-col items-center gap-0.5"
        style={{ width: `${SIDE_WIDTH_PX}px` }}
      >
        <MandoSprite
          action={mando.action}
          playing={mando.playing}
          loop={mando.loop}
          onAnimationEnd={mando.action === 'hop' ? onCelebrationEnd : undefined}
          size={MANDO_SIZE_PX}
        />
        <span
          role="status"
          aria-live="polite"
          className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 text-[11px] font-semibold leading-[18px] ${pillClass}`}
        >
          {PillIcon && <PillIcon size={11} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />}
          <span className="truncate">{label}</span>
        </span>
      </div>
      {showNotice ? (
        <p role="status" className="m-0 ml-2 line-clamp-2 text-[12px] font-medium leading-[16px] text-muted-foreground">
          {noticeText}
        </p>
      ) : (
        <div
          ref={boxRef}
          aria-hidden="true"
          className="ml-2 min-w-0 flex-1 overflow-hidden"
          style={{ maskImage: fade, WebkitMaskImage: fade }}
        >
          <span
            ref={lineRef}
            style={{
              display: 'inline-block',
              whiteSpace: 'nowrap', // one line: newlines from formatSpokenEnumeration read as spaces
              fontSize: '17px',
              lineHeight: '26px',
              transform: `translateX(${-shift}px)`,
              transition: 'transform 180ms ease-out',
              animation: processing ? 'liveSettle 1.6s ease-in-out infinite' : 'none',
            }}
          >
            {phase === 'listening' ? (
              <span className="text-muted-foreground/70">
                {t('app.live.startTalking', { defaultValue: 'Start talking…' })}
              </span>
            ) : (
              <>
                {committed}
                {partial && <span className="live-words text-foreground">{partial}</span>}
              </>
            )}
            {recording && (
              <span
                className="bg-live"
                style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '18px',
                  marginLeft: '1px',
                  verticalAlign: '-3px',
                  animation: 'liveCaret 1s steps(1) infinite',
                }}
              />
            )}
          </span>
        </div>
      )}
    </div>
  );
}
