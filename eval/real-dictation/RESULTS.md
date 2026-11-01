# Real-dictation results

Numbers only; transcripts, audio and ratings stay in `~/.whisperwoof-bench/`.

## dictation-real-1 (2026-11-01)

200 most recent production dictations (Oct 16–28, 41 min, all transcribed by
local Whisper turbo at the time). The owner rated 20 (11 Chinese, 9 Chinese
with English; 870 reference tokens). Machine: Apple M5 Pro.

Mistakes = substitutions + deletions + insertions against the owner's text
(Chinese per character, English per word, punctuation and 嗯/呃/um ignored).
"Better/worse" counts clips against Whisper turbo; the interval is a 90 %
paired bootstrap of the difference in total mistakes.

| engine | runtime | mistakes (20 clips) | no-number clips (17) | better/same/worse | difference [90 %] | decode p50 |
|---|---|---|---|---|---|---|
| Qwen3-ASR 1.7B 8-bit | mlx-audio 0.6.3 (GPU) | 33 (3.8 %) | 19 | 8/9/3 | −20 [−44, 2] | 292 ms |
| Qwen3-ASR 1.7B Q8_0 | llama.cpp b12032 (GPU) | 42 | 28 | 7/9/4 | −11 [−31, 8] | 284 ms |
| Qwen3-ASR 0.6B Q8_0 | llama.cpp b12032 (GPU) | 42 | 21 | 7/7/6 | −11 [−36, 12] | 151 ms |
| Qwen3-ASR 0.6B 8-bit | mlx-audio 0.6.3 (GPU) | 43 | 22 | 7/8/5 | −10 [−34, 12] | 134 ms |
| MiMo-V2.5-ASR 8-bit | mlx-audio 0.6.3 (GPU) | 47 | 31 | 8/6/6 | −6 | 1195 ms |
| SenseVoice | sherpa-onnx 1.13.4 | 48 | 40 | 6/7/7 | −5 | 292 ms |
| **Whisper turbo** (app default) | whisper.cpp | 53 (6.1 %) | 37 | – | – | 832 ms |
| Qwen3-ASR 0.6B int8 | sherpa-onnx 2.0.1 | 53 | 29 | 6/9/5 | 0 [−18, 18] | 650 ms |
| Ming-3.0 ASR tiny 4-bit | mlx-audio 0.6.3 (GPU) | 56 | 34 | 5/9/6 | +3 | 307 ms |
| Qwen3-ASR 0.6B int8 | sherpa-onnx 1.13.4 | 58 | 30 | 6/8/6 | +5 | 1233 ms |
| FireRedASR2 AED | sherpa-onnx 1.13.4 | 59 | 38 | 7/4/9 | +6 | 3759 ms |
| what the app typed then (Whisper turbo + Memory/Dictionary hints) | – | 59 | 44 | 5/11/4 | +6 [−6, 19] | – |
| X-ASR 480 ms (streaming) | sherpa-onnx 1.13.4 | 61 | 39 | 8/3/9 | +8 | streams |
| X-ASR 160 ms (streaming) | sherpa-onnx 1.13.4 | 62 | 41 | 7/6/7 | +9 | streams |
| X-ASR offline | sherpa-onnx 1.13.4 | 62 | 37 | 5/5/10 | +9 | 110 ms |

- Qwen3-ASR 1.7B is the only engine close to a clear win (about half Whisper
  turbo's mistakes on clips without numbers). Several of its remaining
  mistakes are number format (Chinese numerals where the owner wrote digits),
  which inverse text normalization would fix.
- Whisper turbo's mistakes are mostly real mishearings (行→先, 期→息, 效→消) and
  dropped words (19 deletions vs 1 for Qwen3-ASR 1.7B).
- llama.cpp ≥ b9169 runs Qwen3-ASR about as well as MLX (next section); the
  bundled b9038 decodes it to nonsense.
- English accuracy can't be ranked from this set: 33 English words, mostly
  names (product names, people).

### Qwen3-ASR in the app's runtimes

Same clips, renamed copies of servers built from source (`run_llama_asr.js`
for llama-server). Memory = peak macOS footprint (Activity Monitor's
"Memory").

- **llama.cpp: fixed since b9169** (2026-05-15, ggml-org/llama.cpp#23073:
  Qwen3-ASR audio preprocessing and 30 s chunking). The bundled b9038
  (2026-05-06) predates it. b9169 and b12032 (latest) write identical text;
  ggml-org's GGUFs work as published, and bf16 scores the same as Q8_0.
- **llama.cpp 1.7B Q8_0 ≈ MLX 1.7B.** On the 180 unrated clips it differs
  from MLX's text on 1.0 % of tokens (llama.cpp 0.6B: 2.5 %, Whisper turbo:
  6.4 %). The 9 extra mistakes on the rated clips: 6 are one clip where it
  spelled "APP"/"ADV" as "A P P"/"A D V" (MLX spells letters on another clip,
  where the owner also spelled them out), the rest come from two mishearings.
  No pattern by clip length. Decode p50 284 ms; 1.5 GB plus 2.5 GB of model
  files, memory-mapped (MLX: 4.8 GB). Chat completions with the audio alone
  scored 42, `/v1/audio/transcriptions` 44 (it adds "Transcribe audio to
  text" to the turn). Both return `language Chinese<asr_text>…`; strip it.
- **llama-server needs `--cache-ram 0`**: its default 8 GB prompt cache took
  the process to 12 GB over 400 dictations.
- **sherpa-onnx 2.0.1** (the loopback patch applies unchanged, builds):
  Qwen3-ASR 0.6B int8 goes from 58 to 53 mistakes and from 1.2 s to 0.65 s,
  but only ties Whisper; 3.4 GB. Its text differs from MLX 0.6B's on 66 of
  200 clips (llama.cpp 0.6B: 24), so the int8 export, not the frontend, is
  the likely gap. Only 0.6B int8 is published.
- **Numbers**: Qwen3-ASR writes Chinese numerals where the owner typed
  digits (e.g. 三十一 for 31). On the 3 rated clips with digits llama.cpp 1.7B
  makes 14 mistakes (MLX also 14,
  Whisper 16), so without inverse text normalization the gain is on clips
  without numbers only: 28 vs Whisper's 37 here, 19 for MLX.

**Recommendation**: ship Qwen3-ASR 1.7B through llama-server, not
sherpa-onnx. That means bumping the bundled llama.cpp from b9038 to b12032,
re-running the cleanup bench on it, serving the ASR model from a second
llama-server (`--mmproj`, `-c 8192 -np 1 --cache-ram 0`), and adding Chinese
inverse text normalization (digits, dates, percentages) before it replaces
Whisper turbo as the default for Chinese. Not tested here: silent clips (no
rated clip was silent) and Memory/Dictionary hints, which Qwen3-ASR takes as
context in the system turn.

### Cleanup (same Whisper turbo input, production prompt and sampling)

Not rated blind. Distance = edit distance from the owner's text on the 20
rated clips (Whisper input alone: 6.1 %); translations over all 200 clips.

| model | file | distance | English translated into Chinese | p50 |
|---|---|---|---|---|
| Gemma 4 E4B Q4_0 | 4.6 GB | 8.9 % | 0 | 431 ms |
| **Qwen3.5-2B Q4_K_M** (app default) | 1.3 GB | 10.0 % | 2 (one changed the meaning) | 367 ms |
| Qwen3.5-4B Q4_K_M | 2.7 GB | 26.0 % (rewrites) | 2 | 843 ms |

The prompt already says never to translate; Qwen3.5-2B still does it on ~1 %
of clips. MiniCPM5-2B was dropped after the dev-clip round (barely cleaned up,
changed a pronoun) and needs a newer llama.cpp.
