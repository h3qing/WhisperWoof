import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { MandoSprite } from './MandoSprite';
import { pickMandoAction } from './mando-sprite';
import {
  CANCEL_GUTTER_PX,
  MANDO_SIZE_PX,
  PANEL_HEIGHT_PX,
  PANEL_WIDTH_PX,
  SIDE_WIDTH_PX,
} from './LiveDictationPanel';
import { noticeArmed, type IndicatorNotice, type NoticeTone } from '../../core/indicator/notices';

// Mando says something between captures, in the live panel's own capsule:
// the sign under him says what kind of thing it is, the line beside him says
// what happened (and what to do), buttons sit under the line. The window is
// exactly this capsule, so nothing around it blocks the app behind.

const SIGN_CLASS: Record<NoticeTone, string> = {
  info: 'bg-mando/15 text-mando-deep',
  success: 'bg-success/15 text-success',
  error: 'bg-destructive/15 text-destructive',
};

interface MandoNoticeProps {
  notice: IndicatorNotice;
  /** Same as the live panel: the window carries macOS vibrancy, add only light. */
  native?: boolean;
  onDismiss: () => void;
  /** The pointer is on the notice (holds it on screen). */
  onHold?: (held: boolean) => void;
}

export function MandoNotice({ notice, native = false, onDismiss, onHold }: MandoNoticeProps) {
  const { t } = useTranslation();
  const tone = notice.tone ?? 'info';
  // Mando's "huh?" for errors (and "No voice"); anything else, Mando sitting still.
  const mando = pickMandoAction({
    speaking: false,
    recordingSilent: false,
    processing: false,
    celebrating: false,
    heardNothing: notice.puzzled ?? tone === 'error',
  });
  const actions = notice.actions ?? [];
  // A click that lands just as a notice appears was meant for Mando (the
  // notice took his spot), not for "Always".
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [notice.id]);
  const surface = native ? 'glass-native' : 'glass glass-rim rounded-[var(--radius-sheet)]';
  // CSS glass sits 4px inside its (transparent) window so the float shadow has room.
  const width = native ? PANEL_WIDTH_PX : PANEL_WIDTH_PX - 8;
  const fullText = [notice.title, notice.description].filter(Boolean).join('\n');

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`relative flex items-center text-left text-foreground ${surface}`}
      style={{
        width: `${width}px`,
        height: `${PANEL_HEIGHT_PX}px`,
        padding: `0 ${CANCEL_GUTTER_PX}px 0 6px`,
      }}
      onMouseEnter={() => onHold?.(true)}
      onMouseLeave={() => onHold?.(false)}
    >
      <div
        className="flex shrink-0 flex-col items-center gap-0.5"
        style={{ width: `${SIDE_WIDTH_PX}px` }}
      >
        <MandoSprite
          action={mando.action}
          playing={mando.playing}
          frame={mando.frame}
          loop={mando.loop}
          puzzled={mando.puzzled}
          size={MANDO_SIZE_PX}
        />
        <span
          className={`inline-flex max-w-full items-center truncate rounded-full px-2 text-[11px] font-semibold leading-[18px] ${SIGN_CLASS[tone]}`}
        >
          <span className="truncate">{notice.sign}</span>
        </span>
      </div>
      <div className="ml-2 min-w-0 flex-1" title={fullText}>
        <p
          className={`m-0 text-[13px] font-semibold leading-[17px] ${
            notice.description ? 'truncate' : 'line-clamp-2'
          }`}
        >
          {notice.title}
        </p>
        {notice.description && (
          <p
            className={`m-0 text-[12px] leading-[16px] text-muted-foreground ${
              actions.length ? 'truncate' : 'line-clamp-2'
            }`}
          >
            {notice.description}
          </p>
        )}
        {actions.length > 0 && (
          <div className="mt-1 flex gap-1.5">
            {actions.map((action) => (
              <Button
                key={action.label}
                type="button"
                variant={action.primary ? 'default' : 'outline'}
                size="sm"
                className="h-[22px] px-2.5 py-0 text-[12px]"
                onClick={() => {
                  if (noticeArmed(shownAt.current, Date.now())) action.onClick();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={t('common.dismiss', { defaultValue: 'Dismiss' })}
        onClick={() => {
          if (noticeArmed(shownAt.current, Date.now())) onDismiss();
        }}
        className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-foreground/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X size={11} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
