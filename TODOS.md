# TODOS

## Diarization (upstream cherry-pick #6)

**What:** Pull upstream OpenWhispr diarization stack into our meeting pipeline so transcripts show speaker labels.

**Why:** Meeting transcripts become much more useful with `Heqing: ... / Alex: ...` formatting — search, summaries, and action-item extraction all sharpen. Flagship-sized capability for our meeting use case.

**Pros:**
- Major user-visible upgrade for meeting recordings.
- Voice profiles → contact-email linking turns "Speaker 2" into "alex@..." over time.
- Auto-download (~35MB ONNX models, fire-and-forget) means zero onboarding friction.

**Cons:**
- Multi-commit pull (`b187f3a14` → `aec6f74f6` → `ef1533a02` → `10fb4adbf` → `78a2b82d0`, possibly `56bdb8d19`).
- New runtime dependency: ONNX runtime + speaker-embedding models.
- SQLite schema migration: per-segment speaker IDs on `bf_entries` (or new `bf_entry_segments` table).
- FTS5 reindex if schema changes affect transcript text storage.
- Touches our customized meeting pipeline: `MeetingTranscriptCheckpoint`, `MeetingAudioBuffer`, `MeetingDetectionEngine`.

**Context:** Decision D1 in eng review on 2026-05-04 split this from the rest of the upstream cherry-pick bundle because it represents ~70% of the engineering effort. Other items (cancel button, no-paste toggle, TXT export, parakeet 0.6b, secretCrypto, meeting pill) ship first as small PRs.

**Depends on / blocked by:**
- `bf_entry_segments` schema design (also blocks SRT export — see below).
- /office-hours design doc covering: model storage path, on-disk size budget, opt-in vs auto, privacy model (do speaker embeddings leave the machine? No.).
- /plan-eng-review pass after design doc lands.

**Start here:** Run `/office-hours` with the upstream commit list above as the input. Reference upstream files: `src/helpers/diarization.js`, `src/components/notes/MeetingTranscriptChat.tsx`.

---

## SRT transcript export with per-segment timestamps

**What:** Add SRT format to StorageManager export alongside TXT/JSON.

**Why:** Users want subtitles for video projects and accessibility. Single-cue SRT (one block spanning the whole recording) is functionally useless, so SRT requires real per-segment timing.

**Pros:**
- Completes the upstream `5bd668d1a` feature surface.
- Per-segment storage unlocks future features: jump-to-transcript-position, partial re-transcription, segment-level editing.

**Cons:**
- Schema migration: new `bf_entry_segments(entry_id, start_ms, end_ms, text)` table.
- STT pipeline change: emit segment-level timing from Whisper/Parakeet (Whisper supports it natively; Parakeet integration TBD).
- Backfill story: existing entries have no segments — SRT for old entries falls back to single-cue or "unavailable."

**Context:** Decision D6 in eng review on 2026-05-04. PR #3 ships TXT-only; SRT was deferred to avoid producing nonsense single-cue files.

**Depends on / blocked by:** `bf_entry_segments` schema (also unblocks diarization).

**Start here:** Co-design the segments schema with diarization (above) so one migration handles both features.

---

## Make auto-update actually work (manifests + signing)

**What:** v1.15.7 removed the inherited updater feed that offered upstream OpenWhispr releases as "updates" to WhisperWoof. The updater now points at `h3qing/whisperwoof`, but update checks 404 because the release pipeline never publishes what electron-updater needs. Remaining work, found by the v1.15.7 adversarial review:

1. **Publish updater manifests.** `.github/workflows/release.yml` builds with `--publish never` and uploads only `dist/*.dmg` + `dist/*.zip`. Add `dist/*.yml` and `dist/*.blockmap` to the release assets, and build with `--config.publish.channel=latest-arm64` so the generated manifest matches the `latest-arm64` channel `src/updater.js:68` requests (electron-builder otherwise writes `latest-mac.yml`).
2. **Sign builds.** Squirrel.Mac refuses to install updates onto an unsigned app, and unsigned auto-update is an unauthenticated code-delivery channel. In progress in a separate session ("Sign WhisperWoof builds with stable identity") — also fixes Accessibility permission loss on every rebuild.
3. **Gate the updater on `app.isPackaged` instead of `NODE_ENV`,** and return a friendly "updates not configured in this build" when `app-update.yml` is absent, instead of leaking a raw 404/ENOENT to the renderer.
4. **Config cleanup:** remove dead `releaseType: "draft"` from `electron-builder.json` (publishing happens via softprops action, not electron-builder — if anyone flips to `--publish always`, draft releases would be invisible to the updater), and fix the repo case `h3qing/whisperwoof` → `h3qing/WhisperWoof`.

**Why:** Users are permanently frozen on their installed version — every startup and 4-hour check silently 404s. Once 1+2 land, updates flow end-to-end.

**Start here:** Do 1 and 4 in the same PR as (or after) the signing task, to avoid conflicting edits to `release.yml`/`electron-builder.json`.

---

## secretCrypto + plugin-bridge — scope blocked

**What:** PR #5 from the 2026-05-04 cherry-pick batch. Originally scoped as "swap safeStorage for keyring + AES-256-GCM at `plugin-bridge.js:62`."

**Why blocked:** Inspection on 2026-05-04 showed the eng-review's premise was wrong: `src/whisperwoof/bridge/plugin-bridge.js:62` is a comment, not a `safeStorage` call. Plugin env values are only set in `process.env` at runtime, never persisted. There is no migration target.

**Three honest options for the user to decide:**

1. **Skip until plugin secret persistence is actually wanted (recommended).** Today the bug is "plugin keys are lost on restart" — fix that whenever it actually matters.
2. **Expand scope to implement persistence + encryption.** Real feature, ~100 lines, adds `@napi-rs/keyring` native dependency requiring `electron-rebuild`.
3. **Add unused `secretCrypto` helper.** Dead code; violates CLAUDE.md "don't add features beyond what the task requires."

**Context:** Eng-review decision D4 (2026-05-04) chose option 2-style scope ("Minimal: keyring + AES-256-GCM for plugin keys only") under the false premise that there was a safeStorage migration. With the premise corrected, the user should re-decide.

**Start here:** When option 2 is picked, the design also needs to answer: what happens to the in-memory `process.env[KEY] = value` writes when keys come from disk on restart? Does the MCP child process inherit them, or do we need to spawn it after decrypt completes?
