/**
 * Tests for Streaming Transcription Manager
 *
 * Tests session lifecycle, partial buffering, word diffing, display formatting.
 * Imports from the actual source module (no duplicated implementation).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock debugLogger before importing the source module
vi.mock('../../helpers/debugLogger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Import from the actual source — single source of truth
const {
  createSession,
  updatePartial,
  finalizeSession,
  diffPartials,
  formatForDisplay,
  getWpm,
  MAX_PARTIAL_LENGTH,
  STALE_THRESHOLD_MS,
} = require('../../bridge/streaming-manager');

describe('Streaming Manager', () => {
  describe('session lifecycle', () => {
    it('creates an active session', () => {
      const session = createSession();
      expect(session.isActive).toBe(true);
      expect(session.partialText).toBe("");
      expect(session.finalText).toBe("");
      expect(session.wordCount).toBe(0);
      expect(session.updateCount).toBe(0);
    });

    it('updates partial text immutably', () => {
      const s1 = createSession();
      const s2 = updatePartial(s1, "hello world");
      expect(s2.partialText).toBe("hello world");
      expect(s2.wordCount).toBe(2);
      expect(s2.updateCount).toBe(1);
      expect(s1.partialText).toBe(""); // original unchanged
    });

    it('increments update count on each partial', () => {
      let session = createSession();
      session = updatePartial(session, "hello");
      session = updatePartial(session, "hello world");
      session = updatePartial(session, "hello world test");
      expect(session.updateCount).toBe(3);
    });

    it('finalizes session with final text', () => {
      let session = createSession();
      session = updatePartial(session, "hello world");
      session = finalizeSession(session, "Hello world.");
      expect(session.isActive).toBe(false);
      expect(session.finalText).toBe("Hello world.");
      expect(session.partialText).toBe("");
    });

    it('does not update after finalization', () => {
      let session = createSession();
      session = finalizeSession(session, "done");
      const updated = updatePartial(session, "new text");
      expect(updated.partialText).toBe(""); // no change
    });

    it('truncates very long partials', () => {
      const session = createSession();
      const longText = "word ".repeat(100);
      const updated = updatePartial(session, longText);
      expect(updated.partialText.length).toBeLessThanOrEqual(MAX_PARTIAL_LENGTH + 1); // +1 for ellipsis char
    });
  });

  describe('diffPartials', () => {
    it('detects no change', () => {
      const diff = diffPartials("hello world", "hello world");
      expect(diff.unchanged).toBe(2);
      expect(diff.changed).toBe(0);
      expect(diff.added).toBe(0);
    });

    it('detects added words', () => {
      const diff = diffPartials("hello", "hello world test");
      expect(diff.unchanged).toBe(1);
      expect(diff.added).toBe(2);
      expect(diff.newWords).toEqual(["world", "test"]);
    });

    it('detects changed words', () => {
      const diff = diffPartials("hello world", "hello there");
      expect(diff.unchanged).toBe(1);
      expect(diff.changed).toBe(1);
      expect(diff.added).toBe(1);
      expect(diff.newWords).toEqual(["there"]);
    });

    it('handles empty old text', () => {
      const diff = diffPartials("", "hello world");
      expect(diff.unchanged).toBe(0);
      expect(diff.added).toBe(2);
    });

    it('handles empty new text', () => {
      const diff = diffPartials("hello world", "");
      expect(diff.unchanged).toBe(0);
      expect(diff.changed).toBe(2);
      expect(diff.added).toBe(0);
    });

    it('handles null inputs', () => {
      const diff = diffPartials(null as any, null as any);
      expect(diff.unchanged).toBe(0);
    });
  });

  describe('formatForDisplay', () => {
    it('returns short text as-is', () => {
      expect(formatForDisplay("hello world")).toBe("hello world");
    });

    it('truncates long text from the left', () => {
      const long = "this is a very long transcription that should be truncated from the left side to show recent words";
      const formatted = formatForDisplay(long, 40);
      expect(formatted.startsWith("\u2026")).toBe(true);
      expect(formatted.length).toBeLessThanOrEqual(42); // 40 + ellipsis + space
    });

    it('returns empty for empty input', () => {
      expect(formatForDisplay("")).toBe("");
      expect(formatForDisplay(null as any)).toBe("");
    });

    it('respects maxChars parameter', () => {
      const text = "a ".repeat(100);
      const formatted = formatForDisplay(text, 20);
      expect(formatted.length).toBeLessThanOrEqual(22);
    });
  });

  describe('getWpm', () => {
    it('returns 0 for new session', () => {
      const session = createSession();
      expect(getWpm(session)).toBe(0);
    });

    it('returns 0 for empty session', () => {
      expect(getWpm(null as any)).toBe(0);
    });

    it('calculates WPM correctly for sessions with elapsed time', () => {
      const session = {
        ...createSession(),
        startedAt: Date.now() - 60000, // 1 minute ago
        wordCount: 150,
      };
      const wpm = getWpm(session);
      expect(wpm).toBeGreaterThan(140);
      expect(wpm).toBeLessThan(160);
    });
  });

  describe('session immutability', () => {
    it('createSession returns frozen object', () => {
      const session = createSession();
      expect(Object.isFrozen(session)).toBe(true);
    });

    it('updatePartial returns frozen object', () => {
      const updated = updatePartial(createSession(), "test");
      expect(Object.isFrozen(updated)).toBe(true);
    });

    it('finalizeSession returns frozen object', () => {
      const final = finalizeSession(createSession(), "done");
      expect(Object.isFrozen(final)).toBe(true);
    });
  });

  describe('constants', () => {
    it('MAX_PARTIAL_LENGTH is 200', () => {
      expect(MAX_PARTIAL_LENGTH).toBe(200);
    });

    it('STALE_THRESHOLD_MS is 3000', () => {
      expect(STALE_THRESHOLD_MS).toBe(3000);
    });
  });
});
