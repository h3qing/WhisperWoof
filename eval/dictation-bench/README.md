# Dictation bench — zh/en code-switching

Measures what the dictation path actually produces, on the exact audio
whisper.cpp receives in the real app.

## Why this exists

The 758-test Vitest suite covers `src/whisperwoof/core/` side-features and
touches none of the dictation path (`audioManager.js`, `ipcHandlers.js`,
`whisper.js`, `useAudioRecording.js`). This bench closes that gap for the
one thing dictation must get right: the text.

## Pipeline fidelity

The bench replicates the real capture path rather than feeding clean WAVs:

```
TTS (vits-melo-tts-zh_en)
  -> webm/opus, stereo          # MediaRecorder — audioManager.js:241,357
  -> ffmpeg -ar 16000 -ac 1 -c:a pcm_s16le
                                # ffmpegUtils.convertToWav — ffmpegUtils.js:110
  -> ASR
```

`real_audio_check.py` re-runs the two decisive cases on **human** recordings
shipped with the models, so no conclusion rests on TTS artifacts.

## Metric

Mixed Error Rate: Chinese scored per character, English per word,
punctuation ignored. `cs*` cases are code-switching, `zh*`/`en*` are
single-language controls.

## Running

```bash
pip3 install sherpa-onnx soundfile numpy
# models -> ../models/ from github.com/k2-fsa/sherpa-onnx releases
python3 gen_tts.py                       # corpus.json -> raw/*.wav
./make_pipeline_audio.sh                 # raw -> webm -> wav16k
python3 run_asr.py whisper-small:auto whisper-turbo:auto sensevoice:auto
python3 real_audio_check.py              # TTS-free control
```

Config syntax: `whisper-<size>[-fp32][:<lang>]` or `sensevoice[:<lang>]`.
Omitting `:<lang>` means auto-detect — what the app does today, since
`preferredLanguage` defaults to `"auto"` (settingsStore.ts:281).

## Results (2026-08-22, 4 vCPU, int8 unless noted)

| config | MER | code-switch MER | RTF |
|---|---|---|---|
| sensevoice:auto | **17.3%** | **18.6%** | **0.085** |
| whisper-turbo:auto | 24.8% | 25.1% | 0.315 |
| whisper-small-fp32:auto | 32.9% | 35.0% | 0.842 |
| whisper-small:auto *(app default)* | 34.9% | 34.9% | 0.633 |
| whisper-small:zh | 42.4% | 34.9% | 0.386 |
| whisper-small:en | 89.8% | 93.5% | 0.337 |

RTF is 4-vCPU CPU-only and does not predict Metal performance; the MER
column is hardware-independent and is the point of this table.

2026-08-23 follow-up: SenseVoice re-measured through the app's REAL engine
path (ParakeetServerManager -> sherpa-onnx-offline-websocket-server v1.13.4,
int8, silence gate + WS protocol included): **MER 20.0%, RTF 0.063** over the
same 14 cases — still well ahead of whisper-turbo's 24.8% at ~5x the speed.
The Nemotron 3.5 online streaming path was verified the same way: partials
stream progressively (9 partials over a 6s utterance) and the committed final
arrives without truncation.

### Findings

1. **`language=en` translates instead of transcribing.** "帮我把这个 pull
   request 的 description 写一下" comes back as "Help me write this poor
   request description." On real human zh audio it emits
   `(speaking in foreign language)`.

2. **`language=zh` destroys English.** Real human en audio decodes as
   "他叫了一位的长,然后给他送了一块水果和50块水果。" One synthetic case
   entered a repetition loop (MER 125%).

3. **`whisper-small:auto` emits Traditional Chinese.** Real human audio:
   `開放時間早上9點至下午5點`. `whisper-turbo:auto` gets it right
   (`开放时间早上9点至下午5点`). No 繁→简 normalization exists anywhere in
   the codebase, and `getBaseLanguageCode` (languageSupport.ts:33) collapses
   `zh-CN`/`zh-TW` to `zh`, discarding the only signal that could fix it.

4. **Quantization is not the cause.** fp32 vs int8 on the same model differs
   by 2 points (32.9% vs 34.9%), so the gap to turbo/SenseVoice is the model,
   not the precision. The app ships F16 GGML, above both.

5. **The default model is the weakest option tested.** `whisperModel`
   defaults to `"small"` (settingsStore.ts:269); turbo is 10 points better
   and fixes the script bug.
