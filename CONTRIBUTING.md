# Contributing to WhisperWoof

WhisperWoof is a voice-first personal automation tool built on top of OpenWhispr. We welcome contributions!

## Quick Start

```bash
git clone https://github.com/h3qing/whisperwoof.git
cd whisperwoof
npm install
npm run compile:native    # Build native binaries (macOS Globe key, paste helpers)
npm run download:whisper-cpp  # Download Whisper STT binary
npm run build:renderer    # Build the React UI
npm start                 # Launch the app
```

## Development

```bash
npm run dev               # Dev mode with hot reload (renderer + main)
npx vitest                # Run tests in watch mode
npx vitest run            # Run tests once
npx vitest run --coverage # Run with coverage report
```

## Architecture

WhisperWoof code lives in `src/whisperwoof/` — isolated from OpenWhispr core to minimize merge conflicts.

```
src/whisperwoof/
  core/           ← Main process (strict TypeScript)
    storage/      StorageProvider interface + shared types (runtime DB in bridge/app-init.js)
    polish/       OllamaService for transcript cleanup
    router/       HotkeyRouter for destination routing
    clipboard/    ClipboardMonitor (NSPasteboard polling)
    pipeline/     Orchestrates STT → Polish → Route → Store
    plugins/      MCP plugin manager
  ui/             ← Renderer (React + TSX)
    history/      Unified voice + clipboard history view
    indicator/    Floating dog ear indicator
    settings/     WhisperWoof settings panel
    projects/     Project capture buckets
    plugins/      Plugin management UI
    command-bar/  Cmd+K text routing overlay
  bridge/         ← ONLY place that imports OpenWhispr code
    app-init.js   WhisperWoof init at startup
    ollama-bridge.js  Ollama HTTP API wrapper
    polish-presets.js  5 personality presets for text cleanup
    model-advisor.js   RAM-based model recommendations
    markdown-route.js  Voice-to-Markdown (Fn+N)
    meeting-bridge.js  Meeting transcription tracking
    file-import.js     Audio file import pipeline
    plugin-bridge.js   Plugin config persistence
```

## Key Rules

- **All WhisperWoof code in `src/whisperwoof/`** — bridge pattern for OpenWhispr imports
- **Strict TypeScript** for WhisperWoof code (`src/whisperwoof/tsconfig.json`)
- **Immutable patterns** — return new objects, never mutate inputs
- **Tests required** — 80%+ coverage target on new WhisperWoof code
- **Files < 400 lines** — extract when larger
- **Functions < 50 lines** — one job per function

## Testing

```bash
npx vitest run                          # All tests
npx vitest run --reporter=verbose       # Detailed output
node eval/run-eval.js --preset all      # Polish quality eval
```

## Branch Strategy

- `main` — stable, protected, squash-merge only
- `phase-N/description` — feature branches per phase
- CI runs tests + lint on every PR

## Adding a New Feature

1. Create files in `src/whisperwoof/core/` (main process) or `src/whisperwoof/ui/` (renderer)
2. Add IPC handlers in `src/helpers/ipcHandlers.js`
3. Expose in `preload.js`
4. Wire into `ControlPanel.tsx` / `ControlPanelSidebar.tsx` if it's a new view
5. Write tests in `*.test.ts` alongside the source
6. Update `task_plan.md` with progress

## License

MIT — see [LICENSE](LICENSE)
