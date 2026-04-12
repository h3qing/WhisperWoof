/**
 * WhisperWoof Storage Types
 *
 * Shared across the main-process runtime (src/whisperwoof/bridge/app-init.js
 * talks to better-sqlite3 directly) and the renderer (consumes rows over IPC).
 */

export type EntrySource = 'voice' | 'clipboard' | 'meeting' | 'import';

export interface Entry {
  readonly id: string;
  readonly createdAt: string; // ISO 8601
  readonly source: EntrySource;
  readonly rawText: string | null;
  readonly polished: string | null;
  readonly routedTo: string | null;
  readonly hotkeyUsed: string | null;
  readonly durationMs: number | null;
  readonly projectId: string | null;
  readonly audioPath: string | null;
  readonly metadata: Record<string, unknown>;
  readonly favorite: number; // 0 = not favorite, 1 = favorite
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string; // ISO 8601
  readonly integrationTarget: string | null; // Phase 2: MCP plugin ID
  readonly metadata: Record<string, unknown>;
}

export interface SearchFilters {
  readonly source?: EntrySource;
  readonly projectId?: string;
  readonly dateFrom?: string; // ISO 8601
  readonly dateTo?: string; // ISO 8601
  readonly limit?: number;
  readonly offset?: number;
}

export interface ImportResult {
  readonly imported: number;
  readonly failed: number;
  readonly errors: readonly string[];
}

// --- Smart Clipboard ---

export type SnippetSource = 'human' | 'ai' | 'voice';

export interface Snippet {
  readonly id: string;
  readonly content: string;
  readonly title: string;
  readonly boardId: string;
  readonly position: number;
  readonly source: SnippetSource;
  readonly useCount: number;
  readonly lastUsedAt: string | null;
  readonly hotkey: string | null; // e.g. "1" for Cmd+Shift+1
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SnippetBoard {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly color: string; // hex color for board header
  readonly createdAt: string;
}
