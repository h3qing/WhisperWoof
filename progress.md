# Progress Log

## 2026-05-17 — Session: Polish-consolidation audit + 4 follow-up fixes

Did a thorough code audit of the three polish-architecture consolidation
commits from the previous session (`6b4255877`, `bb045db38`, `16ec5b256`).

### Findings
The `bb045db38` commit message claimed the WhisperWoof Ollama polish stack
was "now-unwired pending Phase-2 deletion." Audit found 5 live callers still
on the stack:

1. `CommandBar.tsx:85` — `/note` route polishes via `whisperwoofOllamaPolish`
2. `CommandBar.tsx:116` — default paste-at-cursor polishes via `whisperwoofOllamaPolish`
3. `ipcHandlers.js:2990` — `whisperwoof-import-audio` polishes file imports
4. `ipcHandlers.js:3063` — `whisperwoof-meeting-end` polishes meeting transcripts
5. `tuning-bench.js:127` — Pipeline Tuning Bench (dev-only — intentional)

Other audit findings:
- **Inconsistent polish behavior**: dictation now uses OpenWhispr's
  `cleanupPrompt`; the 4 surviving non-dictation surfaces still use the
  WhisperWoof PRESETS + style-learner + context-detector + vibe-coding +
  language-detect + backtrack stack. Same user, same settings, different
  prompts depending on the entry's source.
- **Pre-warm scope mismatch**: `sync-startup-preferences` deps in
  `useSettings.ts` don't include `useReasoningModel`. Toggling text cleanup
  off doesn't stop the server; toggling on mid-session doesn't pre-warm.
- **Orphan IPC handlers**: `whisperwoof-ollama-check`,
  `whisperwoof-get-polish-presets`, save/delete custom-preset — handlers
  registered, preload bindings exposed, but no live source callers after
  WhisperWoofSettings.tsx was rewritten.
- **Orphan localStorage keys** persist in user state (no migration).
- **`wasPolished` boolean** in `useAudioRecording.js:290` can mis-report
  when polish produces output identical to input.
- `src/dist/` confirmed not tracked.

### Fixes shipped (4 commits via parallel agents in worktrees)

User decision on the prompt-consistency question: respect the original
OpenWhispr open-source `cleanupPrompt` everywhere — don't preserve the
WhisperWoof PRESETS / middleware for the non-dictation surfaces.

1. **`a3f10398b refactor(polish): route CommandBar/file-import/meeting-end
   through ReasoningService`** — added `polishViaReasoning()` helper in
   `CommandBar.tsx` mirroring `audioManager.processTranscription`.
   Stripped inline `polishWithOllama` from `whisperwoof-import-audio` and
   `whisperwoof-meeting-end` IPC handlers (they return raw transcripts now;
   polish is a renderer-layer concern). Deleted `whisperwoof-ollama-polish`
   IPC + preload binding. WhisperWoof Ollama stack now used only by
   `tuning-bench.js` (dev-only).
2. **`8e9bf64b1 fix(polish): gate llama-server pre-warm on useReasoningModel
   toggle`** — added `useReasoningModel` to `useSettings.ts` destructure,
   payload, dep array. In `sync-startup-preferences`, env vars still set
   when local+model are configured, but `prewarmServer` is gated on the
   toggle; when off, `stopServer` runs to free RAM.
3. **`c69f3a1d5 chore(polish): remove 4 orphan IPC handlers after polish
   consolidation`** — deleted `whisperwoof-ollama-check`,
   `whisperwoof-get-polish-presets`, `whisperwoof-save-custom-preset`,
   `whisperwoof-delete-custom-preset` + their preload bindings.
   Conservatively kept the underlying helpers in `polish-presets.js`
   intact for tuning-bench.
4. **`73bf4319c chore(polish): one-shot cleanup of orphan
   whisperwoof-polish-* localStorage keys`** — sentinel-gated useEffect in
   `useSettings.ts` removes 10 orphan keys
   (`whisperwoof-polish-enabled`, `-preset`, `-custom-prompt`, `-provider`,
   `-model`, `whisperwoof-ollama-model`, and 4 `*-api-key` keys).

### Orchestration notes
Ran 4 parallel agents in `git worktree` isolation. Agent D initially
halted because its worktree branched from a stale commit where the keys
were still live; re-ran after merging A/B/C to main. Cherry-pick of C
conflicted with A in `ipcHandlers.js` + `preload.js` (deletion-vs-deletion
at neighboring lines); resolved by deleting both sides.

### Test results
- 53 test files / 963 tests passing on the merged tip.
- Typecheck error count unchanged (10 pre-existing).
- No manual UI/dev-server testing yet.

### Open threads
- Phase-2 deletion of the WhisperWoof Ollama polish modules — now safe to
  delete IF `tuning-bench.js` is also retired or rewritten. Re-evaluate
  whether tuning-bench is still earning its weight.
- The cgevent-tap-spike artifact (`resources/cgevent-tap-spike{,.swift}`)
  is still untracked. Decide: commit under `resources/` w/ a README, or
  delete.
- `/office-hours` pass on diarization design — still the next major
  feature blocker.

## 2026-05-04 → 2026-05-07 — Sessions: Eng-review cherry-pick batch + polish-architecture consolidation

### Upstream cherry-pick batch (PRs #95–#101)
Eng review on 2026-05-04 split the upstream OpenWhispr cherry-pick queue into
small ship-now PRs vs. things that need design work. Documented the split in
the new `TODOS.md`. Shipped this week:

- **#95** `feat(parakeet): add parakeet-unified-en-0.6b model` — registered
  the 0.6B Parakeet variant alongside the existing 1.1B; smaller download
  for users who don't need the bigger model.
- **#96** `feat: extract CancelRecordingButton, always-visible during
  recording` — pulled the cancel control out into its own component so it
  renders independently of the indicator's hover state. Previously it only
  showed on hover, which made aborting a runaway recording feel hidden.
- **#97** `feat: add autoPasteEnabled toggle (default on)` — surfaced
  upstream's no-paste mode. Some users want polished text in clipboard but
  NOT auto-pasted (e.g., they're routing to a different app via Cmd+V
  themselves).
- **#98** `feat: add TXT format option to entry export` — JSON|TXT dropdown
  in StorageManager. SRT was in the upstream commit too but deferred (D6):
  `bf_entries` has no per-segment timing, so SRT would be a single cue
  spanning the whole recording — worse than nothing. SRT will land with
  the `bf_entry_segments` schema that also unblocks diarization.
- **#99** `feat(meeting): add meeting-state IPC channel + trigger field`
  — main-process broadcasts meeting lifecycle (started/stopped/source) over
  a new IPC channel so the renderer can react without polling.
- **#101** `feat(meeting): MeetingRecordingPill — floating banner during
  recording` — small pill UI that surfaces "meeting recording in progress"
  to the user, subscribing to the #99 IPC channel.

Deferred via `TODOS.md`:
- **Diarization (~PR #6)** — represents ~70% of the upstream effort
  (b187f3a14 → aec6f74f6 → ef1533a02 → 10fb4adbf → 78a2b82d0). Needs an
  /office-hours pass on model storage path, on-disk size budget, opt-in
  policy, and privacy model. Also depends on the `bf_entry_segments`
  schema. **Start here:** run `/office-hours` with the upstream commit
  list.
- **SRT export** — blocked on the same segments schema. Co-design with
  diarization.
- **secretCrypto (PR #5)** — scope-blocked. Inspection on 2026-05-04
  showed the review's premise was wrong: `plugin-bridge.js:62` is a
  comment, not a `safeStorage` call. Plugin env values are only set in
  `process.env` at runtime, never persisted. Recorded in TODOS.md so we
  don't re-investigate.

### Polish-architecture consolidation (three commits, 2026-05-07)
Long-standing duplication: WhisperWoof shipped a parallel polish stack
(Ollama backend, BYOM panel, 5 presets, custom-prompt textbox, free-text
model field) layered on top of OpenWhispr's existing Intelligence panel
(model picker w/ downloads, Prompt Studio, llama-server backend). Two
overlapping UIs, two overlapping backends, only one of which actually ran
on dictation. Tackled this in three commits:

1. **`6b4255877` fix(polish): revert overzealous prompt rewrite + add
   Ollama model fallback.** The `dddf61f87` "list formatting + paragraph
   separation" prompt rewrite was actively making polish worse on the
   default local models (`llama3.2:1b/3b`) — duplicated paragraphs, random
   Title Case, "Here is the cleaned-up version:" preambles, refusals on
   simple inputs. Side-by-side tested old vs. new prompt across four
   representative dictation samples; new prompt was worse on every
   diverging case. Restored pre-`dddf61f87` prompts in
   `polish-presets-pure.js` + `ollama-service.ts` default; added tests
   guarding against re-introduction of the offending rules. Also added a
   model-fallback resolver in `llm-providers.js`: pre-checks `/api/tags`
   (cached 30s) and falls back through a ranked list
   (`qwen2.5:3b → llama3.2:3b → … → llama3.2:1b`) with a clear log
   warning. Bumped Ollama timeout 5s → 15s for 1B-3B cold start on
   Apple Silicon.

2. **`bb045db38` refactor(polish): route dictation polish through
   OpenWhispr's reasoning.** Pulled the trigger on consolidation. Removed
   the redundant `whisperwoofOllamaPolish` call from
   `src/hooks/useAudioRecording.js` — `audioManager.processTranscription`
   (line 648) was already polishing via `ReasoningService` before firing
   `onTranscriptionComplete`, so the second polish was running every
   dictation on already-cleaned text. Observed cost: ~3-4s of pure waste
   per call. Now `useAudioRecording` just consumes `result.text`
   (polished) + `result.rawText` (raw) from audioManager and keeps the
   learning-mode toast.

   Dropped the "Polish (Ollama)" `SettingsSection` from
   `src/whisperwoof/ui/settings/WhisperWoofSettings.tsx` (Enable polish
   toggle, Style dropdown, Model textbox, Custom instructions textarea).
   Text cleanup is now configured exclusively in **Intelligence > Enable
   text cleanup + Prompt Studio**. Polish is gated by `useReasoningModel`,
   uses the configured `reasoningModel`, reads `cleanupPrompt` from
   `src/locales/en/prompts.json` (overridable in Prompt Studio).

   Legacy WhisperWoof Ollama polish modules left on disk pending Phase-2
   deletion (kept change reversible): `polish-presets*.js`,
   `llm-providers.js`, `ollama-bridge.js`, `ollama-service.ts`, IPC
   handlers `whisperwoof-ollama-polish` / `whisperwoof-ollama-check` /
   `whisperwoof-get-polish-presets`, and WhisperWoof-only middleware
   (style-learner, vibe-coding, backtrack, language-detect,
   context-detector).

3. **`16ec5b256` perf(polish)+docs: pre-warm llama-server + catch up
   CHANGELOG/CLAUDE/README.** When `sync-startup-preferences` fires on app
   boot (via `useSettings` useEffect mount), if local reasoning is enabled
   and `reasoningModel` is configured,
   `modelManager.prewarmServer(reasoningModel)` is called fire-and-forget.
   Saves ~10-15s on the first dictation after launch (Qwen3.5 2B model-load
   cost on Apple Silicon). Idempotent — `serverManager.start` returns early
   if already running with the same model, so re-firing on settings
   changes is safe.

   Documentation catch-up:
   - `CLAUDE.md` — rewrote Architecture > Polish bullet to describe the
     new flow (`audioManager.processTranscription` → `ReasoningService` →
     `llama-server`); flagged legacy Ollama stack as unwired pending
     Phase-2 deletion. Added a Pre-warm bullet. Updated Key Files tree
     comment for `src/whisperwoof/core/polish/`.
   - `README.md` — pipeline diagram now reads "bundled llama-server"
     instead of "Ollama"; "AI text polish" copy mentions Prompt Studio
     rather than 5 presets; Quick Start drops the `brew install ollama`
     step (the app bundles llama-server); requirements + tech stack +
     credits updated to reflect llama.cpp + Distil-Whisper.
   - `CHANGELOG.md` — `[Unreleased]` entries covering revert, fallback,
     consolidation, double-polish removal, and pre-warm.

### Uncommitted on disk
- `resources/cgevent-tap-spike` + `cgevent-tap-spike.swift` — 111-line
  Swift proof-of-concept for `CGEventTapCreate` at `.cgSessionEventTap` /
  `.headInsertEventTap` that consumes Fn+T/N/P keyDown+keyUp before the
  focused app sees them (returns `nil` from the tap callback). Built
  2026-04-14 — same day v1.11.0 shipped the CGEventTap rewrite of
  `macos-globe-listener.swift`. This is the standalone prototype that
  informed that rewrite, kept as a reference implementation but never
  committed. Safe to delete; or commit under `resources/` if we want it
  preserved for future tap experiments.

### Test results
- 53 test files / 963 tests — all green.

### Open threads for next session
- Phase-2 deletion of the unwired WhisperWoof Ollama polish stack (now
  that the consolidation has had time to bake).
- Decide whether to keep the cgevent-tap-spike artifact (commit under
  `resources/` w/ README, or delete).
- `/office-hours` pass on diarization design (see TODOS.md). This is the
  next major feature — the `bf_entry_segments` schema design unlocks both
  diarization and SRT export.

## 2026-04-21 — Session: Live transcript ticker + meeting hotkey removal + v1.12.0

### Live transcript ticker in floating indicator
- Explored streaming STT partial transcript pipeline — Deepgram and OpenAI
  Realtime already emit `onPartialTranscript` callbacks, wired through
  `audioManager.js` → `useAudioRecording.js` → `partialTranscript` state.
  Data was flowing but never rendered.
- Added `partialTranscript` prop to `WhisperWoofIndicator` in `App.jsx`.
  When speaking + streaming STT active, replaces "Listening..." with a
  right-to-left ticker: `overflow: hidden` + `justify-content: flex-end`
  + CSS mask gradient for smooth left-edge fade.
- Falls back to "Listening..." for batch mode (local Whisper) since no
  partial transcripts are available.
- Added `whisperwoof-live-transcript` toggle in Settings > WhisperWoof >
  Indicator (default: ON). Follows existing localStorage pattern.
- Discussed local streaming options (chunked inference, whisper.cpp --stream
  mode) — decided not worth the CPU tradeoff for now.

### Meeting hotkey removal
- `Command+Shift+N` global hotkey for meeting mode conflicted with browser
  incognito window shortcut — triggered unexpected window resize via
  `snapControlPanelToMeetingMode()`.
- Meeting detection is already automatic (calendar events, process detection,
  mic activity), so the manual hotkey was redundant.
- Removed: hotkey callback + registration in `main.js`, IPC handler
  `register-meeting-hotkey`, Settings UI section, `meetingKey` from
  settingsStore/useSettings/types, validation references in
  AgentModeSettings and SettingsPage.
- Added one-time cleanup on startup: unregisters any saved meeting hotkey
  and clears it from `.env`.

### v1.12.0 release
- VERSION, package.json, CHANGELOG, WhisperWoofSettings version display,
  README badge all updated.

### Test results
- 46 test files / 882 tests — all green.

## 2026-04-12 — Session: v1.10.0 release + debugLogger sweep + Bucket C complete + hotkey redesign plan

### Release
- Cut v1.10.0: bumped VERSION, package.json, CHANGELOG, website hero badge + "What's New" cards.

### debugLogger.error sweep (15 sites)
- All 15 `debugLogger.error("msg:", error)` sites in `ipcHandlers.js` converted
  to template literals with `error.message`. Previously logged `{}` for every
  caught error because Error objects don't JSON-serialize (message/stack aren't
  enumerable).

### Test truthfulness — Bucket C complete (6 files, 29 of 35 total)
- `app-automation.test.ts` (Pattern 1) — found silent drift: test had 11 commands,
  source has 12 (missing `doNotDisturb`).
- `conversation-memory.test.ts` (Pattern 1) — no bugs found.
- `streaming-manager.test.ts` (Pattern 1) — no bugs found.
- `daily-digest.test.ts` (Pattern 2) — new `bridge/daily-digest-pure.js`.
- `entry-chains.test.ts` (Pattern 2) — new `bridge/entry-chains-pure.js` with
  injectable lookup for DI in tests.
- `entry-templates.test.ts` (Pattern 2) — new `bridge/entry-templates-pure.js`.
- `agentic-actions.test.ts` — already refactored in a prior session, no work needed.

### Hotkey combo UX redesign — plan reviewed and approved
- Researched macOS hotkey landscape: system-reserved keys, Globe/Fn namespace
  expansion, competing voice app defaults (Wispr Flow, SuperWhisper, Aqua Voice).
- Found Fn+N conflicts with macOS Notification Center (Sonoma+).
- Ran /autoplan with CEO + Eng review. Key findings:
  - Split bug fix (CGEventTap key consumption) from interaction model redesign
  - Add prototype spike as go/no-go gate for CGEventTap
  - Design routing layer input-agnostic for future voice routing
- Compiled CGEventTap spike binary (`resources/cgevent-tap-spike.swift`).
  Awaiting manual test to verify Globe+letter interception works.

### TS strict-mode errors — scoped
- 313 errors across `src/whisperwoof/`. 75% concentrated in 8 files.
- Top 3 are meeting test files (163 errors, 52%) — mostly implicit `any` from mocks.
- Bucket D test truthfulness running in background.

### Test results
- 44 test files / 808 tests — all green.

## 2026-04-14 — Session: Hotkey fix + Plugin setup + Obsidian integration + v1.11.0

### Hotkey Phase A — CGEventTap (DONE)
- Built and tested CGEventTap spike — confirmed it intercepts Fn+T/N/P
  before macOS handles Globe shortcuts (including Fn+N Notification Center).
- Rewrote `macos-globe-listener.swift` with `CGEventTapCreate` +
  `headInsertEventTap`. Routing keys consumed, no more "ttttt" in text fields.
- Falls back to read-only `NSEvent.addGlobalMonitorForEvents` if Accessibility
  permission denied (emits `NO_ACCESSIBILITY` event to JS).
- `globeKeyManager.js` passes `--routing-keys T,N,P` arg to binary.

### Fn+N / Fn+P routing fix (CRITICAL bug found by E2E audit)
- `useAudioRecording.js` had a route map for Fn+N → `save-as-markdown` and
  Fn+P → `project`, but the dispatch code only handled `copy-to-clipboard`.
  Everything else silently fell through to paste-at-cursor. Added real
  dispatch for both routes.
- Fn+letter combos now force push-to-talk regardless of global activation
  mode. In toggle mode, releasing Fn with a combo key stops recording
  (previously did nothing, user had to tap Fn again).

### Plugin system
- Added TickTick to default plugin list (was missing).
- Added guided setup flow: toggle ON → inline setup card with instructions,
  link to developer portal, API key input, test button, "Save & Enable".
- All 5 first-party plugins have setup metadata (envKey, label, url, instructions).
- Saved plugin files auto-merge new defaults and backfill setup metadata.

### Obsidian / iCloud integration
- `markdown-route.js` now writes YAML frontmatter (title, date, source, app).
- `getNotesDir()` reads from `whisperwoof-settings.json` (not just env var).
- New `setNotesDir()` + `whisperwoof-pick-notes-dir` IPC opens native folder
  picker. Settings UI has "Change Folder" button.
- User can point to `~/Library/Mobile Documents/.../Obsidian/Vault/` — notes
  appear in Obsidian and sync via iCloud.

### Mando toast icon
- Toast component gained `icon` prop. Fn+T, Fn+N, Fn+P toasts show the
  18x18 Mando head SVG.

### v1.11.0 release
- VERSION, package.json, CHANGELOG, website all updated.
- Website hero badge: "v1.11 — Hotkey Fix + Plugin Setup + Obsidian Notes"
- "What's New" cards: Hotkey Fix, Obsidian Notes, Plugin Setup.

### Test results
- 44 test files / 808 tests — all green. 0 TypeScript errors.

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
