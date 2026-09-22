import type { CSSProperties } from 'react';
import manifest from './mando-manifest.json';

// Pure helpers behind <MandoSprite>. No DOM, no image imports, so the
// indicator's state → animation mapping is unit-testable in node.

export type MandoAction = keyof typeof manifest;

export interface MandoPlayback {
  action: MandoAction;
  playing: boolean;
  loop: boolean;
}

interface SpriteStyleOptions extends Omit<MandoPlayback, 'action'> {
  /** CSS height of the sprite box in px; width follows the 12:13 cell aspect. */
  size: number;
  sheetUrl: string;
}

// Pairs with `@keyframes mandoSprite` in src/index.css.
export function mandoSpriteStyle(
  action: MandoAction,
  { size, playing, loop, sheetUrl }: SpriteStyleOptions
): CSSProperties & { '--mando-sheet-w': string } {
  const { frameCount, frameDurationMs, cellWidth, cellHeight } = manifest[action];
  const width = Math.round((size * cellWidth) / cellHeight);
  const sheetWidth = width * frameCount;
  const durationMs = frameCount * frameDurationMs;
  const animation = !playing
    ? 'none'
    : `mandoSprite ${durationMs}ms steps(${frameCount}) ${loop ? 'infinite' : '1'}`;

  return {
    width: `${width}px`,
    height: `${size}px`,
    backgroundImage: `url(${sheetUrl})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${sheetWidth}px ${size}px`,
    backgroundPosition: '0 0',
    animation,
    '--mando-sheet-w': `-${sheetWidth}px`,
  };
}

interface IndicatorMood {
  speaking: boolean;
  recordingSilent: boolean;
  processing: boolean;
  /** True for a moment after a dictation finished and pasted. */
  celebrating: boolean;
}

export function pickMandoAction(mood: IndicatorMood): MandoPlayback {
  if (mood.speaking) return { action: 'review', playing: true, loop: true };
  if (mood.recordingSilent) return { action: 'wait', playing: true, loop: true };
  if (mood.processing) return { action: 'think', playing: true, loop: true };
  if (mood.celebrating) return { action: 'hop', playing: true, loop: false };
  return { action: 'wait', playing: false, loop: true };
}

/** How long the post-dictation hop shows before Mando sits back down. */
export const MANDO_CELEBRATION_MS = manifest.hop.frameCount * manifest.hop.frameDurationMs;

interface CelebrationInput {
  celebrating: boolean;
  /** Successful dictations so far (text actually landed). */
  completed: number;
  /** The `completed` value the last hop was for. */
  acknowledged: number;
  recording: boolean;
  processing: boolean;
}

interface CelebrationStep {
  celebrating: boolean;
  /** Arm the fallback timer that clears `celebrating` if animationend never fires. */
  startTimer: boolean;
  acknowledged: number;
}

/**
 * One step of the celebration state machine. Mando hops only when a dictation
 * actually landed (cancel, error and silence never bump `completed`), and a new
 * recording or processing run always cancels a pending hop, so an interrupted
 * celebration can never pin `celebrating` (and the auto-hide guard) on.
 */
export function nextCelebration({
  celebrating,
  completed,
  acknowledged,
  recording,
  processing,
}: CelebrationInput): CelebrationStep {
  // A fresh recording abandons any success we have not celebrated yet.
  if (recording) return { celebrating: false, startTimer: false, acknowledged: completed };
  // Success is counted before processing ends; keep it unacknowledged until idle.
  if (processing) return { celebrating: false, startTimer: false, acknowledged };
  if (completed !== acknowledged) return { celebrating: true, startTimer: true, acknowledged: completed };
  return { celebrating, startTimer: false, acknowledged };
}
