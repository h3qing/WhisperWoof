# Test Truthfulness Refactor — Follow-up Tracker

**Status:** 17 of ~35 files shipped across four sessions on `2026-04-11`.
18 remaining, tracked below. **Bucket B is complete and the first
Bucket C batch (webhooks + analytics + focus-mode + entry-tags) is done.**
Every remaining file still needs Pattern 2 or Bucket D work.

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

Most feature logic lives inside CommonJS modules that don't load cleanly
in a vitest Node runtime:

1. `src/helpers/ipcHandlers.js` (~5800 lines) — feature logic is
   inlined inside IPC handlers that also mutate electron state.
2. `src/whisperwoof/bridge/*.js` — many CJS modules call
   `app.getPath("userData")` at top-level to compute a JSON file path.
   Vitest's `vi.mock("electron", …)` can hoist a stub into the ESM
   graph, but it does **not** reliably intercept the CJS `require("electron")`
   chain invoked from a .js module imported by a .ts test. The module
   crashes at load with `Cannot read properties of undefined (reading 'getPath')`
   before any test runs.

Also: `better-sqlite3` is compiled against Electron's Node, not system
Node, so the vitest Node runtime can't `require('better-sqlite3')` at all
— ruling out real-DB integration tests.

## Two patterns that work

### Pattern 1 — "Direct import" (when the bridge module is load-safe)

If the `bridge/<feature>.js` only requires `debugLogger` (or other
side-effect-free deps), the test can import it directly:

```ts
vi.mock("../../../helpers/debugLogger", () => ({ log: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
// @ts-expect-error — CommonJS module, no TS declarations
import { detectX, someConstant } from "../../bridge/feature";
```

Used for: `context-detector`, `backtrack`, `llm-providers`,
`voice-commands`, `smart-reply`, `language-detect`.

### Pattern 2 — "Extract a `*-pure.js` sibling" (when the bridge crashes at load)

When `<feature>.js` calls `app.getPath("userData")` at top-level or
otherwise triggers side effects at require-time, create a sibling
`<feature>-pure.js` with no electron / fs / app / debugLogger requires:

1. Move all pure logic into `<feature>-pure.js` (plain CommonJS). Export
   everything the tests and production both need.
2. Update `<feature>.js` to `require('./<feature>-pure')` and delegate
   through. Production behavior unchanged.
3. Rewrite `<feature>.test.ts` to
   `import … from '../../bridge/<feature>-pure'` (with a
   `@ts-expect-error` for the missing .d.ts).
4. Delete the inline reimplementation from the test file.

Used for: `snippet-hotkeys`, `snippets`, `style-learner`, `privacy-lock`.

The pure file has no electron / fs / app / debugLogger requires, so
tests load it instantly in the vitest Node runtime without mocks.

## Shipped (17 files across batches 1 + 2 + 3 + 4)

| Test file | Approach | Source changes |
| --- | --- | --- |
| `bridge/snippet-hotkeys.test.ts` | Pattern 2 — extracted `mapSnippetRow` | New `bridge/snippet-hotkeys-pure.js` |
| `core/context/context-detector.test.ts` | Pattern 1 — direct import | None |
| `core/snippets/snippets.test.ts` | Pattern 2 — extracted `matchSnippet` + `simpleEditDistance` | New `bridge/snippets-pure.js` |
| `core/polish/style-learner.test.ts` | Pattern 2 — extracted `editDistance`, `shouldRecordStyleExample`, `buildPromptFromExamples` | New `bridge/style-learner-pure.js` |
| `core/privacy/privacy-lock.test.ts` | Pattern 2 — extracted `isUrlAllowedWhenLocked`, `isProviderAllowedWhenLocked`, `PRIVACY_OVERRIDES`, `DEFAULT_ALLOWED_LOCAL` | New `bridge/privacy-lock-pure.js` |
| `core/polish/backtrack.test.ts` | Pattern 1 — direct import | None |
| `core/language/language-detect.test.ts` | Pattern 1 — direct import. **Real bug caught**: source regex missing `/g`, fixed | `bridge/language-detect.js` SCRIPT_PATTERNS now `/g` |
| `core/polish/llm-providers.test.ts` | Pattern 1 — direct import. Extracted `validateConfig` as pure helper | `bridge/llm-providers.js` — `validateConfig()` exported, `polishWithProvider` delegates to it |
| `core/commands/voice-commands.test.ts` | Pattern 1 — direct import | None |
| `core/reply/smart-reply.test.ts` | Pattern 1 — direct import | None |
| `core/coding/vibe-coding.test.ts` | Pattern 1 — direct import | None |
| `core/capture/recurring-capture.test.ts` | Pattern 2 — extracted `isValidTime`, `parseTime`, `getIsoDay`, `shouldFire`, `getPresets` | New `bridge/recurring-capture-pure.js` |
| `core/settings/settings-export.test.ts` | Pattern 2 — extracted `stripApiKeys`, `validateBundle`, `mergeArrays`. **Critical bug caught** — see below | New `bridge/settings-export-pure.js` |
| `core/webhooks/webhooks.test.ts` | Pattern 2 — extracted `buildPayload`, `signPayload` (HMAC-SHA256), `matchesFilters`, `validateWebhookUrl`. Added explicit SSRF guards (`file://`, `data:`, `ftp://`) and a hand-computed HMAC baseline | New `bridge/webhooks-pure.js` |
| `core/analytics/analytics.test.ts` | Pattern 2 — extracted `computePolishStats`, `computeStreaks`, `fillHourGaps`, `extractCommandName`, `extractSnippetTrigger`, `getEmptyDashboard`. Production SQL fetches rows, pure module does the math | New `bridge/analytics-pure.js` |
| `core/focus/focus-mode.test.ts` | Pattern 2 — extracted `SPRINT_PRESETS`, `validateDuration`, `createSessionObject`, `appendEntryToSession`, `markSessionEnded`, `computeFocusStats`, `computeActiveSessionView`. Pure functions take explicit `now` for deterministic tests | New `bridge/focus-mode-pure.js` |
| `core/tags/entry-tags.test.ts` | Pattern 2 (minimal) — extracted `validateTagName`, `DEFAULT_TAG_COLOR`, `MAX_TAG_NAME_LENGTH`. Dropped in-memory-mock tests for the SQL-only CRUD paths since they can't be unified without loading better-sqlite3 | New `bridge/entry-tags-pure.js` |

## Regressions caught by the refactor

- **language-detect.js** (batch 2): SCRIPT_PATTERNS were declared
  without `/g`, so `String.match(pattern).length` was always 1 and the
  `ratio > 0.15` gate never triggered. Production `detectLanguage`
  silently returned English for every non-Latin-script string. The
  old test hid this because its inline reimplementation used
  `new RegExp(pattern.source, "g")` instead of the raw pattern. Fixed
  + added an inline NOTE comment so future reviewers don't strip the
  flag.

- **settings-export.js** (batch 3, critical, security-relevant):
  The inline `stripApiKeys` used `String.includes("apiKey")`
  (lowercase `a`) as its marker. The app stores real API keys as
  `openaiApiKey`, `anthropicApiKey`, `groqApiKey`, `geminiApiKey`,
  `mistralApiKey`, `customTranscriptionApiKey`, `customReasoningApiKey`
  in `src/stores/settingsStore.ts` — every one of them has a capital
  `A` after the provider name. `"openaiApiKey".includes("apiKey")`
  returns **false**. The filter caught **none** of the real API keys
  the app writes, meaning every settings export would have leaked
  every plaintext API key to disk. The old test hid this by using a
  fictitious kebab-case naming convention
  (`"whisperwoof-openai-api-key"`) that the app never actually uses.
  Fixed: the pure module now lowercases keys before matching and uses
  an expanded marker list (`apikey`, `api-key`, `api_key`, `token`,
  `secret`, `bearer`). Test pins against the exact key names from
  `settingsStore.ts` so any rename there will trip the test until the
  marker list is updated.

## Remaining work — 18 files

Grouped by effort. Each row needs the same pattern: find (or extract)
the real source, wire the test to import it, drop the inline copy.
**Bucket B is complete** — all direct-import opportunities have been
exhausted. Every remaining file needs Pattern 2 or Bucket D work.

### Bucket C: Pattern 2 (bridge source crashes at load, extract pure sibling)

Grep result from the audit shows these bridge files DO exist. Most
likely call `app.getPath` at top-level so Pattern 2 is needed:

- `bridge/agentic-actions.js` ← `core/actions/agentic-actions.test.ts`
- `bridge/app-automation.js` ← `core/automation/app-automation.test.ts`
- `bridge/auto-tagger.js` ← `core/tags/auto-tagger.test.ts`
- `bridge/conversation-memory.js` ← `core/memory/conversation-memory.test.ts`
- `bridge/daily-digest.js` ← `core/digest/daily-digest.test.ts`
- `bridge/entry-chains.js` ← `core/chains/entry-chains.test.ts`
- `bridge/entry-templates.js` ← `core/templates/entry-templates.test.ts`
- `bridge/intent-capture.js` ← `core/intent/intent-capture.test.ts`
- `bridge/keybindings.js` ← `core/keybindings/keybindings.test.ts`
- `bridge/screen-context.js` ← `core/context/screen-context.test.ts`
- `bridge/semantic-search.js` ← `core/search/semantic-search.test.ts`
- `bridge/streaming-manager.js` ← `core/streaming/streaming-manager.test.ts`
- `bridge/vocabulary.js` ← `core/vocabulary/vocabulary.test.ts`

Effort: M each. Tackle 3–5 per session to avoid sprawl.

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

Next Bucket C batch — start with feature modules that have the most
pure transformations to extract: `auto-tagger` (keyword rules + tag
scoring), `semantic-search` (TF-IDF math), `screen-context` (command
prefix parsing). Then `conversation-memory` (query patterns) and
`intent-capture` (signal categories) if time permits. Leave
`conversation-memory` + `daily-digest` for last — they're the
heaviest / most LLM-prompt-tangled.
