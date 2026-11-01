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
| Qwen3-ASR 0.6B 8-bit | mlx-audio 0.6.3 (GPU) | 43 | 22 | 7/8/5 | −10 [−34, 12] | 134 ms |
| MiMo-V2.5-ASR 8-bit | mlx-audio 0.6.3 (GPU) | 47 | 31 | 8/6/6 | −6 | 1195 ms |
| SenseVoice | sherpa-onnx 1.13.4 | 48 | 40 | 6/7/7 | −5 | 292 ms |
| **Whisper turbo** (app default) | whisper.cpp | 53 (6.1 %) | 37 | – | – | 832 ms |
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
- The app's runtimes can't deliver Qwen3-ASR yet: llama-server b9038 decodes
  it to nonsense, and sherpa-onnx 1.13.4's version is worse than Whisper here
  (1.13.7 fixed a feature-alignment bug in its Qwen3-ASR frontend; untested).
- English accuracy can't be ranked from this set: 33 English words, mostly
  names (product names, people).

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
