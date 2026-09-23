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

## Live dictation: streaming vs two-pass (2026-09-23)

Question: in live-dictation mode a streaming model shows the preview while the
user speaks. When the hotkey is released, which pass should produce the final text?
**A** = the streaming model's own final, **B** = SenseVoice re-decodes the full
audio, **C** = whisper.cpp large-v3-turbo re-decodes the full audio.

```bash
python3.11 -m venv ../.venv && ../.venv/bin/pip install sherpa-onnx soundfile numpy psutil
../.venv/bin/python run_streaming.py --polish            # corpus + human controls
../.venv/bin/python run_streaming.py --no-offline --tail-pad 1.0
../.venv/bin/python run_streaming.py --mem
```

`run_streaming.py` feeds each wav in 100ms chunks (accept_waveform, then decode
while ready) and logs every partial with its audio timestamp. It then adds 0.6s
of zero tail padding (`ONLINE_END_TAIL_PADDING_S`) and calls input_finished. The
streaming model is x-asr (zipformer2 transducer, zh-en, punctuation, int8,
2026-06-05) at 160ms and 480ms chunk sizes, with 4 threads as in
parakeetWsServer.js. B is SenseVoice int8 with use_itn. C is the app's own
`whisper-server` binary with the app's args (`--language auto`, Metal, flash
attention), run as a server so the model loads once. The binary is a renamed
copy, because a running app's sidecarReaper kills anything named
`whisper-server`. Raw rows are in `results-streaming.json`.

Corpus: 40 TTS cases (the 14 original cases plus 26 new ones: longer
multi-sentence cases, numbers and dates, tech terms inside Chinese, pure zh,
pure en). The human control is 6 real recordings shipped with the models. The
2 SenseVoice clips have gold references. The 4 x-asr clips have no published
transcripts, so their references are hand-adjudicated "silver" ones
(`human_refs.json`).

Machine: Apple M5 Pro, 64 GB. Post-stop latency is the wall time from
end-of-audio to final text on this machine, with model load excluded.

### TTS corpus (40 cases, ~1,050 reference tokens)

| final pass | MER | code-switch MER | MER (numbers normalized) | post-stop p50 / p90 | resident memory |
|---|---|---|---|---|---|
| A: x-asr-160 final | 20.0% | 24.4% | 20.1% | 39 / 40 ms | ~0.63 GB |
| A: x-asr-480 final | 22.6% | 26.1% | 22.8% | 14 / 27 ms | ~0.5–0.65 GB |
| A: x-asr-480, tail pad 1.0s | 21.0% | 25.1% | 21.1% | 26 / 37 ms | |
| **B: SenseVoice** | 17.8% | 18.7% | 15.8% | **60 / 155 ms** | ~0.74 GB |
| C: whisper-turbo (whisper.cpp, Metal) | **17.4%** | **18.0%** | **15.4%** | 801 / 907 ms | 1.85 GB footprint |

| preview (streaming) | revision rate | visible rewrites / utt | partials / utt | first partial after speech onset (p50) | mean display lag | streaming RTF |
|---|---|---|---|---|---|---|
| x-asr-160 | 11.4% | 3.83 | 31 | 0.80 s | 0.30 s | 0.065 |
| x-asr-480 | **2.8%** | **0.85** | 14 | 1.10 s | 0.36 s | 0.029 |

Revision rate is the share of tokens that were shown in a partial and later
changed or removed. Mean display lag is the audio time at which a partial
appears minus the timestamp of its last token.

### Human control (6 real clips, 2 gold + 4 silver references)

| | x-asr-160 | x-asr-480 | SenseVoice | whisper-turbo |
|---|---|---|---|---|
| MER | 20.4% | 16.7% (13.9% with 1.0s pad) | **13.9%** | 25.9% |
| revision rate | 11.7% | 4.9% | | |

### Findings

1. **B (x-asr-480 preview + SenseVoice final) is the recommended default.**
   On the TTS corpus it matches C within noise (17.8% vs 17.4%). On the human
   clips it beats C (13.9% vs 25.9%). Its post-stop cost is 13x lower
   (60 ms vs 800 ms p50) and it uses less than half the memory. SenseVoice is
   already an app engine. C adds about 0.8s after every release for no
   measurable accuracy gain.
2. **A (streaming-only) costs 2–5 MER points on TTS** and is worst on English
   (en02: "increasure ship the same to the fight"). On the human clips,
   x-asr-480 is close to SenseVoice, so A is a reasonable low-power fallback,
   but it should not be the default.
3. **Use 480ms for the preview, not 160ms.** 160ms shows its first word about
   0.3s sooner, but it takes back 4x as many tokens (3.8 visible rewrites per
   utterance vs 0.85). When B produces the final text, the preview's own MER
   matters little, and stability matters more.
4. **A tail padding of 0.6s truncates x-asr.** The last character or word is
   dropped (e.g. "检查报" instead of 检查报告, "feedba" instead of feedback). A
   1.0s pad fixes this at a cost of about 15 ms. Use at least 1.0s if A is
   ever used for the final text.
5. **x-asr output style:** it applies no ITN (九点, "fifty", 两万五千). It uses
   a full-width comma followed by a space ("， ") and adds no final period. It
   spells acronyms as spaced letters ("F I G M", "M O C K U P"). Casing is
   inconsistent ("Product Tim Review", "monday"). No system emitted
   Traditional characters.
6. **Integration gotcha:** x-asr ships `decoder.onnx` (fp32), not
   `decoder.int8.onnx`, so the x-asr registry entry must override the default
   transducer file names in `sherpaServerArgs.js`. Because it is zipformer2, a
   nonzero `--warm-up` is supported.
7. **whisper.cpp turbo (F16, Metal) scores 17.4%, not the 24.8% measured
   earlier.** The earlier figure came from the sherpa int8 export. The app's
   real turbo is roughly on par with SenseVoice on this corpus. Its output also
   contains newline segment separators.
8. **Polish does not close A's gap.** When the finals go through the real
   `cleanupPrompt` on `qwen2.5:3b`, MER rises about 6 points for every system
   (A-160 23.9%, A-480 23.7%, B 24.2%, C 23.6%), because the 3B model
   translates ("翻译成英文" is executed), localizes terms (index → 索引) and
   paraphrases. The ranking is unchanged. This is a proxy model, not the
   bundled Qwen3.5-2B.

Caveats: n=40 TTS cases with ~1k tokens, so differences under about 2 points
are noise. melo TTS spells many English words letter by letter (onboarding →
"one B O R D"), which inflates code-switch MER for every system. The "long"
cases came out at 14–19s rather than 15–40s. There are only 6 human clips, and
4 of their references are silver. Another app instance ran during timing.
Memory is RSS delta after load + one decode, and varies ±0.15 GB between runs.

### Real dictations (2026-09-23, owner's own voice, aggregate only)

60 recent real captures (3–40 s, 9 min total) from the owner's production
history, decoded through the same simulation as above (100 ms chunks, 1.0 s
tail pad). There is no ground truth: references were adjudicated per clip
from all four hypotheses plus context; 8 clips too ambiguous to adjudicate
were excluded (52 kept, 1736 tokens, 35 English words). Adjudication leans on
cross-model consensus, so treat sub-1-point gaps as noise. Audio and
transcripts stay out of the repo.

| system | MER | code-switch MER | English-word miss | post-stop p50 / p90 |
|---|---|---|---|---|
| x-asr-480 streaming final | 2.8% | 3.7% | 20% | 24 / 35 ms |
| x-asr-160 streaming final | 2.3% | 3.1% | 20% | 64 / 81 ms |
| SenseVoice re-decode | 2.1% | 2.7% | 23% | 65 / 176 ms |
| whisper-turbo re-decode | 3.1% | 3.8% | **9%** | 807 / 901 ms |

| preview | revision rate | rewrites / utt | first text after onset (p50) | lag |
|---|---|---|---|---|
| x-asr-480 | 0.7% | 0.23 | 0.98 s | 0.36 s |
| x-asr-160 | 2.2% | 0.75 | 0.80 s | 0.29 s |

Findings on real speech (differs from the TTS run):

1. All four land within ~1 point of each other; the TTS gap between
   streaming-only and two-pass mostly disappears on a real voice.
2. Error profiles differ more than totals: whisper-turbo keeps English
   terms (GitHub, template, breakdown, H1B) but makes Chinese homophone
   errors; SenseVoice is best on Chinese but mangles English terms; x-asr is
   in between and spells some acronyms as words ("H one B").
3. 480 ms is the better preview: 3x fewer visible rewrites for ~0.2 s later
   first text.
