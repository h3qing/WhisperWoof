import { useEffect } from 'react';
import type { AnimationEventHandler, CSSProperties } from 'react';
import { mandoSpriteStyle } from './mando-sprite';
import type { MandoAction } from './mando-sprite';
import waitSheet from '@/assets/mando/wait.webp';
import thinkSheet from '@/assets/mando/think.webp';
import reviewSheet from '@/assets/mando/review.webp';
import hopSheet from '@/assets/mando/hop.webp';

// Mando, animated from a single-row spritesheet via CSS steps() (the
// `mandoSprite` keyframes live in src/index.css). Sheets are built by
// scripts/build-mando-sprites.js from the Mando-assets-v6 pack.

const SHEETS: Record<MandoAction, string> = {
  wait: waitSheet,
  think: thinkSheet,
  review: reviewSheet,
  hop: hopSheet,
};

// Warm the other sheets the first time a sprite mounts (not at import: the
// single renderer bundle is shared by every window, and only the dictation
// overlay and agent bar ever render Mando). The Image objects stay referenced
// at module scope so the fetches are not collected mid-flight.
let preloadedSheets: HTMLImageElement[] = [];
function preloadSheets() {
  if (preloadedSheets.length > 0 || typeof Image === 'undefined') return;
  preloadedSheets = Object.values(SHEETS).map((src) => {
    const img = new Image();
    img.src = src;
    return img;
  });
}

interface MandoSpriteProps {
  action: MandoAction;
  /** CSS height in px. */
  size: number;
  /** false holds the first frame as a still. */
  playing?: boolean;
  /** false plays one pass, then settles back on the first frame. */
  loop?: boolean;
  /** Fires when a one-shot (loop=false) pass completes. */
  onAnimationEnd?: AnimationEventHandler<HTMLDivElement>;
  style?: CSSProperties;
  className?: string;
}

// The div is intentionally NOT keyed on `action`: the speaking/silent flip
// happens per audio sample, and remounting on each flip would restart the
// loop at frame 0 every few hundred ms. Same-length loops carry their phase.
export function MandoSprite({ action, size, playing = true, loop = true, onAnimationEnd, style, className }: MandoSpriteProps) {
  useEffect(preloadSheets, []);
  const spriteStyle = mandoSpriteStyle(action, { size, playing, loop, sheetUrl: SHEETS[action] });
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ ...spriteStyle, ...style }}
      onAnimationEnd={onAnimationEnd}
    />
  );
}
