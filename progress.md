# Progress Log

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
