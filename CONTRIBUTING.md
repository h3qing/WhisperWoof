# Contributing to WhisperWoof

WhisperWoof is a voice-first personal automation tool built on top of OpenWhispr. We welcome contributions!

## Quick Start

```bash
git clone https://github.com/h3qing/whisperwoof.git
cd whisperwoof
npm install
npm run compile:native    # Build native binaries (Globe key, paste, text monitor, vault helper)
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
node scripts/build-mando-sprites.js [path/to/Mando-assets-v6]  # Rebuild Mando spritesheets from the gitignored source pack (needs ffmpeg, cwebp, img2webp)
node scripts/build-app-icon.js  # Rebuild the app icon (PNG/ICNS/ICO) from src/assets/logo.svg (macOS; needs Google Chrome, sips, iconutil)
```

## Architecture

WhisperWoof code lives in `src/whisperwoof/` — isolated from OpenWhispr core to minimize merge conflicts.

```
src/whisperwoof/
  core/             ← Main-process logic and its tests (strict TypeScript)
    storage/        StorageProvider interface + shared types (runtime DB in bridge/app-init.js)
    polish/         Dictation formatting tests (cleanup itself is OpenWhispr's ReasoningService)
    router/         Hotkey → destination routing
    clipboard/      Clipboard monitor rules (the monitor runs in bridge/app-init.js)
    live/           Live typing plan (streaming preview vs whole-recording pass)
    vocabulary/     Memory swaps and speech-to-text hints
    vault/          Encryption tests (the code is in bridge/vault/)
    pipeline/       Orchestrates STT → Polish → Route → Store
    plugins/        MCP plugin manager
  ui/               ← Renderer (React + TSX)
    home/           Home summary and activity heatmap
    history/        Unified voice + clipboard history view
    notes/          Notes view
    smart-clipboard/ Clipboard view (text | images)
    memory/         Memory view (learned words, approved swaps)
    indicator/      MandoSprite (animated Mando), live typing panel, cancel button, meeting pill; indicator shell is src/App.jsx
    settings/       WhisperWoof settings sections
    vault/          Encryption settings, lock screen, Home offer
    plugins/        Plugin management UI
    command-bar/    Cmd+K text routing overlay
  bridge/           ← ONLY place that imports OpenWhispr code
    app-init.js     WhisperWoof init at startup: database, clipboard monitor
    app-files.js    Path checks: the app only reads and deletes inside its own folders
    vault/          At-rest encryption: keys, encrypted files, keyed DB, sealed inbox, migrations
    vocabulary.js   Memory (learned words, corrections, swaps)
    markdown-route.js  Voice-to-Markdown (Fn+N)
    project-notes.js   Notes filed under projects (Fn+P)
    clipboard-store.js Clipboard view backend (copy back, save to note, retention)
    meeting-bridge.js  Meeting transcription tracking
    file-import.js     Audio file import pipeline
    plugin-bridge.js   Plugin config persistence
    settings-export.js Settings export/import (native file dialogs)
```

## Key Rules

- **All WhisperWoof code in `src/whisperwoof/`** — bridge pattern for OpenWhispr imports
- **Strict TypeScript** for WhisperWoof code (`src/whisperwoof/tsconfig.json`)
- **Immutable patterns** — return new objects, never mutate inputs
- **Tests required** — 80%+ coverage target on new WhisperWoof code
- **Files < 400 lines** — extract when larger
- **Functions < 50 lines** — one job per function
- **Visual changes follow [DESIGN.md](DESIGN.md)** — colors, fonts, glass vs sheets, controls
- **Encryption-aware storage** — read and write user files through `bridge/vault/vault-files.js` and open the database through `vault-db.js`; code that runs at startup or on a timer must cope with a locked (closed) database. See [the design](docs/design/at-rest-encryption.md).

## Testing

```bash
npx vitest run                          # All tests
npx vitest run --reporter=verbose       # Detailed output
node eval/run-polish-eval.js            # Cleanup prompt eval (needs a local model server; see the file header)
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
