# Snippets (removed — captured for a future rebuild)

The snippet subsystem was removed in v1.15.0 because its primary surface (a Kanban
board on the "Clipboard" tab) was replaced by a clipboard-activity timeline, which
orphaned the UI. Rather than leave a large half-wired feature in the tree, the whole
thing was cut. This doc preserves the ideas so it can be rebuilt cleanly later.

## What it did

Snippets were reusable text blocks ("templates") with a trigger phrase, reachable three ways:

1. **Voice expansion** — dictating a trigger phrase auto-expanded it to the snippet body,
   short-circuiting polish + voice-commands. Matching precedence (see the old
   `snippets-pure.js#matchSnippet`):
   - exact (`input === trigger`)
   - longest-prefix (`input.startsWith(trigger)`, longest trigger wins)
   - fuzzy (Levenshtein ≤ 1, only for triggers ≥ 5 chars)
   Gated by `localStorage["whisperwoof-snippets"] !== "false"`, wired in
   `useAudioRecording.js` before the polish step. On match it saved an entry with
   `routedTo: "snippet:<trigger>"` and `metadata.snippet`.

2. **Quick-paste hotkeys** — `Cmd+Shift+1-9` pasted the snippet bound to that slot.
   Registered in `main.js` via `snippet-hotkeys.js` (`registerSnippetHotkeys` /
   `unregisterSnippetHotkeys`); `snippet-hotkeys-pure.js#mapSnippetRow` mapped the
   `bf_snippets` row → camelCase.

3. **Kanban board UI** — `SmartClipboard.tsx`: multiple boards (columns), drag-and-drop
   reorder, per-snippet source badge (human / ai / voice), usage-frequency badge, inline
   add/edit/delete, hotkey indicator, and AI-suggested snippets (`whisperwoofSuggestSnippets`,
   surfaced from frequently-seen clipboard/voice text).

## Data model

- `bf_snippets` — id, content, title, board_id, position, source (`human|ai|voice`),
  hotkey, use_count, last_used_at, created_at, updated_at.
- `bf_snippet_boards` — id, name, position, color.
- Types lived in `core/storage/types.ts` (`Snippet`, `SnippetBoard`, `SnippetSource`) and
  the `StorageProvider` interface declared the CRUD (`saveSnippet`, `getSnippetsByBoard`,
  `recordSnippetUse`, board CRUD, etc.).

## Cross-cutting hooks (all removed with it)

- **Analytics** (`analytics.js#getTopSnippets`): counted usage via
  `routed_to LIKE 'snippet:%'`, surfaced as `topSnippets` in the analytics summary.
- **Settings export** (`settings-export.js`): exported/imported `whisperwoof-snippets.json`
  and counted snippets in the summary.
- **Latency tracker**: a "short-circuited via snippet" note in the skip reasons.

## If rebuilding

- Keep the **pure matcher** (`matchSnippet`) and **hotkey row mapper** — they were
  side-effect-free and well-tested; lift them from git history (`snippets-pure.js`,
  `snippet-hotkeys-pure.js`, and their `.test.ts`).
- Decide the **home** for the UI up front. The Kanban-on-Clipboard-tab placement was the
  root problem — it competed with clipboard *history*. A dedicated "Snippets" tab (or a
  section under Memory) keeps both concepts clear.
- Voice expansion is the highest-value piece and the cheapest to re-add: it's one matcher
  call in `useAudioRecording` before polish. Quick-paste hotkeys and the board are additive.
- Reuse `routed_to: "snippet:<trigger>"` as the analytics convention if you want usage stats.

Removed in: v1.15.0 (commit on `feat/local-polish-tuning-and-legacy-cleanup`).
