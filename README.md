<p align="center">
  <img src="website/mando-sit.svg" alt="Mando — the WhisperWoof mascot" width="180">
</p>

<h1 align="center">WhisperWoof</h1>

<p align="center">
  <strong>Voice-first personal automation for power users.</strong><br>
  Speak a command. It transcribes, polishes, and routes — all locally on your Mac.
</p>

<p align="center">
  <a href="https://github.com/h3qing/whisperwoof/releases/latest"><img src="https://img.shields.io/badge/download-v2.0.0-C87B3A?style=flat-square" alt="v2.0.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" alt="macOS">
  <img src="https://img.shields.io/badge/tests-1182%20passing-brightgreen?style=flat-square" alt="1182 tests passing">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="https://github.com/h3qing/whisperwoof/releases/latest">Download</a>
</p>

---

<br>

## The Problem

Voice transcription tools turn speech into text — then stop. You still copy-paste into apps, switch windows, route output manually.

The open-source world has two mature, disconnected layers:
- **Voice/STT:** OpenWhispr, Whispering, VoiceInk
- **Workflow automation:** n8n, Activepieces, Huginn

Nobody built the bridge. **WhisperWoof is that bridge.**

<br>

## How It Works

<table>
<tr>
<td width="200" align="center">
<img src="website/mando/wait.webp" width="100" alt="Mando tilting his head, waiting"><br>
<strong>1. Hold Fn</strong><br>
<sub>Mando tilts his head.<br>You're recording.</sub>
</td>
<td width="60" align="center">&#10132;</td>
<td width="200" align="center">
<img src="website/mando/review.webp" width="100" alt="Mando nodding along"><br>
<strong>2. Speak</strong><br>
<sub>Mando nods along.<br>Filler words welcome.</sub>
</td>
<td width="60" align="center">&#10132;</td>
<td width="200" align="center">
<img src="website/mando/hop.webp" width="100" alt="Mando hopping"><br>
<strong>3. Release</strong><br>
<sub>Mando hops. Clean, polished<br>text lands at your cursor.</sub>
</td>
</tr>
</table>

Hands-free: **double-tap Fn** to lock recording on, then tap once to stop and paste.

**Live typing** (Settings → Transcription → How dictation works): watch the words appear while you speak, like a phone keyboard's voice input. Settled text is solid ink, the tail that may still change sits in frosted glass; on release it's re-checked by your transcription model, polished, and pasted.

```
Voice ──▶ Local STT (Whisper / Parakeet / Distil-Whisper)
              │
              ▼
         Local LLM Polish (bundled llama-server)
         Removes filler, fixes grammar
              │
              ▼
         Hotkey-driven routing
              │
              ├──▶ Fn         → Paste polished text at cursor
              ├──▶ Fn + T     → Add to todo list
              ├──▶ Fn + N     → Save as Markdown note
              ├──▶ Fn + C     → Add to calendar
              └──▶ All entries saved to searchable history
```

<br>

## Features

<table>
<tr>
<td width="50%" valign="top">

### Core Pipeline
- **Live typing** *(new in 1.18)* — Text streams into a floating panel as you talk, IME-style, from a local Chinese + English streaming model (X-ASR, 134MB). On release the whole recording is re-checked by your transcription model (or the live text is pasted as is, your choice), then polished. Settings explain streaming vs whole-recording models side by side.
- **Local voice-to-text** — Whisper STT on your machine (multilingual incl. Chinese), or opt into NVIDIA Parakeet for faster English/European dictation. No cloud, no latency, no data leaving your laptop.
- **Smart Cleanup, on by default** — A small bundled local model (llama-server) removes filler, fixes grammar, assembles spoken emails, and keeps your voice. Spoken enumerations ("第一… 第二…") become numbered lists; silent captures are dropped instead of guessed at. Set up in one click during onboarding; tuned prompt + thinking-mode disabled for ~250ms polish. Customizable in Prompt Studio.
- **Hotkey-driven routing** — Different combos send voice to different destinations. Explicit, not magic.

### Capture & History
- **Clipboard timeline** — A condensed, card-based timeline of everything you copy: grouped by day, click to re-copy, with the source app (Messages, Chrome…) and image thumbnails.
- **Voice history + audio playback** — Tap any entry to replay the original recording.
- **Full-text search** — SQLite FTS5 across all your voice and clipboard entries.

</td>
<td width="50%" valign="top">

### Intelligence
- **Context-aware** — Detects active app. VS Code gets code style, Slack gets casual, Mail gets professional.
- **Cmd+K command bar** — Spotlight-style overlay. Type /todo, /note, /project.
- **Agent mode** — Voice-driven AI chat. Press hotkey, speak, get streamed LLM responses.

### Meeting Recording *(new)*
- **Granola-style detection** — Detects meetings via calendar + mic + process signals. Shows persistent notification.
- **Pre-meeting alerts** — Notification appears ~90s before scheduled meetings.
- **Crash-safe audio** — Audio saved to local WAV files in 5-minute segments. Never lose a meeting.
- **Transcript checkpoints** — Saved to SQLite every 60s. Survives crashes and network drops.
- **Auto-reconnect** — WebSocket reconnection with backoff + session rotation at 25 minutes.

### Local-first by design
- **Runs entirely on-device** — Bundled STT (whisper.cpp / sherpa-onnx) and a bundled local LLM (llama.cpp). No account, no cloud dependency, nothing leaves your Mac by default.
- **Cloud is opt-in** — OpenAI / Anthropic / Gemini work if you want them, behind your own keys. A privacy lock blocks all cloud access in one toggle.
- **Graceful degradation** — No reasoning model? You still get a clean raw transcript. Selected model missing? It falls back to the best one on disk.

### Privacy & Design
- **Privacy lock** — One toggle blocks ALL cloud access. Bundled local STT + local LLM only, zero network.
- **MCP plugins** — Route voice to Todoist, Notion, Slack. Any MCP server works as a plugin.
- **Glass in Mando's colors** *(new in 2.0)* — Liquid glass only for what's still moving (the sidebar, menus, the dictation overlay), solid sheets for what has landed, pill-shaped controls, the rounded Nunito font, and a brown-black dark mode. Design rules live in [DESIGN.md](DESIGN.md).
- **Animated Mando** — The floating indicator is Mando himself: a head-tilt while he waits for your voice, a nod while you speak, a thoughtful chin-scratch while it's transcribed and polished, and a little hop when it lands. (Default `full` indicator style; the `compact` and `dot` styles stay minimal.)

</td>
</tr>
</table>

<br>

## Quick Start

```bash
# Clone and run
git clone https://github.com/h3qing/whisperwoof.git
cd whisperwoof
npm install
npm start
```

**Or install the app** (Apple Silicon). The easiest way is one line in Terminal. It downloads the latest release, checks its SHA-256, installs it to `/Applications` and opens it:

```bash
curl -fsSL https://raw.githubusercontent.com/h3qing/WhisperWoof/main/scripts/install.sh | bash
```

Run the same line again to update. Or grab the [latest .dmg](https://github.com/h3qing/whisperwoof/releases/latest) and drag WhisperWoof into Applications. The app isn't signed by Apple yet, so the first time you open it macOS says it can't verify it. Click **Done**, then go to **System Settings → Privacy & Security** and click **Open Anyway**. ([What signing would change](docs/release-signing.md).)

The app bundles `llama-server` (llama.cpp) for local LLM polish — no extra install required. On first run, open **Settings → Intelligence** and download a model (Qwen 2-3B is a great default for polish on Apple Silicon).

### Requirements

- **macOS** (Apple Silicon recommended)
- **Microphone** (built-in or external)
- **A local LLM model** (optional) — downloadable from in-app Settings → Intelligence. Polish degrades gracefully to raw transcript if disabled.

<br>

## Design Principles

| Principle | What it means |
|---|---|
| **Hotkey = intent** | The key combo you press determines where voice goes. Explicit over magic. |
| **Local-first** | Everything runs on your machine. No cloud. No data leaving your device. |
| **Fork, don't reinvent** | Built on OpenWhispr's proven STT engine and Electron shell. |
| **Power users first** | Control, customization, and ownership of your tools. |

<br>

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 39 + React 19 + TypeScript + Tailwind CSS v4 |
| STT | Whisper (whisper.cpp, default — multilingual) / NVIDIA Parakeet (sherpa-onnx, opt-in — fast, English + European), both local |
| LLM Polish | Bundled `llama-server` (llama.cpp), on by default. Cloud providers (OpenAI, Anthropic, Gemini) optional. |
| Storage | SQLite + Kysely ORM + FTS5 full-text search |
| Plugins | Model Context Protocol (MCP) |

<br>

## Roadmap

- [x] **Phase 0** — Fork + security hardening + test infrastructure
- [x] **Phase 1** — Core pipeline: StorageProvider, local LLM polish, hotkey routing, features
- [x] **Phase 2** — MCP plugin system (Todoist, Notion, Slack, Calendar)
- [x] **Phase 3** — Polish, onboarding, public release (v1.0)
- [x] **Phases 4–10** — Competitive features, AI intelligence, vibe coding, streaming, templates
- [x] **Meeting recording** — Crash-safe audio buffer, transcript checkpoints, Granola-style detection
- [x] **Agent mode** — Voice-driven AI chat with streaming LLM responses
- [ ] **Distribution** — Code signing, notarization, auto-update

<br>

## Credits

WhisperWoof is a fork of **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)** — we're grateful to the OpenWhispr team for building such a solid foundation.

Also built on: [OpenAI Whisper](https://github.com/openai/whisper) · [Distil-Whisper](https://github.com/huggingface/distil-whisper) · [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) · [llama.cpp](https://github.com/ggml-org/llama.cpp) · [Model Context Protocol](https://modelcontextprotocol.io/)

<br>

## Contributing

WhisperWoof is in early development. Contributions, feedback, and ideas are welcome — please open an issue to discuss before submitting a PR.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <img src="website/mando-head-side.svg" width="80" alt="Mando"><br>
  <sub>Named after Mando, who always listens.</sub><br>
  <sub>Built with care by <a href="https://github.com/h3qing">Heqing</a>.</sub>
</p>
