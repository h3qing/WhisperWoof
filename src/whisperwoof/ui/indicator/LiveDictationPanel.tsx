import { useTranslation } from 'react-i18next';
import { MandoSprite } from './MandoSprite';
import { pickMandoAction } from './mando-sprite';
import type { LivePanelView } from '../../core/live/live-dictation';

// Live dictation panel: replaces the Mando indicator while a live-mode capture
// runs. Committed text is solid; the provisional tail (which the streaming
// model may still rewrite) carries a dotted underline, IME-style. After
// release the whole draft settles while the final pass + polish run, then the
// pasted text shows for a beat before the panel collapses.

const LINE_HEIGHT_PX = 22;
const MAX_LINES = 3;

const PHASE_STYLE: Record<string, { bg: string; fg: string }> = {
  listening: { bg: 'rgba(232,160,96,0.16)', fg: '#E8A060' },
  streaming: { bg: 'rgba(232,160,96,0.16)', fg: '#E8A060' },
  correcting: { bg: 'rgba(175,169,236,0.16)', fg: '#AFA9EC' },
  polishing: { bg: 'rgba(175,169,236,0.16)', fg: '#AFA9EC' },
  done: { bg: 'rgba(151,196,89,0.16)', fg: '#97C459' },
};

interface LiveDictationPanelProps {
  view: LivePanelView;
  speaking: boolean;
  celebrating: boolean;
  onCelebrationEnd?: () => void;
}

export function LiveDictationPanel({ view, speaking, celebrating, onCelebrationEnd }: LiveDictationPanelProps) {
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
  const pill = PHASE_STYLE[phase] ?? PHASE_STYLE.listening;
  const settled = processing;

  const label = {
    listening: t('app.live.listening', { defaultValue: 'Listening' }),
    streaming: t('app.live.listening', { defaultValue: 'Listening' }),
    correcting: t('app.live.correcting', { defaultValue: 'Checking…' }),
    polishing: t('app.live.polishing', { defaultValue: 'Polishing…' }),
    done: t('app.live.done', { defaultValue: 'Pasted' }),
  }[phase as Exclude<typeof phase, 'hidden'>];

  return (
    <div
      style={{
        width: '420px',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        padding: '10px 14px 12px 10px',
        borderRadius: '16px',
        background: 'rgba(28,24,20,0.94)',
        border: '1px solid rgba(232,213,195,0.12)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        textAlign: 'left',
        cursor: 'inherit',
      }}
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
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '1px 8px',
              borderRadius: '6px',
              background: pill.bg,
              color: pill.fg,
            }}
          >
            {label}
          </span>
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
              color: '#F2E6D8',
              wordBreak: 'break-word',
              animation: settled ? 'liveSettle 1.6s ease-in-out infinite' : 'none',
            }}
          >
            {phase === 'listening' ? (
              <span style={{ color: 'rgba(232,213,195,0.45)' }}>
                {t('app.live.startTalking', { defaultValue: 'Start talking…' })}
              </span>
            ) : (
              <>
                {committed}
                {partial && (
                  <span
                    style={{
                      color: 'rgba(242,230,216,0.72)',
                      textDecorationLine: 'underline',
                      textDecorationStyle: 'dotted',
                      textDecorationColor: '#E8A060',
                      textDecorationThickness: '2px',
                      textUnderlineOffset: '4px',
                    }}
                  >
                    {partial}
                  </span>
                )}
              </>
            )}
            {recording && (
              <span
                style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '16px',
                  marginLeft: '1px',
                  verticalAlign: '-3px',
                  background: '#E8A060',
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
