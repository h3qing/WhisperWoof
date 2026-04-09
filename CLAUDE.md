# WhisperWoof — Developer Guide

## Project Overview

WhisperWoof is a voice-first personal automation tool. Fork of OpenWhispr (Electron 39 + React 19 + TypeScript + Tailwind v4 + Vite).

Core pipeline: Voice → STT (Whisper/Parakeet) → LLM Polish (Ollama) → Hotkey-driven routing → Storage

## Planning & Progress

- **Task plan:** `task_plan.md` — Phases, decisions, progress tracking
- **Findings:** `findings.md` — OpenWhispr research, review decisions, technical discoveries
- **Progress log:** `progress.md` — Session-by-session log of work done
- **Design doc:** `docs/design/design-doc.md` — Full design specification (APPROVED)
- **CEO plan:** `docs/design/ceo-plan.md` — Scope decisions and vision
- **Review summary:** `docs/reviews/2026-03-23-initial-reviews.md` — Engineering, security, design reviews

## Architecture

- **StorageProvider interface** — All data access is abstracted. Phase 1 uses SqliteProvider (Kysely ORM + better-sqlite3). Future providers: Supabase, WhisperWoof Cloud.
- **Hotkey = intent** — Key combo determines destination. No LLM intent detection. Fn+letter combos detected via native `.keyDown` monitor in globe-listener (e.g. Fn+T → clipboard, Fn+N → markdown, Fn+P → project).
- **MCP for plugins** (Phase 2) — Plugins are MCP servers. WhisperWoof is an MCP client.
- **Local-first** — No mandatory cloud dependency. Ollama is optional (graceful degradation to raw transcript).
- **Bridge pattern** — `src/whisperwoof/bridge/` is the ONLY place that imports OpenWhispr code. All other WhisperWoof code is isolated.

## Key Files (after fork setup)

```
src/whisperwoof/                 ← ALL WhisperWoof additions
  core/                       ← Main process (strict TypeScript)
    storage/                  StorageProvider interface + SqliteProvider
    polish/                   OllamaService (adapts OpenWhispr's ReasoningService)
    router/                   HotkeyRouter (route definitions + dispatch)
    clipboard/                ClipboardMonitor (NSPasteboard polling)
    pipeline/                 Orchestrates STT → Polish → Route
    meeting/                  Tests for meeting safety modules
  ui/                         ← Renderer (React + TSX)
    history/                  HistoryPanel, Search, AudioPlayer
    indicator/                FloatingIndicator (Classic + Bark dog ear styles)
    settings/                 WhisperWoof settings sections
    projects/                 Project picker, project detail view
  bridge/                     ← ONLY place that imports OpenWhispr code
    stt-hook.ts               Hook into STT output
    hotkey-hook.ts            Extend HotkeyManager
    app-init.ts               WhisperWoof init at startup
    meeting-bridge.js         Meeting lifecycle coordinator (delegates to checkpoint)
    agentic-actions.js        Voice-triggered action intent detection + MCP routing

src/helpers/                     ← Meeting safety modules (main process)
    meetingAudioBuffer.js       Local WAV file buffer (5-min rotating segments)
    meetingTranscriptCheckpoint.js  Periodic transcript save to SQLite (60s)
    meetingSessionManager.js    WebSocket reconnection + session rotation
    meetingDetectionEngine.js   Orchestrates calendar + process + audio detection
    audioActivityDetector.js    Mic activity detection (event-driven + polling)
    meetingProcessDetector.js   Detects Zoom/Teams/Webex/FaceTime running
```

### Meeting recording safety architecture

```
Voice/System Audio Chunks
    │
    ├──► MeetingAudioBuffer        (local WAV files, 5-min segments)
    │     └── Crash-safe: valid WAV on disk at all times
    │
    ├──► OpenAI Realtime WebSocket (streaming transcription)
    │     ├── MeetingSessionManager handles reconnection + rotation
    │     └── If disconnect: auto-reconnect with exponential backoff
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

## Commands

```bash
npm install          # Install dependencies
npm start            # Start dev mode
npx vitest           # Run tests
npm run build        # Build for production
```

## Implementation Phases

See `task_plan.md` for full details. Summary:

- **Phase 0:** Fork + Audit + Harden (security, preload audit, Vitest setup, Fn validation)
- **Phase 1a:** Core Pipeline (StorageProvider, Ollama, routing) + daily-use gate
- **Phase 1b:** Features (clipboard, history UI, indicator, projects, meetings, file import)
- **Phase 2:** MCP Plugin System
- **Phase 3:** Polish & Ship

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
