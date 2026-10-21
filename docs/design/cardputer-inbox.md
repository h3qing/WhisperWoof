# Cardputer inbox

Status: implemented (transcripts). Off by default.

The [Cardputer Assistant](https://github.com/h3qing/cardputer-assistant) is a
pocket device that records voice memos (hold G0) and meetings (Opt+R, then a
"tell the people present first" confirm). Its Mac daemon, `cpad`, pulls the
audio over USB and lands each recording in a folder under
`~/CardputerNotes/recordings`. The Cardputer inbox is the WhisperWoof side:
it finds those folders, transcribes them on this Mac with SenseVoice, and
writes the transcript back next to the audio. The folder is the queue: either
side can be closed and nothing is lost.

Turn it on in **Settings → WhisperWoof → Cardputer recordings**. The folder
can be changed there (native folder dialog only; the page never sends a path).

## The contract

Both sides follow the recording file contract v1, owned by cardputer-assistant
(`protocol/recording/v1`: README, JSON Schemas, valid and invalid vectors).
WhisperWoof keeps a byte-identical copy:

- `src/whisperwoof/core/cardputer/schema/` — the schemas, read at runtime by
  `core/cardputer/contract.js` (a small Draft 2020-12 interpreter,
  `contract-schema.js`, that throws on any keyword it doesn't implement);
- `src/whisperwoof/core/cardputer/fixtures/` — the vectors, `VECTORS.sha256`
  and `SOURCE` (where and when they were copied, with digests).

`contract.test.ts` checks every digest and that every vector gets exactly the
verdict the contract's own checker gives (`{code, field}`). To update: copy the
files again from cardputer-assistant, update `SOURCE`, run the tests.

Forward compatibility: unknown fields are ignored everywhere; only `v` other
than the integer 1 rejects a whole file (`failed / E_VERSION`). Unknown mark
kinds are skipped. Segment files are `seg-NNN.wav`, 3 digits (4 from 1000).

## Folder and writers

```
~/CardputerNotes/recordings/2026-10-21/1402-k3m9q2t-00042-0a1c/
  seg-000.wav …      cpad         read-only once landed (16 kHz / 16-bit / mono PCM)
  manifest.json      cpad         written once; its presence means "ready"
  status.json        WhisperWoof  optional, overwritten: queued | transcribing | blocked{reason}
  transcript.json    WhisperWoof  sentences {t_ms, text}, t_ms in session time
  transcript.md      WhisperWoof  one line per sentence, block id ^tHHMMSS (-2, -3 in the same second)
  result.json        WhisperWoof  last: done (level transcript) | failed {code, retryable}
```

Neither side changes or deletes the other's files. WhisperWoof never deletes
anything (audio retention is cpad's job).

## Hand-off rules

1. A session folder is processed when it has a valid `manifest.json` and no
   `result.json`.
2. Order: `status.json` (any time) → `transcript.json` → `transcript.md` →
   `result.json`. Each file is written to a dot-prefixed temp file (0600,
   opened with `O_NOFOLLOW`), fsynced, renamed into place, and the folder is
   fsynced (`bridge/cardputer-writeback.js`).
3. Once `result.json` exists, WhisperWoof writes nothing more to that folder.
   Before every write it checks, and `result.json` itself is linked into place
   (`link(2)` fails if the name exists), so a result that appears meanwhile
   always wins. On a volume without hard links (exFAT) it checks, then renames.
4. **Manual rerun:** delete `result.json`. The session is processed again on
   the next pass and WhisperWoof **overwrites its own files**, including a
   `transcript.md` you edited. Keep edits in a copy. (Protecting edits and
   `cpa rec retry` are planned for a later version.)
5. Idempotent: what counts is the folder; WhisperWoof keeps only retry timers
   in memory. A crash on either side is safe to repeat.
6. **A folder that disappears cancels its session.** A session folder may be
   deleted or moved away (the Trash, or `~/CardputerNotes/.trash/` for cpad's
   planned delete) at any time: before, during or after processing. A missing
   folder (`ENOENT`) is then never an `E_IO` retry nor an `E_INVALID` verdict:
   WhisperWoof stops at the next piece or write, writes nothing more, never
   recreates the folder or any file in it, forgets the session and logs one
   `cancelled` outcome. The contract is unchanged (v1 stays frozen); this is
   WhisperWoof's behaviour.

## Pipeline

`bridge/cardputer-inbox.js` (Electron shell) runs `core/cardputer/inbox-runner.js`
at start, on `fs.watch` changes (debounced 2 s) and every 30 s. One pass:

1. **Discover** (`core/cardputer/session-files.js`): `<root>/<YYYY-MM-DD>/<name>/`,
   real directories only (lstat), resolving inside the root.
2. **Check** (all input is untrusted):
   - `manifest.json` ≤ 1 MiB, valid against the contract (MonoId session,
     segment names, sha256 format, indices plus gaps contiguous, …);
   - every segment: a regular file (not a symlink), ≤ 20 MB, the size the
     manifest says, a canonical 44-byte PCM 16 kHz / 16-bit / mono header whose
     lengths match; at most 4 hours in total;
   - before transcribing, the whole-file sha256 of every segment.

   A bad session gets `result.json` `failed / E_INVALID` (or `E_VERSION`). A
   symlink anywhere, a folder outside the root, or a manifest that can't name
   its session is left alone: nothing is written.
3. **Queue:** `status.json` `queued`; memos before meetings, then oldest first;
   one session at a time.
4. **Transcribe** (`core/cardputer/process-session.js`):
   - SenseVoice (`sense-voice-zh-en`) in a sherpa-onnx server of its own,
     `pidKey: "parakeet-cardputer"`, `logTranscripts: false`, registered with
     the startup reaper (`sidecarReaper.js`). It isn't the meeting server, so a
     WhisperWoof meeting and the inbox never share a pid file. The server stops
     at the end of each pass. Without the model: `blocked / model_missing`.
   - Each run of contiguous segments (a gap starts a new run) goes through its
     own `MeetingLocalTranscriber` with `zeroMs` = the run's first `t0_ms`
     (plus `lead_ms` for segment 0, whose first `lead_ms` is skipped), so every
     line's timestamp is already session `t_ms`.
   - PCM is fed 1 s at a time; whenever `push()` reports a cut clip, the inbox
     awaits `idle()`. Reading a file is ~1000× faster than SenseVoice, so
     without this a 3-hour meeting would queue ~90 clips (~690 MB) in main; with
     it at most one clip waits.
   - `silenceRms` is `CARDPUTER_SILENCE_RMS` (0.0005, provisional until the
     device's mic level gate G-A10 measures real speech).
   - Before every piece the background gate is asked (`gateDelayMs`): while it
     says wait, `status.json` is `blocked / busy`.
   - Each sentence gets the main-process clean-up dictation gets: Memory swaps
     (`vocabulary.applyMemoryReplacements`), simplified Chinese
     (`chinese-script.js`) and broken punctuation repair (`lost-punctuation.js`).
5. **Write** `transcript.json`, `transcript.md`, then `result.json`
   `{state: "done", level: "transcript"}` with the sha256 of both outputs.
6. **Notify** with a system notification that says only that a recording was
   transcribed.

### Errors and retries

| Code | When | Retry |
|---|---|---|
| `E_VERSION` | manifest `v` isn't 1 | no |
| `E_INVALID` | contract, file, header, size or sha256 check failed | no |
| `E_AUDIO` | a segment got shorter while it was read | no |
| `E_STT` | SenseVoice didn't start, or a piece failed | yes |
| `E_IO` | file-system errors, anything unexpected | yes |

Retryable errors back off (30 s, 2 min, 8 min); after 3 retries the session
gets `result.json` `failed` with `retryable: true` (delete it to try again).
While waiting, `status.json` says `queued`. Turning the inbox off stops the
session in progress and leaves `blocked / disabled`. A session folder that is
gone is not an error: no code, no retry, nothing written (hand-off rule 6).

## Privacy and security

- Off by default. No new port, no IPC from anything but the app's own page,
  and the folder only from the native dialog.
- The recordings folder is plain files: audio and transcripts there are not
  covered by WhisperWoof's encryption (Settings says so).
- Transcript text never reaches the debug log: the sherpa server runs with
  `logTranscripts: false`, and the inbox logs outcome kinds and codes only.
- WhisperWoof never opens the Cardputer's serial port; cpad owns it.

## Code

| File | What |
|---|---|
| `bridge/cardputer-inbox.js` | Electron shell: setting, watch/poll, SenseVoice server, IPC, notification |
| `bridge/cardputer-inbox-pure.js` | pure rules: settings, WAV header, segment checks, runs, status/result documents, retries |
| `bridge/cardputer-writeback.js` | atomic writes; `result.json` never replaced |
| `core/cardputer/inbox-runner.js` | discovery, queue, statuses, retries |
| `core/cardputer/process-session.js` | one session: model, sha256, transcription, outputs |
| `core/cardputer/session-files.js` | reading the folder without following symlinks |
| `core/cardputer/transcript-doc.js` | `transcript.json` / `transcript.md` |
| `core/cardputer/contract.js`, `contract-schema.js` | contract v1 verdicts from the copied schemas |
| `ui/settings/CardputerSection.tsx` | the Settings section |

Tests: `src/whisperwoof/core/cardputer/*.test.ts` (contract vectors and digests,
pure rules, end-to-end flows on temp folders with a fake SenseVoice, refused
sessions, the shell with a fake environment, `app-init` wiring) and
`core/meeting/local-transcriber.test.ts` (time zero, silence gate, back-pressure
over 3 hours of audio).

## Not in this version

Summaries are the next step (see below once added). Also out of scope: storing
recordings in WhisperWoof's database or history, the Prompt Studio, speaker
separation, cloud models by default, a live link to `cpad` (planned: a socket
next to this folder contract).
