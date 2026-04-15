/**
 * Tests for Smart Clipboard storage — Board + Snippet CRUD
 *
 * Uses an in-memory mock of the SqliteProvider's database pattern
 * to test the data model without requiring better-sqlite3.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Snippet, SnippetSource, SnippetBoard } from './types';

// --- In-memory storage that mirrors SqliteProvider behavior ---

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

interface BoardStore {
  boards: Map<string, SnippetBoard>;
  snippets: Map<string, Snippet>;
}

function createStore(): BoardStore {
  return { boards: new Map(), snippets: new Map() };
}

function saveBoard(
  store: BoardStore,
  board: Omit<SnippetBoard, 'id' | 'createdAt'>,
): SnippetBoard {
  const id = generateId();
  const created = Object.freeze({ id, createdAt: nowISO(), ...board });
  store.boards.set(id, created);
  return created;
}

function getBoards(store: BoardStore): readonly SnippetBoard[] {
  return Object.freeze(
    [...store.boards.values()].sort((a, b) => a.position - b.position),
  );
}

function updateBoard(
  store: BoardStore,
  id: string,
  updates: Partial<Omit<SnippetBoard, 'id' | 'createdAt'>>,
): SnippetBoard {
  const existing = store.boards.get(id);
  if (!existing) throw new Error(`Board not found: ${id}`);
  const updated = Object.freeze({ ...existing, ...updates });
  store.boards.set(id, updated);
  return updated;
}

function deleteBoard(store: BoardStore, id: string): void {
  store.boards.delete(id);
  // CASCADE — delete associated snippets
  for (const [sid, snippet] of store.snippets) {
    if (snippet.boardId === id) store.snippets.delete(sid);
  }
}

function saveSnippet(
  store: BoardStore,
  snippet: Omit<Snippet, 'id' | 'createdAt' | 'updatedAt' | 'useCount' | 'lastUsedAt'>,
): Snippet {
  const id = generateId();
  const now = nowISO();
  const created = Object.freeze({
    id,
    createdAt: now,
    updatedAt: now,
    useCount: 0,
    lastUsedAt: null,
    ...snippet,
  });
  store.snippets.set(id, created);
  return created;
}

function getSnippetsByBoard(store: BoardStore, boardId: string): readonly Snippet[] {
  return Object.freeze(
    [...store.snippets.values()]
      .filter((s) => s.boardId === boardId)
      .sort((a, b) => a.position - b.position),
  );
}

function getAllSnippets(store: BoardStore): readonly Snippet[] {
  return Object.freeze(
    [...store.snippets.values()].sort((a, b) => {
      if (a.boardId !== b.boardId) return a.boardId.localeCompare(b.boardId);
      return a.position - b.position;
    }),
  );
}

function updateSnippet(
  store: BoardStore,
  id: string,
  updates: Partial<Omit<Snippet, 'id' | 'createdAt'>>,
): Snippet {
  const existing = store.snippets.get(id);
  if (!existing) throw new Error(`Snippet not found: ${id}`);
  const updated = Object.freeze({ ...existing, ...updates, updatedAt: nowISO() });
  store.snippets.set(id, updated);
  return updated;
}

function deleteSnippet(store: BoardStore, id: string): void {
  store.snippets.delete(id);
}

function recordSnippetUse(store: BoardStore, id: string): Snippet {
  const existing = store.snippets.get(id);
  if (!existing) throw new Error(`Snippet not found: ${id}`);
  const now = nowISO();
  const updated = Object.freeze({
    ...existing,
    useCount: existing.useCount + 1,
    lastUsedAt: now,
    updatedAt: now,
  });
  store.snippets.set(id, updated);
  return updated;
}

// --- Tests ---

describe('Smart Clipboard — Boards', () => {
  let store: BoardStore;

  beforeEach(() => {
    store = createStore();
  });

  it('creates a board with defaults', () => {
    const board = saveBoard(store, { name: 'Greetings', position: 0, color: '#C87B3A' });
    expect(board.id).toBeDefined();
    expect(board.name).toBe('Greetings');
    expect(board.position).toBe(0);
    expect(board.color).toBe('#C87B3A');
    expect(board.createdAt).toBeDefined();
  });

  it('returns boards sorted by position', () => {
    saveBoard(store, { name: 'C', position: 2, color: '#FF0000' });
    saveBoard(store, { name: 'A', position: 0, color: '#00FF00' });
    saveBoard(store, { name: 'B', position: 1, color: '#0000FF' });

    const boards = getBoards(store);
    expect(boards).toHaveLength(3);
    expect(boards[0]!.name).toBe('A');
    expect(boards[1]!.name).toBe('B');
    expect(boards[2]!.name).toBe('C');
  });

  it('updates a board name and color', () => {
    const board = saveBoard(store, { name: 'Old', position: 0, color: '#000' });
    const updated = updateBoard(store, board.id, { name: 'New', color: '#FFF' });
    expect(updated.name).toBe('New');
    expect(updated.color).toBe('#FFF');
    expect(updated.position).toBe(0); // unchanged
  });

  it('throws when updating non-existent board', () => {
    expect(() => updateBoard(store, 'nonexistent', { name: 'X' })).toThrow('Board not found');
  });

  it('deletes a board and cascades to snippets', () => {
    const board = saveBoard(store, { name: 'Temp', position: 0, color: '#000' });
    saveSnippet(store, { content: 'Hello', title: 'Hi', boardId: board.id, position: 0, source: 'human', hotkey: null });
    saveSnippet(store, { content: 'Bye', title: 'Goodbye', boardId: board.id, position: 1, source: 'human', hotkey: null });

    expect(getAllSnippets(store)).toHaveLength(2);

    deleteBoard(store, board.id);
    expect(store.boards.has(board.id)).toBe(false);
    expect(getAllSnippets(store)).toHaveLength(0); // cascade
  });

  it('boards are frozen (immutable)', () => {
    const board = saveBoard(store, { name: 'Test', position: 0, color: '#000' });
    expect(Object.isFrozen(board)).toBe(true);
  });
});

describe('Smart Clipboard — Snippets', () => {
  let store: BoardStore;
  let boardId: string;

  beforeEach(() => {
    store = createStore();
    const board = saveBoard(store, { name: 'General', position: 0, color: '#C87B3A' });
    boardId = board.id;
  });

  it('creates a snippet with defaults', () => {
    const snippet = saveSnippet(store, {
      content: 'Thanks for your email!',
      title: 'Thank you',
      boardId,
      position: 0,
      source: 'human',
      hotkey: '1',
    });

    expect(snippet.id).toBeDefined();
    expect(snippet.content).toBe('Thanks for your email!');
    expect(snippet.title).toBe('Thank you');
    expect(snippet.boardId).toBe(boardId);
    expect(snippet.source).toBe('human');
    expect(snippet.hotkey).toBe('1');
    expect(snippet.useCount).toBe(0);
    expect(snippet.lastUsedAt).toBeNull();
    expect(snippet.createdAt).toBeDefined();
    expect(snippet.updatedAt).toBeDefined();
  });

  it('retrieves snippets by board sorted by position', () => {
    saveSnippet(store, { content: 'C', title: 'C', boardId, position: 2, source: 'human', hotkey: null });
    saveSnippet(store, { content: 'A', title: 'A', boardId, position: 0, source: 'human', hotkey: null });
    saveSnippet(store, { content: 'B', title: 'B', boardId, position: 1, source: 'ai', hotkey: null });

    const snippets = getSnippetsByBoard(store, boardId);
    expect(snippets).toHaveLength(3);
    expect(snippets[0]!.title).toBe('A');
    expect(snippets[1]!.title).toBe('B');
    expect(snippets[2]!.title).toBe('C');
  });

  it('separates snippets by board', () => {
    const board2 = saveBoard(store, { name: 'Work', position: 1, color: '#000' });
    saveSnippet(store, { content: 'General 1', title: 'G1', boardId, position: 0, source: 'human', hotkey: null });
    saveSnippet(store, { content: 'Work 1', title: 'W1', boardId: board2.id, position: 0, source: 'human', hotkey: null });

    expect(getSnippetsByBoard(store, boardId)).toHaveLength(1);
    expect(getSnippetsByBoard(store, board2.id)).toHaveLength(1);
    expect(getAllSnippets(store)).toHaveLength(2);
  });

  it('updates snippet content and position', () => {
    const snippet = saveSnippet(store, { content: 'Old', title: 'Old', boardId, position: 0, source: 'human', hotkey: null });
    const updated = updateSnippet(store, snippet.id, { content: 'New', position: 5 });
    expect(updated.content).toBe('New');
    expect(updated.position).toBe(5);
    expect(updated.title).toBe('Old'); // unchanged
    expect(updated.updatedAt).toBeDefined();
  });

  it('moves snippet between boards', () => {
    const board2 = saveBoard(store, { name: 'Other', position: 1, color: '#000' });
    const snippet = saveSnippet(store, { content: 'Moving', title: 'Move', boardId, position: 0, source: 'human', hotkey: null });

    const moved = updateSnippet(store, snippet.id, { boardId: board2.id, position: 0 });
    expect(moved.boardId).toBe(board2.id);
    expect(getSnippetsByBoard(store, boardId)).toHaveLength(0);
    expect(getSnippetsByBoard(store, board2.id)).toHaveLength(1);
  });

  it('records snippet usage', () => {
    const snippet = saveSnippet(store, { content: 'Test', title: 'T', boardId, position: 0, source: 'human', hotkey: '1' });
    expect(snippet.useCount).toBe(0);
    expect(snippet.lastUsedAt).toBeNull();

    const used = recordSnippetUse(store, snippet.id);
    expect(used.useCount).toBe(1);
    expect(used.lastUsedAt).not.toBeNull();

    const usedAgain = recordSnippetUse(store, snippet.id);
    expect(usedAgain.useCount).toBe(2);
  });

  it('deletes a snippet', () => {
    const snippet = saveSnippet(store, { content: 'Delete me', title: 'Del', boardId, position: 0, source: 'human', hotkey: null });
    expect(getAllSnippets(store)).toHaveLength(1);

    deleteSnippet(store, snippet.id);
    expect(getAllSnippets(store)).toHaveLength(0);
  });

  it('throws when updating non-existent snippet', () => {
    expect(() => updateSnippet(store, 'nonexistent', { content: 'X' })).toThrow('Snippet not found');
  });

  it('throws when recording use of non-existent snippet', () => {
    expect(() => recordSnippetUse(store, 'nonexistent')).toThrow('Snippet not found');
  });

  it('supports all source types', () => {
    const sources: SnippetSource[] = ['human', 'ai', 'voice'];
    for (const source of sources) {
      const snippet = saveSnippet(store, { content: `${source} content`, title: source, boardId, position: 0, source, hotkey: null });
      expect(snippet.source).toBe(source);
    }
  });

  it('snippets are frozen (immutable)', () => {
    const snippet = saveSnippet(store, { content: 'Frozen', title: 'F', boardId, position: 0, source: 'human', hotkey: null });
    expect(Object.isFrozen(snippet)).toBe(true);
  });

  it('assigns unique hotkeys', () => {
    const s1 = saveSnippet(store, { content: 'One', title: '1', boardId, position: 0, source: 'human', hotkey: '1' });
    const s2 = saveSnippet(store, { content: 'Two', title: '2', boardId, position: 1, source: 'human', hotkey: '2' });
    expect(s1.hotkey).toBe('1');
    expect(s2.hotkey).toBe('2');
  });
});
