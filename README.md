<p align="center">
  <img src="website/mando-sit.svg" alt="Mando — the WhisperWoof mascot" width="180">
</p>

<h1 align="center">WhisperWoof</h1>

<p align="center">
  <strong>Voice dictation for your Mac that types as you speak.</strong><br>
  Hold fn and talk. It transcribes, cleans up, and sends your words where you want them, all on your Mac.
</p>

<p align="center">
  <a href="https://github.com/h3qing/whisperwoof/releases/latest"><img src="https://img.shields.io/badge/download-v2.3.2-C87B3A?style=flat-square" alt="v2.3.2"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" alt="macOS">
  <img src="https://img.shields.io/badge/tests-1568%20passing-brightgreen?style=flat-square" alt="1568 tests passing">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="https://h3qing.github.io/WhisperWoof/">Website</a> &middot;
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

**Live typing** (Settings → Transcription → How dictation works): watch the words appear while you speak, like a phone keyboard's voice input, on one line next to Mando that slides left as you keep talking. Settled text is solid ink, the tail that may still change sits in frosted glass; on release it's re-checked by your transcription model, polished, and pasted.

```
Voice ──▶ Local speech-to-text (Whisper / Parakeet / Distil-Whisper)
              │
              ▼
         Memory swaps (mishearings you approved, e.g. "super base" → Supabase)
              │
              ▼
         Local cleanup (bundled llama-server)
         Drops filler, fixes grammar and punctuation, keeps your language
              │
              ▼
         The key you pressed decides where it goes
              │
              ├──▶ Fn         → Paste at your cursor
              ├──▶ Fn + T     → Copy to the clipboard
              ├──▶ Fn + N     → Save as a Markdown note
              ├──▶ Fn + P     → File the note under a project (Inbox by default)
              └──▶ Every dictation also lands in searchable history
```

<br>

## Features

<table>
<tr>
<td width="50%" valign="top">

### Dictation
- **Live typing** *(new in 1.18, a one-line ticker since 2.1)*: text streams in as you talk, IME-style, from a local Chinese + English streaming model (X-ASR, 134 MB). On release the whole recording is re-checked by your transcription model (or the live text is pasted as is, your choice), then cleaned up. Off by default; turn it on in Settings → Transcription.
- **Local speech-to-text**: Whisper large-v3 turbo by default (1.6 GB, many languages including Chinese), or NVIDIA Parakeet for fast English and European dictation, or Distil-Whisper for English. Nothing leaves your Mac.
- **Smart Cleanup**: a small bundled model (Qwen3.5 2B, 1.3 GB, run by llama-server) removes filler, fixes grammar, assembles spoken emails, and keeps your voice. Spoken enumerations ("第一… 第二…") become numbered lists; silent captures are dropped instead of guessed at. One click in onboarding sets it up; the prompt is yours to edit in Prompt Studio.
- **Memory**: learns names and jargon from the fixes you already make. Fix the same mishearing twice and it offers to fix it for you from then on, with every engine. It only swaps what you approve.
- **Hotkey = destination**: each Fn combination has one place it sends your words. No commands to remember, no guessing.

### Notes, clipboard & history
- **Notes & projects**: Fn+N saves a dated Markdown note to `~/Documents/WhisperWoof Notes` (change the folder in Settings; Obsidian reads it as is). Fn+P files it under a project, Inbox by default. A note links back to its recording.
- **Clipboard** *(new in 2.2)*: everything you copy, text on one side and images on the other. Click to copy again (images paste as images), save any item to Notes, pin what matters, and choose how long history is kept and how much space images may use. What password managers copy is never saved.
- **Voice history + audio playback**: tap any entry to replay the original recording. Audio Retention keeps recordings for 7 to 90 days, or stops saving them.
- **Full-text search**: SQLite FTS5 across all your voice and clipboard entries.

</td>
<td width="50%" valign="top">

### Privacy & security
- **Local-first**: dictation, cleanup, history and search run on your Mac with bundled models (whisper.cpp, sherpa-onnx, llama.cpp). No account, no upload. Cloud models (OpenAI, Anthropic, Gemini) work if you bring your own key and are off until you choose one.
- **Encryption** *(new in 2.3)*: opt-in. History, notes, recordings, clipboard images and Memory are encrypted on your Mac and unlock with Touch ID (the key lives in the Secure Enclave) or your password. A 12-word recovery phrase opens them on any Mac. No back door: lose both and the data is gone. It locks when your Mac locks or sleeps, and dictation keeps working while it's locked. Notes can stay plain Markdown if you want them in Obsidian or iCloud. ([Design](docs/design/at-rest-encryption.md).)
- **Only its own files** *(2.3.1)*: WhisperWoof reads and deletes files only inside its own folders, never an imported original, and settings import/export use their own file dialogs.
- **Graceful degradation**: no cleanup model? You still get a clean raw transcript. Selected model missing? It falls back to the best one on disk.

### Meetings *(cloud, opt-in)*
- **Transcribed live by OpenAI Realtime**, with your own OpenAI key or an OpenWhispr account. This is the one feature that sends audio off your Mac, and only when you start a meeting.
- **Noticed for you**: calendar events, meeting apps and mic activity trigger a notification, about 90 seconds ahead for scheduled meetings.
- **Long meetings keep going** *(fixed in 2.3.1)*: the session switches over before OpenAI's 30-minute limit without a gap, and reconnects after drops.
- **Crash-safe audio**: recorded to disk in 5-minute segments while you talk (encrypted when encryption is on), and deleted once the meeting ends normally.

### More
- **Cmd+K command bar**: type instead of talk, inside the app. Your text gets the same cleanup; `/note` saves it as a Markdown note, anything else goes to your history.
- **Agent mode**: voice chat with an LLM, streamed. Give it a hotkey in Settings; it uses a cloud model (Groq by default).
- **MCP plugins** *(early)*: the Plugins page sets up Todoist, TickTick, Notion, Calendar and Slack servers, and asks before any plugin command runs. Sending dictation to a plugin isn't wired up yet.
- **Glass in Mando's colors** *(new in 2.0)*: liquid glass only for what's still moving (the sidebar, menus, the dictation overlay), solid sheets for what has landed, pill-shaped controls, the rounded Nunito font, and a brown-black dark mode. Design rules live in [DESIGN.md](DESIGN.md).
- **Animated Mando**: the floating indicator is Mando himself: a head-tilt while he waits for your voice, a nod while you speak, a thoughtful chin-scratch while it's transcribed and polished, and a little hop when it lands.

</td>
</tr>
</table>

<br>

## Quick Start

**Install the app** (Apple Silicon). The easiest way is one line in Terminal. It downloads the latest release, checks its SHA-256, installs it to `/Applications` and opens it:

```bash
curl -fsSL https://raw.githubusercontent.com/h3qing/WhisperWoof/main/scripts/install.sh | bash
```

Run the same line again to update. Or grab the [latest .dmg](https://github.com/h3qing/whisperwoof/releases/latest) and drag WhisperWoof into Applications. The app isn't signed by Apple yet, so the first time you open it macOS says it can't verify it. Click **Done**, then go to **System Settings → Privacy & Security** and click **Open Anyway**. ([What signing would change](docs/release-signing.md).)

Onboarding walks you through the microphone and accessibility permissions and offers a one-click **Cleanup** step that downloads the cleanup model (Qwen3.5 2B). Skip it and you can set it up later in **Settings → Intelligence**. To encrypt your data, open **Settings → Encryption**.

**Or build from source:**

```bash
git clone https://github.com/h3qing/whisperwoof.git
cd whisperwoof
npm install
npm start
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development setup.

### Requirements

- **macOS** on Apple Silicon
- **Microphone** (built-in or external)
- **About 3 GB of disk** for the local models (transcription, cleanup, live preview). Cleanup is optional: without it you get the raw transcript.

<br>

## Design Principles

| Principle | What it means |
|---|---|
| **Hotkey = intent** | The key combo you press determines where voice goes. Explicit over magic. |
| **Local-first** | Dictation, cleanup, history and search run on your Mac. Anything that uses the cloud (meetings, agent mode, cloud models) is opt-in. |
| **Yours to lock** | Encryption is one switch away, with no back door and no account. |
| **Fork, don't reinvent** | Built on OpenWhispr's proven STT engine and Electron shell. |
| **Power users first** | Control, customization, and ownership of your tools. |

<br>

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 39 + React 19 + TypeScript + Tailwind CSS v4 |
| STT | Whisper (whisper.cpp, default, multilingual) / NVIDIA Parakeet and X-ASR (sherpa-onnx), all local |
| Cleanup | Bundled `llama-server` (llama.cpp) with Qwen3.5 2B. Cloud providers (OpenAI, Anthropic, Gemini) optional. |
| Storage | SQLite (`better-sqlite3-multiple-ciphers`) + FTS5 full-text search |
| Encryption | SQLCipher for the database, AES-256-GCM files sealed to an X25519 key, Touch ID via the Secure Enclave, scrypt for the password |
| Plugins | Model Context Protocol (MCP) |

<br>

## Roadmap

- [x] **Phase 0**: Fork + security hardening + test infrastructure
- [x] **Phase 1**: Core pipeline: storage, local cleanup, hotkey routing, history
- [x] **Phase 3**: Polish, onboarding, public release (v1.0)
- [x] **Phases 4–10**: Competitive features, AI intelligence, vibe coding, streaming, templates
- [x] **Meeting recording**: crash-safe audio buffer, Granola-style detection, long-meeting session rotation
- [x] **Agent mode**: voice-driven AI chat with streaming LLM responses
- [x] **Live typing** (1.18), **Clipboard** (2.2), **Encryption** (2.3)
- [ ] **Phase 2, MCP plugins**: the plugin servers and Plugins page are in; sending dictation to Todoist, Notion, Slack and Calendar is next
- [ ] **Distribution**: code signing, notarization, auto-update

<br>

## Credits

WhisperWoof is a fork of **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)**. We're grateful to the OpenWhispr team for building such a solid foundation.

Also built on: [OpenAI Whisper](https://github.com/openai/whisper) · [whisper.cpp](https://github.com/ggml-org/whisper.cpp) · [Distil-Whisper](https://github.com/huggingface/distil-whisper) · [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) · [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) · [llama.cpp](https://github.com/ggml-org/llama.cpp) · [SQLite3 Multiple Ciphers](https://github.com/utelle/SQLite3MultipleCiphers) · [Model Context Protocol](https://modelcontextprotocol.io/)

<br>

## Contributing

WhisperWoof is in early development. Contributions, feedback, and ideas are welcome. Please open an issue to discuss before submitting a PR, and see [CONTRIBUTING.md](CONTRIBUTING.md) to get set up.

## License

MIT, see [LICENSE](LICENSE) for details.

---

<p align="center">
  <img src="website/mando-head-side.svg" width="80" alt="Mando"><br>
  <sub>Named after Mando, who always listens.</sub><br>
  <sub>Built with care by <a href="https://github.com/h3qing">Heqing</a>.</sub>
</p>
