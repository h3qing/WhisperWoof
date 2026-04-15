/**
 * Tests for the pure row-mapping logic shared by snippet-hotkeys.js.
 *
 * The DB-touching parts (`getSnippetByHotkey`, `recordUse`, electron
 * `globalShortcut` registration) are not covered here — they require a real
 * better-sqlite3 binding that isn't available in the vitest Node runtime.
 * This file tests the actual production `mapSnippetRow` function that those
 * paths delegate to.
 */

import { describe, it, expect } from "vitest";
import { mapSnippetRow } from "./snippet-hotkeys-pure";

interface SnippetRow {
  id: string;
  content: string;
  title: string;
  board_id: string;
  hotkey: string | null;
  use_count: number;
  last_used_at: string | null;
}

interface MappedSnippet {
  id: string;
  content: string;
  title: string;
  boardId: string;
  hotkey: string | null;
  useCount: number;
}

function makeRow(overrides: Partial<SnippetRow> = {}): SnippetRow {
  return {
    id: "s1",
    content: "Thanks for your email!",
    title: "Thank you",
    board_id: "b1",
    hotkey: "1",
    use_count: 5,
    last_used_at: null,
    ...overrides,
  };
}

describe("mapSnippetRow", () => {
  it("converts snake_case row to camelCase snippet", () => {
    const row = makeRow();
    const snippet = mapSnippetRow(row);
    expect(snippet).toEqual({
      id: "s1",
      content: "Thanks for your email!",
      title: "Thank you",
      boardId: "b1",
      hotkey: "1",
      useCount: 5,
    });
  });

  it("defaults useCount to 0 when use_count is nullish", () => {
    const row = makeRow({ use_count: null as unknown as number });
    expect((mapSnippetRow(row) as MappedSnippet).useCount).toBe(0);
  });

  it("preserves null hotkey", () => {
    const row = makeRow({ hotkey: null });
    expect((mapSnippetRow(row) as MappedSnippet).hotkey).toBeNull();
  });

  it("returns a frozen object so callers can't mutate the mapped snippet", () => {
    const snippet = mapSnippetRow(makeRow());
    expect(Object.isFrozen(snippet)).toBe(true);
  });
});
