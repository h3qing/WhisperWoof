# Meeting clip bench

How well local models transcribe a long recording when it is cut into
clips (the unit of async meeting transcription, see
`docs/design/local-meeting-transcription.md`), and where the cuts should go.
Results over time: [RESULTS.md](RESULTS.md) (latest per model) and
`results/history.jsonl` (every recorded run).

## Benches

A bench is a recording plus a reference transcript. Recordings are private,
so the repo only describes them in [benches.json](benches.json): what's in
it, its length, languages and speakers, where the reference came from, and
the sha256 of the audio so a run can't silently use the wrong file.

The files live outside the repo, in `~/.whisperwoof-bench/<bench-id>/`
(override with `WHISPERWOOF_BENCH_DATA`), named as in the bench's `files`.

To add a bench (e.g. `bench-b`):

1. Put the audio in `~/.whisperwoof-bench/bench-b/`.
2. Convert the transcriber's export to the reference format, lines
   alternating `<speaker> HH:MM:SS` and what was said:
   `python3 eval/meeting-bench/docx_to_reference.py export.docx ~/.whisperwoof-bench/bench-b/reference.txt`
3. Add an entry to `benches.json` with `shasum -a 256` of the audio.

| bench | what it is |
|---|---|
| bench-a | 10.8 min, two people, Mandarin with English names and finance terms, one mixed track, some background noise; silver reference |

## Run

```bash
node eval/meeting-bench/run_clips.js --bench bench-a --record \
  --out /tmp/meeting-bench --bin-dir /tmp/bench-bin --bench-models /tmp/bench-models \
  --engines x-asr-480,sense-voice,qwen3-asr@sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25 \
  --plans lull-120
```

- `--record` appends each run to `results/history.jsonl` (date, bench,
  model, runtime, plan, MER, RTF, machine, git sha) and regenerates
  `RESULTS.md`. Commit both. `--report-only` just regenerates the page.
- `--out` gets the hypothesis text per engine and plan: keep it outside the
  repo, it's the content of a private recording.
- `--bin-dir`: **renamed** copies of the app's servers and their dylibs
  from `resources/bin`: `whisper-server-*` → `bench-wcpp-srv`,
  `sherpa-onnx-online-ws-*` → `bench-sherpa-online`, `sherpa-onnx-ws-*` →
  `bench-sherpa-offline`. A running WhisperWoof reaps processes with the
  original names. Start them from a scratch directory: sherpa-onnx servers
  write `./log.txt` into their working directory.
- Engines:
  - `x-asr-480` / `x-asr-160`: the app's streaming models from
    `~/.cache/openwhispr/parakeet-models`.
  - `sense-voice`: the app's SenseVoice (`parakeet-models/sense-voice-zh-en`).
  - `whisper-turbo`: `whisper-models/ggml-large-v3-turbo.bin`.
  - `<spec>@<dir>`: any k2-fsa sherpa-onnx release unpacked into
    `--bench-models`, where `<spec>` is one of `sense-voice`,
    `xasr-offline` (zipformer transducer), `dolphin`, `paraformer`,
    `firered-ctc`, `firered-aed`, `funasr-nano`, `qwen3-asr`. Model archives
    are at `https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models`.
- `--hotwords <file>` (one per line) is passed to the models that take
  hotwords (`qwen3-asr`, `funasr-nano`); the run is recorded with
  `hotwords: true`.

## Plans

| plan | cut rule |
|---|---|
| `whole` | no cuts |
| `fixed-<s>` | every `<s>` seconds |
| `pause-<s>` | first pause (≥400 ms below the app's fixed VAD threshold, RMS 0.01) after `<s>` seconds; quietest frame within 30 s if none |
| `lull-<s>` | middle of the quietest 400 ms in the 20 s after `<s>` seconds (no threshold) |

Offline models get each clip further split into pieces of at most 20 s at
the quietest 300 ms between 12 and 20 s.

Scoring is the mixed error rate of `eval/dictation-bench` (Chinese per
character, English per word, punctuation dropped), with the same
tokenizer. Against a silver reference it overstates the real error: part of
the gap is the reference's own mistakes and filler repetitions it keeps.
