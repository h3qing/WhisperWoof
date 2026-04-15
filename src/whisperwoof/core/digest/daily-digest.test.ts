/**
 * Tests for Daily Digest — entry aggregation and summary generation
 *
 * Imports from the actual pure module (no duplicated implementation).
 */

import { describe, it, expect } from 'vitest';

// Import from the pure module — no electron/fs side effects
const { buildDigestData, DIGEST_PROMPT } = require('../../bridge/daily-digest-pure');

interface DigestEntry {
  id: string;
  source: string;
  text: string;
  routedTo: string | null;
  createdAt: string;
}

const SAMPLE_ENTRIES: DigestEntry[] = [
  { id: "1", source: "voice", text: "Remind me to call Sarah about the project timeline", routedTo: "paste-at-cursor", createdAt: "2026-03-30T09:00:00Z" },
  { id: "2", source: "voice", text: "Need to review the Q1 budget numbers before Friday meeting", routedTo: "paste-at-cursor", createdAt: "2026-03-30T10:00:00Z" },
  { id: "3", source: "clipboard", text: "https://docs.google.com/spreadsheet/budget-q1", routedTo: null, createdAt: "2026-03-30T10:05:00Z" },
  { id: "4", source: "voice", text: "Decision: we're going with the new vendor for hosting. Start migration next week.", routedTo: "paste-at-cursor", createdAt: "2026-03-30T11:00:00Z" },
  { id: "5", source: "meeting", text: "Standup notes: discussed sprint priorities and the deployment schedule change", routedTo: "telegram-companion", createdAt: "2026-03-30T14:00:00Z" },
];

describe('Daily Digest', () => {
  describe('buildDigestData', () => {
    it('counts entries', () => {
      const data = buildDigestData(SAMPLE_ENTRIES);
      expect(data.entryCount).toBe(5);
    });

    it('counts words across all entries', () => {
      const data = buildDigestData(SAMPLE_ENTRIES);
      expect(data.wordCount).toBeGreaterThan(30);
    });

    it('groups by source', () => {
      const data = buildDigestData(SAMPLE_ENTRIES);
      expect(data.sources.voice).toBe(3);
      expect(data.sources.clipboard).toBe(1);
      expect(data.sources.meeting).toBe(1);
    });

    it('captures time range', () => {
      const data = buildDigestData(SAMPLE_ENTRIES);
      expect(data.timeRange).not.toBeNull();
      expect(data.timeRange!.start).toBe("2026-03-30T09:00:00Z");
      expect(data.timeRange!.end).toBe("2026-03-30T14:00:00Z");
    });

    it('handles empty entries', () => {
      const data = buildDigestData([]);
      expect(data.entryCount).toBe(0);
      expect(data.wordCount).toBe(0);
      expect(data.sources).toEqual({});
      expect(data.timeRange).toBeNull();
    });

    it('handles single entry', () => {
      const data = buildDigestData([SAMPLE_ENTRIES[0]]);
      expect(data.entryCount).toBe(1);
      expect(data.sources.voice).toBe(1);
      expect(data.timeRange!.start).toBe(data.timeRange!.end);
    });

    it('handles entries with empty text', () => {
      const withEmpty: DigestEntry[] = [
        { id: "x", source: "clipboard", text: "", routedTo: null, createdAt: "2026-03-30T09:00:00Z" },
      ];
      const data = buildDigestData(withEmpty);
      expect(data.wordCount).toBe(0);
      expect(data.entryCount).toBe(1);
    });
  });

  describe('source breakdown', () => {
    it('handles all source types', () => {
      const entries: DigestEntry[] = [
        { id: "1", source: "voice", text: "hello", routedTo: null, createdAt: "2026-03-30T09:00:00Z" },
        { id: "2", source: "clipboard", text: "world", routedTo: null, createdAt: "2026-03-30T09:01:00Z" },
        { id: "3", source: "meeting", text: "notes", routedTo: null, createdAt: "2026-03-30T09:02:00Z" },
        { id: "4", source: "import", text: "imported", routedTo: null, createdAt: "2026-03-30T09:03:00Z" },
      ];
      const data = buildDigestData(entries);
      expect(data.sources.voice).toBe(1);
      expect(data.sources.clipboard).toBe(1);
      expect(data.sources.meeting).toBe(1);
      expect(data.sources.import).toBe(1);
    });

    it('handles unknown sources gracefully', () => {
      const entries: DigestEntry[] = [
        { id: "1", source: "", text: "test", routedTo: null, createdAt: "2026-03-30T09:00:00Z" },
      ];
      const data = buildDigestData(entries);
      // Empty source falls through to "unknown" via || operator
      expect(data.sources["unknown"]).toBe(1);
    });
  });

  describe('digest structure', () => {
    it('all required fields present', () => {
      const data = buildDigestData(SAMPLE_ENTRIES);
      expect(data).toHaveProperty("entryCount");
      expect(data).toHaveProperty("wordCount");
      expect(data).toHaveProperty("sources");
      expect(data).toHaveProperty("timeRange");
    });

    it('word count is non-negative', () => {
      const data = buildDigestData(SAMPLE_ENTRIES);
      expect(data.wordCount).toBeGreaterThanOrEqual(0);
    });

    it('entry count matches input length', () => {
      expect(buildDigestData(SAMPLE_ENTRIES).entryCount).toBe(SAMPLE_ENTRIES.length);
      expect(buildDigestData([]).entryCount).toBe(0);
    });
  });

  describe('digest prompt', () => {
    it('prompt exists and is non-empty', () => {
      expect(DIGEST_PROMPT.length).toBeGreaterThan(10);
    });

    it('prompt includes required section names', () => {
      expect(DIGEST_PROMPT).toContain("Key Topics");
      expect(DIGEST_PROMPT).toContain("Action Items");
      expect(DIGEST_PROMPT).toContain("Decisions");
    });
  });
});
