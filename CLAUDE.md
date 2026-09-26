# WhisperWoof — Developer Guide

## Project Overview

WhisperWoof is a voice-first personal automation tool. Fork of OpenWhispr (Electron 39 + React 19 + TypeScript + Tailwind v4 + Vite).

Core pipeline: Voice → STT (Whisper/Parakeet, local) → LLM Polish (OpenWhispr's `ReasoningService` → bundled llama-server, configured in Intelligence) → Hotkey-driven routing → Storage

## Planning & Progress

- **Task plan:** `task_plan.md` — Phases, decisions, progress tracking
- **Findings:** `findings.md` — OpenWhispr research, review decisions, technical discoveries
- **Progress log:** `progress.md` — Session-by-session log of work done
- **Design doc:** `docs/design/design-doc.md` — Full design specification (APPROVED)
- **CEO plan:** `docs/design/ceo-plan.md` — Scope decisions and vision
- **Review summary:** `docs/reviews/2026-03-23-initial-reviews.md` — Engineering, security, design reviews

## Architecture

- **Storage** — Main process owns `better-sqlite3` directly in `src/whisperwoof/bridge/app-init.js`; it creates `bf_entries`, `bf_projects`, `bf_snippets`, `bf_snippet_boards`, `bf_audit_log`, and the FTS5 index. A `StorageProvider` TypeScript interface lives in `src/whisperwoof/core/storage/` for the pipeline module, but is not instantiated at runtime. The renderer reads/writes exclusively via IPC handlers in `src/helpers/ipcHandlers.js`.
- **Hotkey = intent** — Key combo determines destination. No LLM intent detection. Fn+letter combos detected via native `.keyDown` monitor in globe-listener (e.g. Fn+T → clipboard, Fn+N → markdown, Fn+P → project).
- **MCP for plugins** (Phase 2) — Plugins are MCP servers. WhisperWoof is an MCP client.
- **Polish** — All production polish surfaces (dictation, CommandBar Cmd+K, file-import, meeting-end) go through OpenWhispr's reasoning stack with the same `cleanupPrompt` from `src/locales/en/prompts.json`. Dictation: `audioManager.processTranscription` (`src/helpers/audioManager.js:648`) calls `ReasoningService.processText`. CommandBar: `polishViaReasoning` in `CommandBar.tsx` mirrors that flow. File-import and meeting-end IPC handlers (`whisperwoof-import-audio`, `whisperwoof-meeting-end`) now return raw transcripts — polish is a renderer-layer concern, gated on `useReasoningModel` and the selected model. Local mode uses bundled `llama-server` (llama.cpp); cloud providers (OpenAI / Anthropic / Gemini / Custom) flow through the same `ReasoningService`. Prompt overridable in Prompt Studio. The cleanup prompt is tuned/measured via `eval/run-polish-eval.js` + `eval/polish-cases.json` (tests the real `cleanupPrompt` against local Ollama models as a proxy for the bundled GGUF). The legacy WhisperWoof Ollama polish stack and the "Voice Style" tuning bench were deleted (see CHANGELOG Unreleased).
- **Local-first** — No mandatory cloud dependency. Local reasoning runs via bundled `llama-server`; downloaded models live under `~/.cache/openwhispr/`. Cleanup gracefully degrades to raw transcript if `useReasoningModel` is off or no model is selected.
- **Memory + Word Packs** — Auto-learn: paste → `textEditMonitor` (native `macos-text-monitor`, needs Accessibility; target pid + bundle id captured at hotkey press) → `_learnCorrections` → `utils/correctionLearner.js` `extractCorrectionPairs` (misheard → corrected phrase pairs) → Memory (`bridge/vocabulary.js` `recordCorrection`: word + `alternatives` + `learnedCounts`) and new words to the Dictionary (`custom_dictionary`). Two ways Memory reaches a transcript: (1) **replacements** — `core/vocabulary/memory-replacements.js` swaps approved mishearings in `audioManager.processTranscription` before polish, for every local engine and batch cloud (the only lever for sherpa engines: Parakeet TDT ignores sherpa hotwords, measured). Memory never enables a swap by itself: rules are typed or user-approved alternatives only. A learned pair (`learnedCounts`) becomes an *offer* (`swapOffer` → `memory-swap-offer` IPC → toast "Always change X to Y?" in `App.jsx` → `whisperwoof-confirm/decline-memory-swap`) after 2 identical fixes, and only if the misheard text can't be real text (single word: not in `/usr/share/dict` incl. -s/-ed/-ing stems, not a number; phrase: no function words, term-like target; no extend/trim; no inverse rule). Declining or reverting a swap (`splitReversals`) adds it to `declinedAlternatives` for good. The Memory view lists approved swaps (`ui/memory/SwapsSection.tsx` → `whisperwoof-get-memory-swaps`; refreshes on `memory-swaps-updated`); stopping one declines it. (2) **STT hints** — `_getSttHintPrompt` → `buildSttPrompt` (`core/vocabulary/pack-manager-pure.js`): correct spellings only (never `alternatives`), Memory → Dictionary → packs, app-boosted, 560-char budget, highest priority written LAST (Whisper keeps only the last 224 tokens); local whisper-server and batch cloud `prompt`. In Auto language mode a hint prompt can hijack CJK speech into English: `core/language/auto-hints.ts` detects it from the `verbose_json` language, redoes the decode without hints and holds hints until a non-CJK dictation. Word Packs are opt-in (`defaultEnabled: false`; `migratePackDefaults` moves never-chosen states).
- **Pre-warm** — `sync-startup-preferences` (`ipcHandlers.js`) calls `modelManager.prewarmServer(reasoningModel)` on app boot when local reasoning is enabled, so the first dictation doesn't pay the model-load cost. Idempotent.
- **Live dictation** — `dictationMode: "live"` streams the mic into a second, online sherpa-onnx server (`ParakeetServerManager.streamServer`) running the preview model (default X-ASR zh/en); partials arrive as `{text, committed, partial}` and render in `ui/indicator/LiveDictationPanel.tsx`, a one-line ticker (Mando + an English sign pill on the left, the line slides left as it grows; the provisional tail in `live-words` glass). On release the final is either the streamed text or a full-capture decode with the transcription model (`liveFinalPass`), falling back to the draft. If the stream can't start or dies (`parakeet-stream-error`), the panel says why (`liveNoticeForError`) instead of "Start talking…". Routing matrix: `core/live/live-dictation.ts` (`resolveLiveDictationPlan`). Settings UI: `ui/settings/DictationModeSection.tsx`. Bench: `eval/dictation-bench/run_streaming.py`.
- **Clipboard** — `startClipboardMonitor` in `bridge/app-init.js` polls every 500ms: Finder copies (`NSFilenamesPboardType` / `public.file-url`) go through `planCopiedFiles` — photos ≤50 MB kept as images; other files ≤100 MB kept (in a folder of their own, original name) only with `clipboardCapture.keepFiles` (opt-in, off by default); the rest stay text, and the Finder icon is never kept; image data is noticed by a key over the pasteboard's raw bytes (never decoded per tick) and deduped by a pixel fingerprint; re-copying bumps the existing entry. Images live in `userData/whisperwoof-images` (original + 480px preview). The Clipboard view (`ui/smart-clipboard/ClipboardTimeline.tsx`: text | images) talks to `bridge/clipboard-store.js` by entry id only (list text/image/file, copy back — files as `public.file-url` on macOS —, reveal, save to note with `attachments/`, pin, remove, clear, retention, capture); rules in `bridge/clipboard-pure.js`. The app's own writes call `adoptCurrentClipboard()` so they aren't recaptured. Retention (`clipboardRetention` in `whisperwoof-settings.json`): keep days (default forever) + image space cap (default 1 GB), pinned (`favorite`) never pruned; runs at startup, after image captures, on change.
- **File trust** — Main never reads or deletes a path just because the renderer sent it. `bridge/app-files.js` `resolveAppFile` (realpath, strictly inside `userData/whisperwoof-images` or `userData/audio`, encryption-aware via `vaultFiles.physicalPath`) guards `whisperwoof-get-image` and saved entries; Storage deletes only app-made files (never an import's original). Settings export/import pick their file with native dialogs (`bridge/settings-export.js`), and a plugin's MCP command runs only after a native Allow dialog.
- **Audio retention** — The renderer's Audio Retention days arrive with `sync-startup-preferences`; main (`_applyAudioRetentionDays` → `_sweepExpiredAudio`, by file mtime) sweeps only after that first sync, every 6 h and after each unlock (`runAudioSweep`), never while the database is closed. `0` stops saving new audio. Encryption conversions keep file dates (`keepTimes`), so turning encryption on doesn't restart the clock. Meeting crash buffers are deleted on a clean stop and swept after 24 h (`MeetingAudioBuffer.sweepStaleSessions`).
- **Bridge pattern** — `src/whisperwoof/bridge/` is the ONLY place that imports OpenWhispr code. All other WhisperWoof code is isolated.
- **Encryption (vault, opt-in)** — Design + threat model: `docs/design/at-rest-encryption.md`. Main process only (`src/whisperwoof/bridge/vault/`); the renderer never sees keys (IPC in `vault-ipc.js`, UI in `ui/vault/`).
  - **Keys:** master key = HKDF of the 12-word BIP39 phrase (`recovery-phrase-pure.js`), wrapped by password (scrypt 2^18 — Electron 39 has no Argon2) and Touch ID. Touch ID = a Secure Enclave key (`resources/macos-vault-helper.swift`, `biometryCurrentSet`) doing ECDH; works on unsigned builds, whereas Keychain biometry ACLs fail with -34018. `vault-keys-pure.js` owns `userData/vault/vault.json`.
  - **Stores:** `transcriptions.db` is SQLCipher via `better-sqlite3-multiple-ciphers` (open ONLY through `vault-db.js` `openDatabase`; never put keys in URIs — URI filenames are off, so the key would become the file name). Files (audio, clipboard images, notes, Memory + other JSON stores, meeting PCM) are `WWENC1` (`wwenc-pure.js`): per-file key sealed to the vault's X25519 public key, so writing works while locked. Read and write them through `vault-files.js` (logical path `x`, bytes in `x.wwenc`); a store that rewrites its whole file must pass `requireUnlocked: true`.
  - **Locked:** databases closed (`DatabaseManager.close()`, `appInit.detachDatabase()`), keys dropped. Dictation still works: saves become sealed inbox items (`vault-inbox.js`, provisional negative transcription ids) replayed on unlock (`vault-inbox-handlers.js`). Code that reads the DB at startup or from timers must tolerate `databaseManager.db === null` (see `googleCalendarManager._databaseOpen`). A recording meeting defers the lock.
  - **Migrations** (on, off, new phrase, notes toggle) are journaled and decided from on-disk state (`migration-plan-pure.js`, `vault-migrate.js`, `vault-rotate.js`); plaintext is deleted only after the converted copy is fsynced and verified. Never hand a renderer `buf.buffer` of a Node Buffer (pooled slabs leak other memory); secrets use `unpooledConcat`.

## Key Files (after fork setup)

```
src/whisperwoof/                 ← ALL WhisperWoof additions
  core/                       ← Main process (strict TypeScript)
    storage/                  StorageProvider interface + shared types (runtime DB lives in bridge/app-init.js)
    polish/                   Style-learner tests only. Active polish path is OpenWhispr's
                              ReasoningService called from audioManager.processTranscription.
    router/                   HotkeyRouter (route definitions + dispatch)
    clipboard/                Clipboard rule tests (the monitor itself is in bridge/app-init.js)
    pipeline/                 Orchestrates STT → Polish → Route
    meeting/                  Tests for meeting safety modules
  ui/                         ← Renderer (React + TSX)
    history/                  HistoryPanel, Search, AudioPlayer
    home/                     HomeStats: headline sentence + row of facts (home-summary.ts), activity heatmap
    indicator/                MandoSprite (animated Mando: spritesheet + mando-manifest.json,
                              state → animation + hop machine in mando-sprite.ts),
                              CancelRecordingButton, MeetingRecordingPill. The indicator
                              shell itself (WhisperWoofIndicator, full/compact/dot) is in src/App.jsx
    settings/                 WhisperWoof settings sections
    vault/                    Encryption settings, turn-on/off dialogs, lock screen, Home offer
    projects/                 Project picker, project detail view
  bridge/                     ← ONLY place that imports OpenWhispr code
    vault/                    At-rest encryption: keys, WWENC1 files, keyed DB open,
                              sealed inbox, migrations, Touch ID helper bridge, IPC
    stt-hook.ts               Hook into STT output
    hotkey-hook.ts            Extend HotkeyManager
    app-init.ts               WhisperWoof init at startup
    meeting-bridge.js         Meeting lifecycle coordinator (delegates to checkpoint)
    agentic-actions.js        Voice-triggered action intent detection + MCP routing

src/helpers/                     ← Meeting safety modules (main process)
    meetingAudioBuffer.js       Local WAV file buffer (5-min rotating segments)
    meetingTranscriptCheckpoint.js  Periodic transcript save to SQLite (60s)
    meetingSessionRotation.js   25-min session rotation: which streams, connect new → swap → close old
    meetingSessionManager.js    Unused wrapper (tests only); live rotation/reconnect is in ipcHandlers.js
    meetingDetectionEngine.js   Orchestrates calendar + process + audio detection
    audioActivityDetector.js    Mic activity detection (event-driven + polling)
    meetingProcessDetector.js   Detects Zoom/Teams/Webex/FaceTime running
```

### Meeting recording safety architecture

```
Voice/System Audio Chunks
    │
    ├──► MeetingAudioBuffer        (local WAV files, 5-min segments)
    │     ├── Crash-safe: valid WAV on disk at all times
    │     └── Deleted on a clean stop; kept only after an abnormal end, swept after 24h
    │
    ├──► OpenAI Realtime WebSocket (streaming transcription)
    │     ├── Rotation at 25min per session (connectedAt; ipcHandlers + meetingSessionRotation.js):
    │     │   fresh session connects first, swaps in, then the old one closes
    │     └── If disconnect: auto-reconnect with exponential backoff (fresh token)
    │
    └──► MeetingTranscriptCheckpoint (SQLite every 60s)
          └── At most 60s of transcript lost on crash
```

### Meeting detection confidence model

```
Calendar event imminent (90s)     → HIGH confidence → show notification
Calendar event + mic active       → HIGH confidence → 2s threshold
Meeting app running + mic active  → HIGH confidence → 2s threshold
Mic active only                   → MEDIUM confidence → 8s threshold
```

### Fn+letter hotkey routing data flow

```
macos-globe-listener.swift    FN_DOWN / FN_KEY:T / FN_UP (native keyDown monitor)
  → src/helpers/globeKeyManager.js    emits 'fn-combo-key' event
  → main.js                          tracks activeFnComboKey, builds "Fn+T"
  → src/helpers/windowManager.js      sendStopDictation(hotkeyUsed) via IPC
  → preload.js                        forwards hotkeyUsed to renderer
  → src/hooks/useAudioRecording.js    routes: Fn→paste, Fn+T→clipboard, Fn+N→markdown, Fn+P→project
```

## Testing

Framework: **Vitest** (integrates with Vite config)

```bash
npx vitest              # Run tests
npx vitest --coverage   # Run with coverage
```

Target: 80%+ coverage on WhisperWoof code. Test priorities:
1. StorageProvider CRUD + FTS search + Projects
2. LLM polish pipeline (mock Ollama, test fallback chain)
3. Hotkey routing dispatch
4. Clipboard monitor (dedup, ConcealedType detection)
5. Pipeline orchestration (STT → Polish → Route)
6. File import pipeline (transcode + background STT)
7. Indicator Mando sprite (`pickMandoAction`, `nextCelebration` hop cancel, website-demo drift guard)

## Commands

```bash
npm install          # Install dependencies
npm start            # Start dev mode
npx vitest           # Run tests
npm run build        # Build for production
node scripts/build-mando-sprites.js [path/to/Mando-assets-v6]  # Rebuild Mando WebP spritesheets (needs ffmpeg, cwebp, img2webp)
node scripts/build-app-icon.js  # Rebuild icon.png/.icns/.ico from src/assets/logo.svg (macOS; needs Google Chrome, sips, iconutil)
```

## Implementation Phases

See `task_plan.md` for full details. Summary:

- **Phase 0:** Fork + Audit + Harden (security, preload audit, Vitest setup, Fn validation)
- **Phase 1a:** Core Pipeline (StorageProvider, Ollama, routing) + daily-use gate
- **Phase 1b:** Features (clipboard, history UI, indicator, projects, meetings, file import)
- **Phase 2:** MCP Plugin System
- **Phase 3:** Polish & Ship

## Design System

Always read `DESIGN.md` before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there
(implementation notes: `docs/design/liquid-glass.md`).
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match `DESIGN.md`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
