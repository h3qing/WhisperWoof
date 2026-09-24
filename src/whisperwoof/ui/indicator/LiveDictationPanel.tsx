import { useTranslation } from 'react-i18next';
import { MandoSprite } from './MandoSprite';
import { pickMandoAction } from './mando-sprite';
import type { LivePanelView } from '../../core/live/live-dictation';
import type { DictationRoute } from '../../core/router/dictation-route';
import { RouteChip } from './RouteChip';

// Live dictation panel: replaces the Mando indicator while a live-mode capture
// runs. Committed text is solid ink; the provisional tail (which the streaming
// model may still rewrite) sits in frosted caramel glass (`live-words`), the
// design's one signature element: words are glass until they land. After
// release the whole draft settles while the final pass + polish run, then the
// pasted text shows for a beat before the panel collapses.

const LINE_HEIGHT_PX = 22;
const MAX_LINES = 3;
// Fits WINDOW_SIZES.LIVE_PANEL (112px): 10 + pill row 22 + 3 lines + 12.
const PANEL_HEIGHT_PX = 112;

const PHASE_PILL: Record<string, string> = {
  listening: 'bg-mando/15 text-mando-deep',
  streaming: 'bg-mando/15 text-mando-deep',
  correcting: 'bg-foreground/8 text-muted-foreground',
  polishing: 'bg-foreground/8 text-muted-foreground',
  done: 'bg-success/15 text-success',
};

interface LiveDictationPanelProps {
  view: LivePanelView;
  speaking: boolean;
  celebrating: boolean;
  onCelebrationEnd?: () => void;
  /** The window is exactly this panel and carries macOS vibrancy: fill it and
   *  add only a light Mando tint. Otherwise the panel draws its own CSS glass. */
  native?: boolean;
  /** Where this dictation goes; anything but paste shows a chip from the
   *  moment Fn+letter is pressed, and the done label names the destination. */
  route?: DictationRoute;
}

export function LiveDictationPanel({
  view,
  speaking,
  celebrating,
  onCelebrationEnd,
  native = false,
  route = 'paste-at-cursor',
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
  const pillClass = PHASE_PILL[phase] ?? PHASE_PILL.listening;
  const settled = processing;

  const label = {
    listening: t('app.live.listening', { defaultValue: 'Listening' }),
    streaming: t('app.live.listening', { defaultValue: 'Listening' }),
    correcting: t('app.live.correcting', { defaultValue: 'Checking…' }),
    polishing: t('app.live.polishing', { defaultValue: 'Polishing…' }),
    done: {
      'paste-at-cursor': t('app.live.done', { defaultValue: 'Pasted' }),
      'copy-to-clipboard': t('app.live.doneCopied', { defaultValue: 'Copied' }),
      'save-as-markdown': t('app.live.doneNote', { defaultValue: 'Saved as note' }),
      project: t('app.live.doneProject', { defaultValue: 'Filed to project' }),
    }[route],
  }[phase as Exclude<typeof phase, 'hidden'>];


  const surface = native
    ? 'w-[420px] bg-mando/[0.07]'
    : 'w-[412px] glass glass-rim rounded-[var(--radius-sheet)]';

  return (
    <div
      className={`relative flex items-start gap-2.5 text-left text-foreground ${surface}`}
      style={{ height: `${PANEL_HEIGHT_PX}px`, padding: '10px 14px 12px 10px', cursor: 'inherit' }}
    >
      <style>{`
        @keyframes liveCaret { 50% { opacity: 0; } }
        @keyframes liveSettle { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.8; } }
      `}</style>
      <MandoSprite
        action={mando.action}
        playing={mando.playing}
        loop={mando.loop}
        onAnimationEnd={mando.action === 'hop' ? onCelebrationEnd : undefined}
        size={44}
        style={{ flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div role="status" aria-live="polite" className="mb-1 flex h-5 items-center gap-2">
          <span className={`rounded-full px-2 text-[11px] font-semibold leading-[18px] ${pillClass}`}>
            {label}
          </span>
          {phase !== 'done' && <RouteChip route={route} />}
        </div>
        <div
          aria-hidden="true"
          style={{
            maxHeight: `${LINE_HEIGHT_PX * MAX_LINES}px`,
            minHeight: `${LINE_HEIGHT_PX}px`,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            // Older lines scroll off the top; fade them instead of a hard cut.
            maskImage: 'linear-gradient(to bottom, transparent 0, black 14px)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 14px)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '15px',
              lineHeight: `${LINE_HEIGHT_PX}px`,
              wordBreak: 'break-word',
              whiteSpace: 'pre-line', // numbered lists from formatSpokenEnumeration
              animation: settled ? 'liveSettle 1.6s ease-in-out infinite' : 'none',
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
                  height: '16px',
                  marginLeft: '1px',
                  verticalAlign: '-3px',
                  animation: 'liveCaret 1s steps(1) infinite',
                }}
              />
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
