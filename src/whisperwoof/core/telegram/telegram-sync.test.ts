/**
 * Tests for Telegram Companion Sync — inbox import logic
 *
 * Imports `transformEntry` and `filterPending` from the pure source
 * module at src/whisperwoof/bridge/telegram-sync-pure.js, which is the
 * same implementation the production `importPendingEntries` delegates to.
 * File I/O, polling, and Electron APIs are out of scope.
 */

import { describe, it, expect } from 'vitest';
import { transformEntry, filterPending } from "../../bridge/telegram-sync-pure";

interface TelegramInboxEntry {
  id: string;
  source: string;
  rawText: string;
  polished: string | null;
  from: string;
  chatId: number;
  createdAt: string;
  durationSec: number | null;
  imported: boolean;
}

interface TransformedEntry {
  source: string;
  rawText: string;
  polished: string | null;
  routedTo: string;
  durationMs: number | null;
  metadata: Record<string, unknown>;
}

const SAMPLE_ENTRIES: TelegramInboxEntry[] = [
  {
    id: "tg-1",
    source: "telegram",
    rawText: "Remind me to call Sarah",
    polished: null,
    from: "Heqing",
    chatId: 12345,
    createdAt: "2026-03-30T10:00:00Z",
    durationSec: 5,
    imported: false,
  },
  {
    id: "tg-2",
    source: "telegram",
    rawText: "Meeting notes from standup",
    polished: null,
    from: "Heqing",
    chatId: 12345,
    createdAt: "2026-03-30T10:01:00Z",
    durationSec: 12,
    imported: true,
  },
  {
    id: "tg-3",
    source: "telegram",
    rawText: "Buy groceries",
    polished: null,
    from: "Heqing",
    chatId: 12345,
    createdAt: "2026-03-30T10:02:00Z",
    durationSec: null,
    imported: false,
  },
];

describe('Telegram Companion Sync', () => {
  describe('filterPending', () => {
    it('returns only unimported entries', () => {
      const pending = filterPending(SAMPLE_ENTRIES);
      expect(pending).toHaveLength(2);
      expect(pending[0].id).toBe("tg-1");
      expect(pending[1].id).toBe("tg-3");
    });

    it('returns empty array when all imported', () => {
      const allImported = SAMPLE_ENTRIES.map((e: TelegramInboxEntry) => ({ ...e, imported: true }));
      expect(filterPending(allImported)).toHaveLength(0);
    });

    it('returns all when none imported', () => {
      const noneImported = SAMPLE_ENTRIES.map((e: TelegramInboxEntry) => ({ ...e, imported: false }));
      expect(filterPending(noneImported)).toHaveLength(3);
    });

    it('handles empty array', () => {
      expect(filterPending([])).toHaveLength(0);
    });
  });

  describe('transformEntry', () => {
    it('converts telegram entry to bf_entry format', () => {
      const result = transformEntry(SAMPLE_ENTRIES[0]!) as TransformedEntry;
      expect(result.source).toBe("import");
      expect(result.rawText).toBe("Remind me to call Sarah");
      expect(result.routedTo).toBe("telegram-companion");
      expect(result.durationMs).toBe(5000); // 5 sec → 5000 ms
      expect(result.metadata).toEqual({
        telegramFrom: "Heqing",
        telegramChatId: 12345,
        telegramEntryId: "tg-1",
      });
    });

    it('handles null duration', () => {
      const result = transformEntry(SAMPLE_ENTRIES[2]!) as TransformedEntry;
      expect(result.durationMs).toBeNull();
    });

    it('preserves polished text if present', () => {
      const withPolish = { ...SAMPLE_ENTRIES[0]!, polished: "Remind me to call Sarah." };
      const result = transformEntry(withPolish) as TransformedEntry;
      expect(result.polished).toBe("Remind me to call Sarah.");
    });

    it('sets polished to null when not present', () => {
      const result = transformEntry(SAMPLE_ENTRIES[0]!) as TransformedEntry;
      expect(result.polished).toBeNull();
    });

    it('always sets source to "import"', () => {
      for (const entry of SAMPLE_ENTRIES) {
        expect((transformEntry(entry) as TransformedEntry).source).toBe("import");
      }
    });

    it('always routes to telegram-companion', () => {
      for (const entry of SAMPLE_ENTRIES) {
        expect((transformEntry(entry) as TransformedEntry).routedTo).toBe("telegram-companion");
      }
    });
  });

  describe('metadata', () => {
    it('includes telegram-specific fields', () => {
      const result = transformEntry(SAMPLE_ENTRIES[0]!) as TransformedEntry;
      expect(result.metadata).toHaveProperty("telegramFrom");
      expect(result.metadata).toHaveProperty("telegramChatId");
      expect(result.metadata).toHaveProperty("telegramEntryId");
    });

    it('does not leak other fields into metadata', () => {
      const result = transformEntry(SAMPLE_ENTRIES[0]!) as TransformedEntry;
      expect(Object.keys(result.metadata)).toHaveLength(3);
    });
  });
});
