import { describe, it, expect } from 'vitest';
import { pickOverlaySize } from './overlay-size';

const idle = { menuOpen: false, capsule: false, liveModeEnabled: false, nonLiveCapture: false };

describe('pickOverlaySize', () => {
  it('gives the menu its room first, even over a notice', () => {
    expect(pickOverlaySize({ ...idle, menuOpen: true, capsule: true })).toBe('WITH_MENU');
  });

  it('makes the window exactly the capsule for the live panel or a notice, in any mode', () => {
    expect(pickOverlaySize({ ...idle, capsule: true })).toBe('LIVE_PANEL');
    expect(pickOverlaySize({ ...idle, capsule: true, liveModeEnabled: true })).toBe('LIVE_PANEL');
  });

  it('keeps live mode wide when idle, unless this capture fell back to the regular indicator', () => {
    expect(pickOverlaySize({ ...idle, liveModeEnabled: true })).toBe('LIVE');
    expect(pickOverlaySize({ ...idle, liveModeEnabled: true, nonLiveCapture: true })).toBe('BASE');
  });

  it('is the small Mando otherwise', () => {
    expect(pickOverlaySize(idle)).toBe('BASE');
  });
});
