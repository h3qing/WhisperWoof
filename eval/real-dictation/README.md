# Real-dictation bench

Which speech model and which cleanup model work best on **your own**
dictations, judged by you, blind. Earlier benches used TTS audio or references
adjudicated from model consensus; here the reference is what you say you said.

Everything private stays outside the repo in
`~/.whisperwoof-bench/<set>/` (audio, transcripts, your ratings). Only aggregate
numbers go into the repo.

## 1. Export recent dictations

```bash
node eval/real-dictation/export_clips.js --out ~/.whisperwoof-bench/dictation-real-1 --limit 200
```

Opens the vault with Touch ID (a "WhisperWoof is trying to unlock" prompt; no
password is read), reads the most recent dictations that kept their audio
(1.5–60 s), and writes 16 kHz mono WAVs (the app's `convertToWav` format) plus
`manifest.json` with what the app produced at the time. It needs
`better-sqlite3-multiple-ciphers` (pass `--sqlite <path>` if `node_modules`
lacks it) and the installed app's Touch ID helper.

## 2. Run the models

ASR, through the app's own servers (renamed copies, see
`eval/meeting-bench/README.md`):

```bash
node eval/real-dictation/run_models.js --data ~/.whisperwoof-bench/dictation-real-1 \
  --bin-dir <renamed servers> --bench-models <sherpa models> \
  --engines whisper-turbo,sense-voice,x-asr-160,x-asr-480,firered-asr2=firered-aed@sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26,x-asr-offline=xasr-offline@sherpa-onnx-x-asr-zipformer-transducer-zh-en-punct-int8-2026-06-03
```

Models the app can't run yet, through mlx-audio on the Apple GPU:

```bash
pip install mlx-audio==0.6.3
python eval/real-dictation/run_mlx.py --data ~/.whisperwoof-bench/dictation-real-1 --name qwen3-asr-1.7b --model mlx-community/Qwen3-ASR-1.7B-8bit
```

Audio models served by llama-server (≥ b9169 for Qwen3-ASR; a renamed copy,
started with `--cache-ram 0`):

```bash
bench-llama-asr -m Qwen3-ASR-1.7B-Q8_0.gguf --mmproj mmproj-Qwen3-ASR-1.7B-Q8_0.gguf \
  --host 127.0.0.1 --port 8342 -c 8192 -np 1 --cache-ram 0
node eval/real-dictation/run_llama_asr.js --data ~/.whisperwoof-bench/dictation-real-1 \
  --url http://127.0.0.1:8342 --name qwen3-asr-1.7b-llama-chat --model Qwen3-ASR-1.7B-Q8_0 \
  --runtime "llama.cpp b12032" --mode chat
```

Or the app's own speech server (bundled llama-server, the app's flags, noise
checks and Chinese number normalization; model from the app's cache, i.e.
downloaded in Settings → Transcription → Qwen3-ASR):

```bash
node eval/real-dictation/run_llama_asr.js --data ~/.whisperwoof-bench/dictation-real-1 \
  --app-model qwen3-asr-1.7b --name qwen3-asr-1.7b-app --runtime "llama.cpp b12032 (app)"
```

Cleanup models, through the app's llama-server (or `mlx_lm.server` for
models it can't load), with the production prompt and sampling:

```bash
node eval/real-dictation/run_polish.js --data ~/.whisperwoof-bench/dictation-real-1 \
  --llama-url http://127.0.0.1:8341 --name qwen3.5-2b --input whisper-turbo
```

`--app-model <model>.gguf` instead of `--llama-url` starts the app's own
cleanup server for the run.

Every engine writes `hyps/<name>.json` (cleanups: `polish/<name>.json`); a
clip already done is skipped, so models can be added later.

## 3. Rate

```bash
node eval/real-dictation/rate_server.js --data ~/.whisperwoof-bench/dictation-real-1
```

Opens on http://127.0.0.1:8765 (local only).

- **Rate**: hear the clip; the transcript shows the spots where the models
  disagree; press 1–9 to pick what you said at each spot, fix anything left
  in the box, Enter. Which model wrote what is never shown. Clips where every
  model wrote the same thing are left out by default.
- **Cleanup**: the same transcript cleaned up by each LLM; pick the best, flag
  any that changed your meaning.
- **Results**: mistakes per 100 words/characters (Chinese per character,
  English per word, punctuation and 嗯/呃/um ignored) against your text,
  share of clips exactly right, text typed on clips you marked "No speech",
  decode time; cleanup picks, meaning changes, translations.

`node eval/real-dictation/score.js --data <set>` prints the ASR table as
markdown.
