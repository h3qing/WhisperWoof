# Test Truthfulness Refactor — Follow-up Tracker

**Status:** 5 of ~35 files shipped in session `2026-04-11`. Remaining work captured here.

## Problem statement

A 2026-04 engineering review found that ~35 of 43 test files under
`src/whisperwoof/**/*.test.*` define their own copies of the production
logic inside the test file and then exercise the copies. Those tests
could never catch a regression in the real runtime code. Only ~10 files
(clipboard-monitor, pipeline, plugin-manager, permissions,
project-dispatch, hotkey-router, ollama-service, meeting/audio-buffer,
meeting/session-manager, meeting/transcript-checkpoint) import the real
module under test.

## Why this is the shape of the codebase

Most feature logic lives inside two CommonJS files that are hard to
import from a vitest .test.ts:

1. `src/helpers/ipcHandlers.js` (~5800 lines) — feature logic is
   inlined inside IPC handlers that also mutate electron state.
2. `src/whisperwoof/bridge/*.js` — CommonJS modules that call
   `app.getPath("userData")` at top-level to compute a JSON file path.
   Vitest's `vi.mock("electron", …)` can hoist a stub into the ESM
   graph, but it does **not** reliably intercept the CJS `require("electron")`
   chain invoked from a .js module imported by a .ts test. The module
   crashes at load with `Cannot read properties of undefined (reading 'getPath')`
   before any test runs.

Also: `better-sqlite3` is compiled against Electron's Node, not system
Node, so the vitest Node runtime can't `require('better-sqlite3')` at all
— ruling out real-DB integration tests.

## The pattern that works — "extract a `*-pure.js` sibling"

Applied to all 5 files shipped this round. For each feature file
`src/whisperwoof/bridge/<feature>.js`:

1. Create a new sibling `<feature>-pure.js` (plain CommonJS). Move all
   pure logic into it — no `fs`, no `electron`, no `better-sqlite3`, no
   side effects. Export everything the tests need.
2. Update `<feature>.js` to `require('./<feature>-pure')` and delegate
   through. Production behavior unchanged.
3. Rewrite `<feature>.test.ts` to
   `import … from '../../bridge/<feature>-pure'` (with a
   `@ts-expect-error` for the missing .d.ts). The test no longer needs
   to mock electron or debugLogger because the pure module touches
   nothing external.
4. Delete the inline reimplementation from the test file.

Naming is consistent: `<feature>-pure.js`. The pure file has no
electron / fs / app / debugLogger requires, so tests load it
instantly in the vitest Node runtime without mocks.

Alternate pattern (when the source is already in a safe module): just
fix the test import. Used once this round for `context-detector` —
`bridge/context-detector.js` only requires `child_process` and
`debugLogger`, neither of which crash at module load.

## Shipped this round (5 files)

| Test file | Approach | Source changes |
| --- | --- | --- |
| `bridge/snippet-hotkeys.test.ts` | Extracted `mapSnippetRow` | New `bridge/snippet-hotkeys-pure.js` |
| `core/context/context-detector.test.ts` | Direct import from existing bridge module | None |
| `core/snippets/snippets.test.ts` | Extracted `matchSnippet` + `simpleEditDistance` | New `bridge/snippets-pure.js` |
| `core/polish/style-learner.test.ts` | Extracted `editDistance`, `shouldRecordStyleExample`, `buildPromptFromExamples` | New `bridge/style-learner-pure.js` |
| `core/privacy/privacy-lock.test.ts` | Extracted `isUrlAllowedWhenLocked`, `isProviderAllowedWhenLocked`, `PRIVACY_OVERRIDES`, `DEFAULT_ALLOWED_LOCAL` | New `bridge/privacy-lock-pure.js` |

## Remaining work — ~30 files

Grouped by effort. Each row needs the same pattern: find (or extract)
the real source, wire the test to import it, drop the inline copy.

### Bucket B: pure logic lives in a bridge `.js` file already

Look for an existing `src/whisperwoof/bridge/<feature>.js` or helper.
If it loads cleanly (no top-level `app.getPath`), the test can import
it directly. Otherwise, extract a `-pure.js` sibling.

- `bridge/backtrack.js` ← `core/polish/backtrack.test.ts`
- `bridge/llm-providers.js` ← `core/polish/llm-providers.test.ts`
- `bridge/language-detect.js` (or similar) ← `core/language/language-detect.test.ts`
- `bridge/smart-reply.js` ← `core/reply/smart-reply.test.ts`
- `bridge/voice-commands.js` ← `core/commands/voice-commands.test.ts`
- `bridge/vibe-coding.js` ← `core/coding/vibe-coding.test.ts`
- `bridge/recurring-capture.js` ← `core/capture/recurring-capture.test.ts`
- `bridge/settings-export.js` ← `core/settings/settings-export.test.ts`

Effort: S each, ~15 files total in bucket B.

### Bucket C: logic lives inside `src/helpers/ipcHandlers.js`

These are the hardest — the "module" is really just a block of code
inside `ipcHandlers.js`. Fix requires extracting a clean TS/JS module
first, then updating the IPC handler to call it, then pointing the
test at it.

- `core/actions/agentic-actions.test.ts`
- `core/analytics/analytics.test.ts`
- `core/automation/app-automation.test.ts`
- `core/chains/entry-chains.test.ts`
- `core/digest/daily-digest.test.ts`
- `core/focus/focus-mode.test.ts`
- `core/intent/intent-capture.test.ts`
- `core/keybindings/keybindings.test.ts`
- `core/memory/conversation-memory.test.ts`
- `core/screen-context.test.ts`
- `core/search/semantic-search.test.ts`
- `core/streaming/streaming-manager.test.ts`
- `core/tags/auto-tagger.test.ts`
- `core/tags/entry-tags.test.ts`
- `core/templates/entry-templates.test.ts`
- `core/vocabulary/vocabulary.test.ts`
- `core/webhooks/webhooks.test.ts`

Effort: M each. Tackle 3–5 per session to avoid ipcHandlers.js sprawl.

### Bucket D: mock-only or borderline

- `core/storage/smart-clipboard.test.ts` — reimplements an in-memory
  SQLite mock. Real path: extract Smart Clipboard CRUD from
  `app-init.js` / `ipcHandlers.js` into a pure query-builder that
  takes a `db.prepare` function as a dep.
- `core/audio/vad.test.ts` — pure math helpers; legit test-only
  reimplementation today. Low priority.
- `core/telegram/telegram-sync.test.ts` — biggest file; probably L
  effort. Defer until last.

## Recommended next session

Pick 3 files from Bucket B (the `bridge/*.js` ones) in one commit —
fastest ROI per fix. Then 2 from Bucket C together so the
`ipcHandlers.js` extraction has a consistent approach across features.
