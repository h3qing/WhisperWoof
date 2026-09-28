# Local meeting transcription: design proposal

Status: **draft, spike measured 2026-09-26/27** (bench-a: 3 engines × 6 cut plans, then 11 local models). Scope: recording and transcription only; how a meeting gets triggered (calendar, detection, hotkey) is out of scope. macOS only.

## 1. In one paragraph

Meetings are recorded the way they are today: your mic ("Me") and the Mac's audio output ("Them", Core Audio tap) as two separate tracks, kept in rotating clips on disk. What changes is who transcribes them: instead of streaming both tracks to OpenAI Realtime, every clip that closes (about every 2 minutes, at a pause) goes to a local model in the background, and its lines are added to the meeting note with their times. When you stop, only the last clip is left, so the whole transcript is ready a few seconds later. Nothing leaves the Mac, a crash loses at most the clip in progress, and there is no 30-minute session limit to work around.

## 2. Decisions from the owner (2026-09-26)

- Meetings transcribe with a **local model**; being local-first is the product's goal.
- Focus on **recording**, not on how a meeting is triggered.
- Record in **2–5 minute clips** so each piece of work is small and can be processed asynchronously.

## 3. What was measured

Recording: a 10.8-minute two-person conversation, mostly Mandarin with English product and company names and finance terms, one mixed track (16 kHz mp3), provided by the owner with a timestamped transcript from another transcription service. That transcript has its own mistakes, so it is a "silver" reference: error rates below overstate the real error. Machine: Apple M5 Pro. Engines run through the app's own server binaries (whisper-server, sherpa-onnx websocket servers, v1.13.4) with the app's arguments. Bench: `eval/meeting-bench/run_clips.js`.

**Mixed error rate (MER, same tokenizer as `eval/dictation-bench`), by engine and cut plan:**

| cut plan | x-asr-480 (streaming zh/en) | whisper-turbo (Metal) | SenseVoice |
|---|---|---|---|
| whole file, one piece | 17.6% | 25.4% | 16.3% |
| fixed 2-minute cuts | 17.8% | 26.1% | 16.1% |
| 2 minutes, then the first pause below the fixed VAD threshold | 17.5% | 24.7% | **15.5%** |
| **2 minutes, then the quietest 400 ms in the next 20 s ("lull")** | 17.5% | 26.2% | **15.6%** |
| lull, 1-minute clips | 17.5% | | 16.1% |
| lull, 5-minute clips | 17.3% | | 16.1% |

SenseVoice is an offline model: every row (including "whole file") feeds it pieces of at most 20 s, each ending at the quietest 300 ms between 12 and 20 s.

**Speed:** SenseVoice (CPU, 4 threads) and x-asr-480 both run at RTF 0.03 (the whole 10.8 minutes in about 20 s); whisper-turbo about the same on Metal. Two 2-minute clips, one per track, decode in **5.7 s in parallel with SenseVoice** (6.7 s one after the other; x-asr: 5.2 s / 6.8 s): a meeting keeps the machine about 5% busy in the background.

**What the numbers say:**

1. **Cutting into clips costs nothing** with a streaming model. x-asr gives the same result whole or in 1-, 2- or 5-minute clips. Clip length can be chosen for freshness, not accuracy.
2. **Fixed cuts split sentences; lull cuts don't.** No characters were lost at fixed cuts (x-asr's 1 s end padding covers the seam), but each fixed cut landed mid-clause. Lull cuts land between phrases.
3. **The app's fixed silence threshold (RMS 0.01) doesn't find pauses in real rooms.** This recording's noise floor is 0.009–0.011, so only 8% of frames counted as silent and 2 of 5 cuts found no pause at all. The lull rule has no threshold, so it doesn't depend on the room or the mic.
4. **SenseVoice is the most accurate, Whisper is out.** SenseVoice is about 2 points better than x-asr at the same speed, which matches the dictation bench (it was best on real human zh/en there too). Whisper is 9–10 points worse than SenseVoice on this speech and swings with where the cuts land.
5. **Most of the remaining "error" isn't content.** Of the 461 edits against the reference, many are repeated fillers the reference keeps and the model collapses (很很很, 呃呃, 就是就是), and several are mistakes in the reference. The real weak spot is **proper nouns: company, product and ticker names**, which every model gets wrong in places (so does the reference): that is what Memory and Word Packs have to fix.
6. **Both local engines return timing.** SenseVoice's reply (offline server) carries per-token `timestamps` and `durations`, the detected language, an `event` tag (e.g. laughter, music) and token log-probabilities; x-asr's committed segments carry `start_time` plus per-token `timestamps`. Lines from the two tracks can be put on one timeline to the word, without a separate VAD. The app drops all of this today (`parseOfflineMessage` keeps only `text`).

### 3.1 Every open local model the app's runtime can run (bench-a)

The recording above is now **bench-a** in `eval/meeting-bench` (described in `benches.json`, audio and reference kept outside the repo); every run is kept in `eval/meeting-bench/results/history.jsonl` and summarized in `RESULTS.md`. On 2026-09-27 it was run against every current Mandarin-capable model in the k2-fsa sherpa-onnx release that the app's bundled sherpa-onnx 1.13.4 server can load, all with 2-minute lull clips, the same ≤20 s pieces and 4 threads:

| model | from | MER | RTF | notes |
|---|---|---|---|---|
| **FireRedASR2 AED zh_en** int8 (2026-02) | Xiaohongshu | **13.3%** | 0.455 | Best by 2.3 points: fewest wrong and dropped words. Slow: 8 threads 0.399, 12 threads 0.421, its decoder is sequential |
| **SenseVoice** zh-en int8 (2024-07, the app's) | Alibaba | 15.6% | 0.030 | Per-token times, language, events |
| **x-asr zipformer zh-en + punct** int8 (2026-06, offline) | k2 / X-ASR | 15.8% | **0.013** | Fastest; 131 MB; punctuation built in |
| FireRedASR2 CTC zh_en int8 | Xiaohongshu | 17.0% | 0.203 | |
| x-asr-480 streaming (the app's live typing model) | k2 / X-ASR | 17.5% | 0.027 | |
| Qwen3-ASR 0.6B int8 (2026-03) | Alibaba Qwen | 19.1% | 0.136 | LLM decoder; takes hotwords |
| SenseVoice int8 **2025-09** | Alibaba | 20.6% | 0.033 | A regression on this speech: more wrong words, stray English |
| Fun-ASR-Nano int8 (2025-12) | Alibaba Tongyi | 22.1% | 0.127 | LLM decoder adds words that weren't said (3× SenseVoice's insertions); takes hotwords |
| whisper large-v3-turbo | OpenAI | 25.8% | 0.031 | |
| Paraformer zh int8 (2025-10) | Alibaba DAMO | 27.8% | 0.024 | Chinese only; English terms and casual speech hurt |
| Dolphin small CTC int8 | DataoceanAI | 31.2% | 0.041 | Drops many words |

Every result reproduced exactly on a second full run.

Models on Hugging Face that the app's runtime can't load yet (PyTorch, MLX or GGUF only) were surveyed but not run: Qwen3-ASR-1.7B (vendor-reported WenetSpeech meeting 5.88, the best stated), GLM-ASR-Nano, Kimi-Audio-7B, FireRedASR2-LLM (8B), Belle-whisper-large-v3-zh. Given how the 0.6B Qwen3-ASR did here, the 1.7B is worth one test through its MLX port only if the two-tier design below falls short.

**What this means for the design:**

- **Two tiers.** A fast model transcribes each clip as it closes (SenseVoice or the offline x-asr, 15.6–15.8%, RTF 0.013–0.03). An optional **final pass** re-transcribes the meeting with FireRedASR2 AED (13.3%) after it ends and replaces the text. At RTF ~0.4 that is about 50 minutes of CPU for an hour-long, two-track meeting, less when silent stretches are skipped, so it runs in the background, preferably on power, and can be turned off.
- **Fast tier: SenseVoice now, offline x-asr as the candidate.** They tie on accuracy; x-asr is 2.3× faster and smaller, SenseVoice is already shipped and its timing output is verified. Decide on bench-b (a real two-track meeting).
- **Newer isn't better.** SenseVoice 2025-09 lost 5 points to the 2024-07 release on this speech; the app should stay on 2024-07. Every model change goes through the bench.
- **The LLM-based models aren't worth it for general accuracy here**; their only draw is hotwords, which needs a fair test with the owner's own vocabulary (tickers, company and product names) and a proper-noun score, not just MER against a reference that itself misspells them.

## 4. Design

### 4.1 Recording

- **Two tracks, as today.** Mic from the renderer, system audio from the native tap (macOS 14.2+). They stay separate files; the track *is* the speaker label (Me / Them).
- **Clips close at a lull.** A clip closes at the quietest 400 ms in the 20 s after it reaches its target length (default 2 minutes, so clips run 2:00–2:20). Each track cuts on its own.
- **Record at 16 kHz** when the local model transcribes (today's 24 kHz exists for OpenAI Realtime). Half the disk, no resampling step.
- **A manifest per meeting** (`manifest.json` next to the clips): for each clip, track, index, wall-clock start, sample count, and state (`recording` / `queued` / `done` / `failed`). It is the source of truth for the queue and for crash recovery.
- **Encryption unchanged.** With encryption on, clips are sealed streams (`.pcm.wwenc`, public key only, so recording works while locked), as since v2.3.0. The manifest holds no content.

### 4.2 Transcription queue

- **A clip is queued the moment it closes.** One worker in the main process takes clips in order and runs at most two decodes at a time (one per track).
- **Dictation first.** The worker pauses while you dictate, so meeting work never adds latency to Fn.
- **Engine (fast tier): SenseVoice through the existing offline server** (`ParakeetServerManager.wsServer`, `sense-voice-zh-en`, language auto, ITN on, as dictation runs it). Each clip is split into ≤20 s pieces at the quietest 300 ms between 12 and 20 s (the bench's `splitAtLulls`), and each piece's token timestamps are offset by where the piece starts. Fallback when SenseVoice isn't downloaded: x-asr-480 through the online server (`streamServer`, which live typing already runs), no pre-splitting. The meeting setting offers the downloaded one and asks to download SenseVoice (155 MB) the first time.
- **Final pass (optional, after the meeting):** FireRedASR2 AED (`--fire-red-asr-encoder/--fire-red-asr-decoder`, 800 MB int8 download) over the same clips' speech, at low priority; its lines replace the fast tier's per clip when done. Off by default until bench-b confirms the gain on two-track audio.
- **Keep what the server returns.** A meeting-specific reply parser keeps `timestamps`, `durations`, `lang`, `event` and the log-probabilities, where dictation's `parseOfflineMessage` keeps only the text.
- **Reading a clip:** open in memory (decrypt with the vault key if sealed; a locked vault means clips wait in the queue until unlock), stream to the server, never write plaintext to disk.
- **Output:** lines `{ track, start (meeting time), end, text, confidence }` saved to the meeting's note (the encrypted database when encryption is on), and pushed to the renderer, so the note fills in clip by clip.

### 4.3 Putting the transcript together

- **One timeline.** A line's time is the clip's start plus the segment's `start_time`. Me and Them lines interleave by time.
- **Echo.** Without headphones the mic also hears the other side through the speakers, so their words appear twice (Them, and again as Me). Drop a Me line that repeats a Them line within about 2 s. This needs a two-track recording to tune (section 6).
- **Memory swaps** (`memory-replacements.js`) apply to each line, as for dictation: the only lever for tickers and names on sherpa engines.
- **At stop:** the open clips close immediately and go to the front of the queue. The transcript is final when the queue for that meeting is empty.

### 4.4 Crash recovery

On launch, any meeting whose manifest has clips not `done` gets them queued again. A crash loses at most the clip being written (up to about 2 minutes of audio; the sealed format already recovers everything up to the last full second). This replaces the transcript checkpoint, which today never starts.

### 4.5 What goes away

For a local meeting: the OpenAI Realtime sockets, token fetches, 25-minute session rotation and reconnect logic. OpenAI Realtime stays available as an opt-in cloud option at first, so nothing is removed in the same change.

## 5. Build order

1. **Clip writer:** lull cuts, 16 kHz, manifest, per track (pure cut logic with unit tests; the bench's `planClips` "lull" rule is the reference).
2. **Queue and worker:** SenseVoice through the offline server (x-asr fallback), lull splitting, dictation priority, sealed clips, crash recovery.
3. **Timeline and echo filter** (pure, unit-tested), Memory swaps per line.
4. **Note UI:** lines appear per clip, "finishing transcript…" after stop, Me/Them labels.
5. **Setting:** meetings transcribe locally by default; OpenAI Realtime as an option.

## 6. Still to measure

- **bench-b: a real two-track meeting** (the app's own `mic-*` / `system-*` clips) with a rough transcript: echo removal, Me/Them order, and SenseVoice vs offline x-asr for the fast tier.
- **Hotwords** on Qwen3-ASR and Fun-ASR-Nano with the owner's vocabulary, scored on the names and tickers themselves.
- **Fine-tuning** needs tens of hours of transcribed audio of the owner's own meetings (and a GPU); one 11-minute bench can only test, not train. Collecting corrected meeting transcripts, with consent, is the step before any training.

- **Echo and Me/Them** need a two-track recording: a real meeting's `mic-*` and `system-*` clips (the app keeps them in `$TMPDIR/meeting-audio-<id>/`) plus a rough transcript.
- **In-room meetings** (one mic, several people) have no track per speaker; that needs diarization (a sherpa-onnx diarization binary is already downloaded but unused). Out of scope for v1.
- **Hotwords for x-asr:** the transducer may accept a hotwords file with modified beam search, which would help tickers and names at decode time. Parakeet TDT ignores it (measured in v1.22.0); x-asr is untested.
