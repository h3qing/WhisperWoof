# Progress Log

## 2026-04-11 — Session: Bucket B complete + STT config fix + security bug

Continued the eng-review cleanup while waiting on the Apple Developer
cert. Two parallel threads: finish Bucket B of the test-truthfulness
refactor, and chase the STT config error that had been nagging at boot.

### Thread 1 — Bucket B test truthfulness (3 more files, batch 3)

- `core/coding/vibe-coding.test.ts` → direct import of `hasCodeIntent`,
  `getCodingPrompt`, `isCodeModeApp`, `isShellModeApp`,
  `CODE_MODE_APPS`, `SHELL_MODE_APPS`, `CODE_PROMPT`, `SHELL_PROMPT`
  from `bridge/vibe-coding.js`. Source is load-safe, no extraction
  needed.

- `core/capture/recurring-capture.test.ts` → extracted `isValidTime`,
  `parseTime`, `getIsoDay`, `shouldFire`, `getPresets` into a new
  `bridge/recurring-capture-pure.js`. `recurring-capture.js` delegates;
  the test imports the pure module directly, bypassing the top-level
  `app.getPath` call that would have crashed the test at load.

- `core/settings/settings-export.test.ts` → extracted `stripApiKeys`,
  `validateBundle`, `mergeArrays` into a new
  `bridge/settings-export-pure.js`. Previously these helpers were
  inlined inside `exportSettings` / `importSettings`, and the test
  kept parallel copies that silently drifted from production.

**Bucket B is now complete.** Every remaining test-truthfulness file
(22 of them) needs Pattern 2 extraction or a fresh module.

### Critical security bug caught by the refactor

The old `stripApiKeys` used `String.includes("apiKey")` (lowercase
`a`) as its secret marker. The app stores real API keys as
`openaiApiKey`, `anthropicApiKey`, `groqApiKey`, `geminiApiKey`,
`mistralApiKey`, `customTranscriptionApiKey`, `customReasoningApiKey`
in `src/stores/settingsStore.ts` — every one has a capital `A` after
the provider name. `"openaiApiKey".includes("apiKey")` returns
**false**, so the filter caught **none** of the real keys. Any user
who exported their settings got a plaintext dump of every API key
they'd configured.

The old test hid this by testing against a fictitious
`"whisperwoof-openai-api-key"` naming convention the app never uses.
The test was green while production shipped broken. **This is the
most serious case of the test-truthfulness pattern yet.**

Fix: the pure module lowercases keys before matching and uses an
expanded marker list (`apikey`, `api-key`, `api_key`, `token`,
`secret`, `bearer`). The new test pins against the exact camelCase
key names from `settingsStore.ts` so any rename will trip the test
until the marker list is updated.

### Thread 2 — STT config error at boot

Two root causes for the `ERROR: STT config fetch error: {}` noise
that's been showing up 3× every startup:

1. `get-stt-config` in `ipcHandlers.js` threw `"No session cookies
   available"` on every boot for any user not signed into OpenWhispr
   cloud — i.e., the entire local-first target audience. Each of the
   three `useAudioRecording` hook instances (dictation / control
   panel / sidebar) called it on mount, producing three identical
   error logs.

2. `debugLogger.error("message:", errorObj)` stringifies its second
   argument but `Error` objects don't JSON-serialize (their
   `message`/`stack` aren't enumerable own properties), so the log
   rendered as `{}` — useless when something real goes wrong.

Fixed both: "not signed in" now returns `{success: false, code:
"NO_SESSION"}` without logging, and real errors log
`error.message` via template literal.

**Note:** the same `debugLogger.error("msg:", error)` pattern appears
in 17 other places across `ipcHandlers.js`. They all silently log
`{}` when things go wrong. Not swept in this session — flagged in
the commit message as a candidate for a follow-up batch.

### Test results
- 43 test files / 758 tests (up from 753 — 5 new camelCase `ApiKey`
  coverage assertions from the security fix; zero regressions)

## 2026-04-11 — Session: Bucket B refactor batch + upstream cherry-picks

Continued the test-truthfulness refactor with Bucket B (files where
bridge source already exists) and interleaved surgical upstream
cherry-picks to catch up on a few weeks of OpenWhispr changes without
tackling the full 182-commit backlog.

### Phase A: Test truthfulness batch 2 — 5 more files wired to real source
1. `backtrack.test.ts` → imports `detectBacktrack`/`hasBacktrack`/`CORRECTION_SIGNALS`
   from `bridge/backtrack.js`. Direct import + debugLogger mock.
2. `language-detect.test.ts` → imports `detectLanguage` and friends from
   `bridge/language-detect.js`. **Surfaced a real regression**: script
   patterns shipped without `/g`, so `matches.length` was always 1 and
   production silently returned English for every non-Latin-script
   string. The old test hid it by using `new RegExp(pattern.source, "g")`
   in its reimplementation — testing a *corrected* version while
   production shipped broken. Fixed the flag, added a NOTE comment so
   future reviewers don't strip it.
3. `llm-providers.test.ts` → extracted `validateConfig(config)` as a pure
   exported helper (`polishWithProvider` now delegates to it), imports
   `PROVIDERS`/`getProviders`/`validateConfig` directly.
4. `voice-commands.test.ts` → imports `detectCommand`/`COMMAND_PATTERNS`/
   `getAvailableCommands` from `bridge/voice-commands.js`. Added a test
   that exercises the `buildPrompt` closure returned by the matcher.
5. `smart-reply.test.ts` → imports `isReplyIntent`/`getReplyMode`/
   `REPLY_SIGNALS`/`REPLY_PROMPTS`/`APP_REPLY_MODE` from
   `bridge/smart-reply.js`.

All 5 files needed only a `debugLogger` mock — no electron / fs / app
in the require chain, so no `-pure.js` sibling extraction needed. The
Bucket B pattern is: `vi.mock("debugLogger") → direct import → done`.

Test-truthfulness total progress: **10 of 35 files refactored** across
both sessions. 25 remaining — tracked in
`docs/test-truthfulness-refactor.md`.

### Phase B: Surgical upstream cherry-picks (5 commits)

Still a fork of `OpenWhispr/openwhispr`. Last shared commit was
`95b092720` on 2026-03-23; upstream advanced 182 commits since. Full
merge deferred to its own session due to heavy overlap on
`ipcHandlers.js`, agent/meeting components, and preload — the hot
files on both sides. Cherry-picked the additive / security-relevant
commits that couldn't conflict:

1. `8fb0db9cd` — Bump brace-expansion to 1.1.13 (security backport)
2. `d54a860f5` — feat: add Gemma 4 E2B and E4B local models
3. `a8e8d641f` — feat: add Gemma 4 31B and 26B MoE to local model registry
4. `131a21f60` — chore(deps): bump @xmldom/xmldom to 0.8.12
5. `ed7a3ad39` — fix: validate JSON.parse result type before .replace() in prompts

All cherry-picks auto-merged cleanly; no manual conflict resolution.

### Test results
- 43 test files / 753 tests (up from 739 — net +14 from refactor
  assertions against real source code)
- All green; `/g` fix also verified by the real-source assertions that
  previously couldn't run

## 2026-04-11 — Session: Engineering Review Cleanup

Verified 5 eng-review findings against current code and worked through them
in order (easy wins → harder refactors).

### Shipped
1. `perf: memoize EntryRow + stabilize onSelect callback` — virtual-scrolled
   history was re-rendering every visible row on every scroll because
   EntryRow was a plain function and the inline onSelect arrow changed
   reference every render. React.memo + pass setSelectedId directly.
2. `fix: dev-gate SmartClipboard demo data fallback` — the IPC-unavailable
   branch seeded demo boards/snippets. Safe-by-accident in production but
   only one preload bug away from leaking. Guarded with `import.meta.env.DEV`.
   Added `src/whisperwoof/vite-env.d.ts` so the whisperwoof tsconfig picks
   up vite/client's ImportMeta typing.
3. `perf: batch project-integration queries (fix N+1 IPC)` — WhisperWoofProjects
   fired one IPC call per project in a loop. Replaced the per-project handler
   with a single `whisperwoof-get-project-integrations` returning the full
   projectId → target map in one SQL query.
4. `refactor: delete unused SqliteProvider class` — the 636-line class in
   src/whisperwoof/core/storage/sqlite-provider.ts was never imported by any
   production or test code. Runtime has always used better-sqlite3 directly
   from src/whisperwoof/bridge/app-init.js. Deleted + corrected CLAUDE.md /
   CONTRIBUTING.md to describe the actual architecture.
5. `test: wire 4 tests to real source (truthfulness refactor, batch 1)` —
   extracted pure logic into `-pure.js` sibling modules and rewired 4 tests
   to import the real implementations: snippet-hotkeys, context-detector
   (already in bridge, just fixed imports), snippets (matchSnippet +
   simpleEditDistance), style-learner (editDistance + shouldRecordStyleExample
   + buildPromptFromExamples).
6. `test: wire privacy-lock test to real source (truthfulness refactor)` —
   extracted the URL allowlist / provider check / overrides into
   bridge/privacy-lock-pure.js. Previously the test kept its own copy, so a
   regression in the real allowlist would have shipped green — the most
   dangerous instance of the test-truthfulness bug because privacy lock is a
   security guarantee. Also froze DEFAULT_ALLOWED_LOCAL + PRIVACY_OVERRIDES.

### Task #5 status — partial (5 of ~35 files done)
Remaining ~30 test files still reimplement production logic inline. Full
bucket breakdown, the "extract `*-pure.js` sibling" pattern, and a
recommended next batch are documented in `docs/test-truthfulness-refactor.md`
so future sessions can pick up cold.

### Key learnings
- better-sqlite3 can't load in the vitest Node runtime (compiled for
  Electron's Node, NODE_MODULE_VERSION mismatch). Real-DB integration tests
  are not an option — pure-logic extraction is the only path.
- `vi.mock("electron", …)` does NOT reliably intercept the CJS
  `require("electron")` chain invoked from a .js module imported by a .ts
  test. Any bridge module that calls `app.getPath("userData")` at top-level
  crashes at module load. Solution: extract logic into a sibling `-pure.js`
  that has no electron / fs requires.
- Phase 1a daily-use gate (task_plan:33) was still unchecked despite shipping
  through v1.9.0. Checked off.

### Test Results
- 43 test files / 739 tests passing (net -5 from 744: removed 9 reimplemented
  "tests" that exercised in-test fakes, added 4 meaningful tests against real
  source). All green; no regressions.

## 2026-04-07 — Session: Meeting & Agent Engineering Review + Fixes

### Phase A: Meeting Safety (DONE)
- [x] MeetingAudioBuffer — writes PCM to rotating 5-min WAV segments on disk
- [x] MeetingTranscriptCheckpoint — saves transcript to SQLite every 60s
- [x] MeetingSessionManager — WebSocket reconnection with exponential backoff + session rotation at 25min
- [x] Wired audio buffer into sendMeetingAudio (parallel write to disk + OpenAI)
- [x] Wired checkpoint into attachMeetingStreamingHandlers (feeds segments on finalize)
- [x] Added auto-start recording option (meetingAutoStart setting)
- [x] Unified meeting bridge (removed in-memory-only segment accumulation)
- [x] Fixed setPreferences mutation (Object.assign → spread)
- [x] 78 new tests (audio-buffer, transcript-checkpoint, session-manager)
- [x] Fixed WAV header bug (pwrite vs sequential write)

### Phase B: Agent Fixes (DONE)
- [x] Fixed conversation creation race condition (mutex via creatingConversationRef)
- [x] Added LLM streaming cancellation (AbortController on new chat / close)
- [x] Fixed auto-scroll (only when user is near bottom, within 120px)
- [x] Fixed stale messagesRef in LLM context building
- [x] Fixed fragile AudioManager cleanup
- [x] Fixed agentic-actions tests (import from source, not duplicated code)

### Phase C: Polish (DONE)
- [x] Fixed stale "Now" indicator in UpcomingMeetings (30s update interval)
- [x] Deduplicated AgentState type (export from AgentOverlay)
- [x] Improved empty streaming state UX (loading dots instead of empty bubble)

### Test Results
- 744 tests across 43 test files — all passing
- No regressions from any phase

### Commits
1. `feat: meeting safety — local audio buffer, transcript checkpoints, reconnection`
2. `fix: agent overlay bugs — race condition, cancellation, scroll, stale refs`
3. `fix: polish — stale Now indicator, deduplicate AgentState, empty streaming UX`
