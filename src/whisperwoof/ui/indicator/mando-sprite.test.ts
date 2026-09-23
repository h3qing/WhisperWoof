import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  mandoSpriteStyle,
  pickMandoAction,
  MANDO_CELEBRATION_MS,
  nextCelebration,
} from './mando-sprite';
import type { MandoAction } from './mando-sprite';
import manifest from './mando-manifest.json';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ACTIONS = Object.keys(manifest) as MandoAction[];

describe('mandoSpriteStyle', () => {
  it('sizes the box to the requested height and keeps the 12:13 cell aspect', () => {
    const style = mandoSpriteStyle('wait', { size: 65, playing: true, loop: true, sheetUrl: 'wait.webp' });
    expect(style.height).toBe('65px');
    expect(style.width).toBe('60px');
    expect(style.backgroundImage).toBe('url(wait.webp)');
  });

  it('scales the whole sheet so one cell fills the box', () => {
    const { frameCount } = manifest.wait;
    const style = mandoSpriteStyle('wait', { size: 65, playing: true, loop: true, sheetUrl: 'wait.webp' });
    expect(style.backgroundSize).toBe(`${60 * frameCount}px 65px`);
    expect(style['--mando-sheet-w']).toBe(`-${60 * frameCount}px`);
  });

  it('steps through every frame once per cycle at the manifest timing', () => {
    const { frameCount, frameDurationMs } = manifest.think;
    const style = mandoSpriteStyle('think', { size: 65, playing: true, loop: true, sheetUrl: 'x' });
    expect(style.animation).toBe(`mandoSprite ${frameCount * frameDurationMs}ms steps(${frameCount}) infinite`);
  });

  it('plays a single pass and settles on the first frame when loop is off', () => {
    const { frameCount, frameDurationMs } = manifest.hop;
    const style = mandoSpriteStyle('hop', { size: 65, playing: true, loop: false, sheetUrl: 'x' });
    expect(style.animation).toBe(`mandoSprite ${frameCount * frameDurationMs}ms steps(${frameCount}) 1`);
  });

  it('holds the first frame with no animation when paused', () => {
    const style = mandoSpriteStyle('wait', { size: 65, playing: false, loop: true, sheetUrl: 'x' });
    expect(style.animation).toBe('none');
    expect(style.backgroundPosition).toBe('0 0');
  });
});

describe('pickMandoAction', () => {
  const idle = { speaking: false, recordingSilent: false, processing: false, celebrating: false };

  it('nods along while the user is speaking', () => {
    expect(pickMandoAction({ ...idle, speaking: true })).toEqual({ action: 'review', playing: true, loop: true });
  });

  it('tilts its head while waiting for voice', () => {
    expect(pickMandoAction({ ...idle, recordingSilent: true })).toEqual({ action: 'wait', playing: true, loop: true });
  });

  it('thinks while transcribing or polishing', () => {
    expect(pickMandoAction({ ...idle, processing: true })).toEqual({ action: 'think', playing: true, loop: true });
  });

  it('hops once right after a dictation lands', () => {
    expect(pickMandoAction({ ...idle, celebrating: true })).toEqual({ action: 'hop', playing: true, loop: false });
  });

  it('sits still when idle', () => {
    expect(pickMandoAction(idle)).toEqual({ action: 'wait', playing: false, loop: true });
  });

  it('prefers the live states over a stale celebration', () => {
    expect(pickMandoAction({ ...idle, celebrating: true, recordingSilent: true }).action).toBe('wait');
    expect(pickMandoAction({ ...idle, celebrating: true, processing: true }).action).toBe('think');
  });
});

describe('MANDO_CELEBRATION_MS', () => {
  it('celebrates for exactly one hop cycle', () => {
    expect(MANDO_CELEBRATION_MS).toBe(manifest.hop.frameCount * manifest.hop.frameDurationMs);
  });
});

describe('mandoSpriteStyle (edge cases)', () => {
  it('rounds a fractional width to whole pixels (AgentInput size 30 → 28px)', () => {
    // 30 * 120 / 130 = 27.69 — the sheet must be a whole-pixel multiple or steps() drifts.
    const style = mandoSpriteStyle('think', { size: 30, playing: true, loop: true, sheetUrl: 'x' });
    expect(style.width).toBe('28px');
    expect(style.height).toBe('30px');
    expect(style.backgroundSize).toBe(`${28 * manifest.think.frameCount}px 30px`);
    expect(style['--mando-sheet-w']).toBe(`-${28 * manifest.think.frameCount}px`);
  });

  it('builds a consistent style for every action in the manifest', () => {
    ACTIONS.forEach((action) => {
      const { frameCount, frameDurationMs } = manifest[action];
      const style = mandoSpriteStyle(action, { size: 65, playing: true, loop: true, sheetUrl: `${action}.webp` });
      expect(style.backgroundRepeat).toBe('no-repeat');
      expect(style.backgroundImage).toBe(`url(${action}.webp)`);
      expect(style.backgroundSize).toBe(`${60 * frameCount}px 65px`);
      expect(style.animation).toBe(`mandoSprite ${frameCount * frameDurationMs}ms steps(${frameCount}) infinite`);
    });
  });

  it('is pure: returns a fresh object each call and never mutates the manifest', () => {
    const before = JSON.stringify(manifest);
    const opts = { size: 65, playing: true, loop: true, sheetUrl: 'x' };
    const a = mandoSpriteStyle('wait', opts);
    const b = mandoSpriteStyle('wait', opts);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(JSON.stringify(manifest)).toBe(before);
  });

  it('names the keyframes that src/index.css declares and exposes the sheet-width variable', () => {
    const css = fs.readFileSync(path.join(REPO_ROOT, 'src/index.css'), 'utf8');
    const style = mandoSpriteStyle('wait', { size: 65, playing: true, loop: true, sheetUrl: 'x' });
    expect(css).toMatch(/@keyframes mandoSprite\s*\{[^}]*background-position-x:\s*var\(--mando-sheet-w\)/);
    expect(String(style.animation).startsWith('mandoSprite ')).toBe(true);
    expect(Object.keys(style)).toContain('--mando-sheet-w');
  });
});

describe('pickMandoAction (priority chain)', () => {
  const all = { speaking: true, recordingSilent: true, processing: true, celebrating: true };

  it('speaking wins over every other mood, then silence beats processing', () => {
    expect(pickMandoAction(all).action).toBe('review');
    expect(pickMandoAction({ ...all, speaking: false }).action).toBe('wait');
    expect(pickMandoAction({ ...all, speaking: false, recordingSilent: false }).action).toBe('think');
    expect(pickMandoAction({ ...all, speaking: false, recordingSilent: false, processing: false }).action).toBe('hop');
  });

  it('does not mutate the mood it is given', () => {
    const mood = { speaking: false, recordingSilent: false, processing: true, celebrating: true };
    const snapshot = { ...mood };
    pickMandoAction(mood);
    expect(mood).toEqual(snapshot);
  });
});

describe('celebration contract', () => {
  it('MANDO_CELEBRATION_MS equals the hop sprite single-pass duration', () => {
    const style = mandoSpriteStyle('hop', { size: 64, playing: true, loop: false, sheetUrl: 'x' });
    const ms = Number(String(style.animation).match(/mandoSprite (\d+)ms/)?.[1]);
    expect(ms).toBe(MANDO_CELEBRATION_MS);
    expect(String(style.animation).endsWith(' 1')).toBe(true);
  });
});

describe('manifest and assets', () => {
  it('every action has sane integer timing, the 12:13 cell, and a spritesheet on disk for app and site', () => {
    ACTIONS.forEach((action) => {
      const { frameCount, frameDurationMs, cellWidth, cellHeight } = manifest[action];
      expect(Number.isInteger(frameCount) && frameCount > 0).toBe(true);
      expect(Number.isInteger(frameDurationMs) && frameDurationMs > 0).toBe(true);
      expect(cellWidth * 13).toBe(cellHeight * 12);
      expect(fs.existsSync(path.join(REPO_ROOT, 'src/assets/mando', `${action}.webp`))).toBe(true);
      expect(fs.existsSync(path.join(REPO_ROOT, 'website/mando/sprites', `${action}.webp`))).toBe(true);
    });
  });

  it('every Mando loop the website references is built and on disk', () => {
    // The site plays full-resolution loops from website/mando/hd, written by
    // scripts/build-mando-sprites.js from the same pack as the app sheets.
    const html = fs.readFileSync(path.join(REPO_ROOT, 'website/index.html'), 'utf8');
    const referenced = [...html.matchAll(/mando\/hd\/(\w+)\.webp/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    new Set(referenced).forEach((action) => {
      expect(ACTIONS).toContain(action);
      expect(fs.existsSync(path.join(REPO_ROOT, 'website/mando/hd', `${action}.webp`))).toBe(true);
    });
  });
});

describe('nextCelebration', () => {
  const idle = { celebrating: false, completed: 3, acknowledged: 3, recording: false, processing: false };

  it('starts a hop (and its fallback timer) once a dictation has landed and the pipeline is idle', () => {
    expect(nextCelebration({ ...idle, completed: 4 })).toEqual({ celebrating: true, startTimer: true, acknowledged: 4 });
  });

  it('holds a landed dictation while processing is still finishing, then hops when idle', () => {
    const during = nextCelebration({ ...idle, completed: 4, processing: true });
    expect(during).toEqual({ celebrating: false, startTimer: false, acknowledged: 3 });
    expect(nextCelebration({ ...idle, completed: 4, acknowledged: during.acknowledged })).toMatchObject({ celebrating: true });
  });

  it('does not hop when processing ended without text landing (cancel, error, silence)', () => {
    expect(nextCelebration(idle)).toEqual({ celebrating: false, startTimer: false, acknowledged: 3 });
  });

  it('keeps an in-flight hop while nothing changes, without re-arming the timer', () => {
    expect(nextCelebration({ ...idle, celebrating: true })).toEqual({ celebrating: true, startTimer: false, acknowledged: 3 });
  });

  it('cancels a pending hop as soon as a new recording or processing run starts', () => {
    expect(nextCelebration({ ...idle, celebrating: true, recording: true })).toMatchObject({ celebrating: false, startTimer: false });
    expect(nextCelebration({ ...idle, celebrating: true, processing: true })).toMatchObject({ celebrating: false, startTimer: false });
  });

  it('abandons an uncelebrated success when the user starts a fresh recording', () => {
    const step = nextCelebration({ ...idle, completed: 4, recording: true });
    expect(step.acknowledged).toBe(4);
    // that recording is cancelled without processing: nothing left to celebrate
    expect(nextCelebration({ ...idle, completed: 4, acknowledged: step.acknowledged })).toMatchObject({ celebrating: false });
  });

  it('never leaves celebrating stuck on after re-record → cancel inside the hop window', () => {
    let step = nextCelebration({ ...idle, completed: 4 });
    expect(step.celebrating).toBe(true);
    step = nextCelebration({ ...idle, completed: 4, celebrating: step.celebrating, acknowledged: step.acknowledged, recording: true });
    step = nextCelebration({ ...idle, completed: 4, celebrating: step.celebrating, acknowledged: step.acknowledged });
    expect(step).toEqual({ celebrating: false, startTimer: false, acknowledged: 4 });
  });

  it('does not mutate its input', () => {
    const input = { ...idle, completed: 4, recording: true };
    const snapshot = { ...input };
    nextCelebration(input);
    expect(input).toEqual(snapshot);
  });
});
