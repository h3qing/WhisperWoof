/**
 * Which WINDOW_SIZES key the dictation overlay asks main for. The live panel
 * and a notice share LIVE_PANEL (360 × 72, the only size with a native
 * material): the window is exactly the capsule.
 */
export type OverlaySize = 'WITH_MENU' | 'LIVE_PANEL' | 'LIVE' | 'BASE';

export function pickOverlaySize(overlay: {
  menuOpen: boolean;
  /** The live panel or a notice is on screen. */
  capsule: boolean;
  liveModeEnabled: boolean;
  /** Live mode, but this capture found no usable stream. */
  nonLiveCapture: boolean;
}): OverlaySize {
  if (overlay.menuOpen) return 'WITH_MENU';
  if (overlay.capsule) return 'LIVE_PANEL';
  // Live mode keeps the wide size even when idle: resizing at every capture
  // start/end drew the panel into the narrow window first (center strip, then
  // the sides) and left a stale frame behind on shrink.
  if (overlay.liveModeEnabled && !overlay.nonLiveCapture) return 'LIVE';
  return 'BASE';
}
