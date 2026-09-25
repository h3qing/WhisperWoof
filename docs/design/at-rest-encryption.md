# At-rest encryption: design proposal

Status: **approved 2026-09-25.** The owner chose the recommended option on all four decisions (section 9) and made no changes to the defaults (section 8).
Date: 2026-09-25. Scope: macOS (the only platform we ship).

## 1. In one paragraph

When you turn on encryption, WhisperWoof encrypts everything it keeps about you: history, notes, recordings, clipboard images and Memory. It unlocks with Touch ID or your password. When you turn it on you get a 12-word recovery phrase, and those words alone can open your data on any Mac. There is no back door. If you forget the password and lose the phrase, the data is gone and nobody can get it back, us included. Dictation keeps working while WhisperWoof is locked. New entries are sealed as they arrive and join your history the next time you unlock.

## 2. What was verified on this Mac before proposing it

| Question | Result |
|---|---|
| Can an **unsigned** helper (ad-hoc, like our releases) create a Secure Enclave key that needs Touch ID? | **Yes.** CryptoKit `SecureEnclave.P256.KeyAgreement` with `[.privateKeyUsage, .biometryCurrentSet]` works with no entitlements. ECDH round-trips and the key restores from its saved blob. |
| Can it store a Keychain item with a Touch ID rule (`kSecAccessControlBiometryCurrentSet`)? | **No.** `SecItemAdd` returns `-34018` "A required entitlement isn't present". That needs a signed build with `keychain-access-groups`. |
| Does `better-sqlite3-multiple-ciphers` (SQLite3MultipleCiphers 2.4.0) work with our schema? | **Yes.** A copy of our WAL database with its FTS5 index and triggers, re-keyed with `cipher='sqlcipher'`, passes `integrity_check` and FTS `integrity-check`, and FTS `MATCH` still finds rows. No plaintext is left in the `.db` or `-wal` files. A wrong key and stock `better-sqlite3` both get "file is not a database". |
| Does it build for our Electron? | **Yes.** It compiles from source against Electron 39.8.1 in about 14 s. Its shipped prebuilt binary also loads unchanged in Node 22 (Vitest) and Electron 39. |
| Migration method | `PRAGMA rekey` on a **copy**, then verify and swap. `sqlcipher_export()` doesn't exist in this build. `VACUUM INTO 'file:…?hexkey=…'` is a trap: URI filenames are off, so it creates a file **named after the key**. Never put keys in URIs. |
| Crypto in Electron 39 (Node 22.22, BoringSSL) | AES-256-GCM, X25519, P-256, HKDF and scrypt are all present. `crypto.argon2` is **missing** (it arrives in Node 24.7). ChaCha20-Poly1305 isn't exposed. On this M5 Pro, scrypt with N=2^18 (256 MiB) takes 545 ms and N=2^17 (128 MiB) takes 267 ms. |
| Releases | Built unsigned (`scripts/after-pack-adhoc-sign.js`). Latest is v2.1.1, installed with the curl script. |

## 3. Where your data lives today

Every store below is plaintext today. "Plan" says what happens with encryption on.

| Store | Where | What's in it | Plan |
|---|---|---|---|
| Main database | `userData/transcriptions.db` (+`-wal`, `-shm`). Two connections open it: `src/helpers/database.js:20` and `src/whisperwoof/bridge/app-init.js:233` | `bf_entries` (voice, clipboard incl. everything copied, meetings, imports), `bf_entries_fts`, `bf_projects`, `bf_snippets`, tags, chains, audit log. OpenWhispr tables: `transcriptions`, `custom_dictionary`, `notes` + `notes_fts` (meeting transcripts), `agent_messages`, `calendar_events`, **`google_calendar_tokens`** (OAuth tokens) | Whole-file SQLCipher (4.3) |
| Dictation audio | `userData/audio/OpenWhispr-…-<id>.webm`. Written at `audioStorage.js:41`, read only by `getAudioBuffer` (`:73`) → IPC → Blob URL | Your voice | Encrypted file (4.4) |
| Clipboard images | `userData/whisperwoof-images/<uuid>.png` + `_thumb.png` (`app-init.js:139`). Read only by the `whisperwoof-get-image` IPC | Screenshots, anything copied | Encrypted file |
| Notes | `~/Documents/WhisperWoof Notes/YYYY-MM-DD-HHMMSS.md` (or a folder you chose, e.g. Obsidian/iCloud). One flat folder with a frontmatter `project`. No `attachments/` folder exists | Note text | **Your call** (9, Q2). Recommended: encrypted in place as `…md.wwenc` |
| Meeting crash buffer | `$TMPDIR/meeting-audio-<uuid>/{mic,system}-NNNN.wav` (`meetingAudioBuffer.js:67`). **Never read back, never deleted** | Meeting audio | Encrypted append-only stream, deleted after the meeting is saved |
| STT temp files | `$TMPDIR/whisper-input-*.webm`, `whisper-output-*.wav`, `parakeet-*` (ffmpeg conversion). `ow-chunks-*/*.mp3` (cloud uploads over 25 MB) | Your voice, for seconds | Removed: ffmpeg reads from stdin and writes to stdout (4.5). whisper-server and sherpa-onnx already get bytes in memory, never paths |
| Memory and other JSON | `whisperwoof-vocabulary.json` (words, mishearings, per-app), `whisperwoof-style-examples.json` (**50 transcript pairs**), `whisperwoof-focus-sessions.json`, `whisperwoof-schedules.json`, `whisperwoof-templates.json`, `eval-dataset.json` + `eval-audio/` | Things you said or wrote | Encrypted file |
| Telegram inbox | `telegram-inbox.json`, written by the companion bot, a separate process | Mobile voice notes | The bot can't encrypt, so this file stays plaintext until import. After import the items are **removed** (today they pile up forever) |
| Debug logs | `userData/logs/debug-*.log` (debug level only) | Up to 500 characters of transcripts, 80 characters of text you type in other apps (`textEditMonitor.js`), dictionary prompts | Content redacted while encryption is on. Old logs are deleted during migration |
| localStorage (Chromium leveldb) | `userData/Local Storage/` | API keys, a copy of `customDictionary`, Google account emails, your prompts | The dictionary copy stops being written and is cleared. API keys: see section 8 |
| Config | `whisperwoof-settings.json`, keybindings, pack state, privacy, plugins | Settings | Stays plaintext. It's needed before unlock and holds none of your content |
| Models | `~/.cache/openwhispr/` | Downloaded models | Not user data. Untouched |

## 4. Design

### 4.1 Keys

```
 12-word recovery phrase (128 random bits, BIP39)
        │ HKDF-SHA256 "ww/master/v1"
        ▼
   master key MK (256-bit) ──── never stored in the clear, only kept in memory while unlocked
        ▲         ▲         ▲
        │ AES-256-GCM wraps of MK, kept in userData/vault/vault.json
  password        Touch ID                     (the phrase itself recomputes MK)
  scrypt N=2^18   Secure Enclave P-256 key,
  r=8 p=1         biometryCurrentSet;
  (256 MiB)       ECDH + HKDF → wrap key

 MK ─HKDF "ww/db/v1"────► SQLCipher raw key for transcriptions.db (every table, incl. FTS5 and OpenWhispr's)
 MK ─HKDF "ww/seal/v1"──► X25519 private key.  Its public key is kept in vault.json
                          and needs no unlock: each file is encrypted with its own random
                          key, wrapped to this public key. Writing never needs the unlock;
                          reading does.
```

- **The recovery phrase *is* the master key's seed.** If `vault.json` is lost or corrupted, the 12 words still open everything, on this Mac or a new one. That includes notes synced through iCloud. The password and Touch ID are just faster ways to get the same MK.
- **Password:** scrypt, because Argon2id isn't in Electron 39's Node. Adding a WASM Argon2 would mean one more dependency to audit, and it wouldn't gain much over scrypt at 256 MiB. The parameters are stored in `vault.json`, so they can be raised later without re-encrypting. A wrong password fails the GCM tag check; there's no separate password hash. The minimum is 8 characters, and the screen suggests a few words.
- **Each wrap uses AAD** `whisperwoof-vault/v1/<method>/<vaultId>`, so wraps can't be swapped between vaults or methods.
- **Checking a phrase:** `vault.json` keeps `HMAC(MK, "ww/check")` to confirm a phrase belongs to this vault. It's safe to store because MK has 128 bits of entropy. The BIP39 checksum catches most typos before that.

### 4.2 Touch ID: what really gates the key

**Recommended: a small Swift helper, `macos-vault-helper`, using the Secure Enclave.** It's built the same way as our other helpers (`resources/*.swift` → `resources/bin/`, `compile:native`, `extraResources`).
- `create`: makes a Secure Enclave P-256 key-agreement key with `[.privateKeyUsage, .biometryCurrentSet]` and prints the key's blob and its public key. There's no prompt. Main then wraps MK to that public key using an ephemeral P-256 key, ECDH and HKDF → AES-GCM.
- `unlock`: loads the blob and asks for Touch ID ("unlock your WhisperWoof history"). The Secure Enclave then does the ECDH and the helper returns the shared secret over its stdout pipe. Main unwraps MK.
- **Why this is a real gate:** the private key never leaves the Secure Enclave, and the Enclave refuses the ECDH without a fingerprint at that moment. The blob on disk is useless on any other Mac, and useless on this one without a finger. Adding or removing a fingerprint invalidates it (`biometryCurrentSet`), so someone who knows your Mac password can't enroll their own finger to get in. When that happens, the app asks for your password once and re-enrolls Touch ID by itself.
- It works on today's unsigned releases (verified, section 2) and on future signed ones.

**Not recommended: `systemPreferences.promptTouchID` + `safeStorage`.** Here the Touch ID dialog is only a gate in the UI. The key sits in the login Keychain, and the app can read it at any time without a fingerprint. So can anyone who knows your Mac password (Keychain Access → show password). On unsigned builds, macOS also asks for Keychain access after every update. A Keychain item with a biometry rule would be a real gate, but it fails on our unsigned builds with `-34018`.

Touch ID is optional. It's on by default when the Mac has it; Macs without it use the password.

### 4.3 The database: whole-file SQLCipher

**Recommended:** swap `better-sqlite3` for `better-sqlite3-multiple-ciphers`. It has the same API; `cipher='sqlcipher'` gives SQLCipher v4 format, and the MK-derived key goes in with `PRAGMA hexkey`, so there's no KDF each time the database opens.
- Every page of every table is encrypted. That includes FTS5 (search keeps working unchanged), the WAL, and OpenWhispr's tables and Google tokens. None of the OpenWhispr code has to change beyond how the database is opened.
- Add `PRAGMA temp_store = MEMORY`, so sorts don't spill plaintext temp files.
- With encryption off, the same library opens plain databases. One dependency covers both modes.
- **Cost:** a few percent of CPU on I/O, which you won't notice at our sizes. The package switches from `better-sqlite3` to its fork, which is maintained and tracks upstream. `electron-rebuild` builds it from source in CI (about 14 s) with no signing changes; it's still one `.node` in `app.asar.unpacked`. Update the `asarUnpack` glob and `scripts/bench-latency.js`.

**Rejected: encrypting individual fields** (`raw_text`, `polished`, …).
- FTS5 can't index ciphertext, so search would need an in-memory index rebuilt at every unlock.
- Timestamps, apps, durations and counts would stay readable.
- Every OpenWhispr table (notes, meeting transcripts, calendar, agent chats, tokens) would need edits inside upstream code, which breaks the bridge rule.
- It touches far more code and gives less protection.

**Opening and closing:** both connections go through one `openAppDatabase()` in the vault module. Locking closes both connections and makes the `setDatabase()` holders (tags, chains, analytics, storage manager) throw `VaultLockedError`. Unlocking reopens them and calls the setters again. Statements are prepared per call today (checked), so nothing stale is left behind.

### 4.4 Files: one format for audio, images, notes and JSON (`WWENC1`)

```
"WWENC1" | u32 header length | header { v, kind, eph X25519 pub, wrapped file key, nonce prefix }
         | HMAC-SHA256(header)      ← key derived from the file key
         | chunks: u32 length | AES-256-GCM(chunk ≤ 64 KiB)   nonce = prefix(7) ‖ counter(4) ‖ last-flag(1)
```

- **Each file gets its own random key,** wrapped to the vault's X25519 public key (ECIES: ephemeral X25519 → HKDF → AES-GCM). This is the same idea as `age`, built only from Node's crypto, with no new dependency. AES-256-GCM because it's what Electron's BoringSSL exposes and Apple Silicon does it in hardware.
- **Detects** a changed byte (GCM tag), reordered chunks (counter), a swapped header (header MAC), and a cut-off file (no chunk carries the last flag).
- **Crash-safe meeting recording:** the recorder writes the header first, then appends a chunk about every second and fsyncs the file periodically. Chunks carry a length prefix, so a chunk can be short. After a crash, the reader keeps every complete, authenticated chunk, drops the torn tail, and marks the recording **interrupted**. At most about a second of audio is lost, like today. The 5-minute segments stay. PCM and its format go into the stream, and the WAV header is rebuilt in memory when the file is read or exported, so there's no patching in place.
- **Paths stay the same.** The storage layer resolves `x` to `x.wwenc` when that file exists. The database keeps its current paths, so no rows are rewritten.
- **Notes (if encrypted):** `2026-09-25-101500.md` becomes `2026-09-25-101500.md.wwenc` in the same folder. Names are timestamps, so they don't leak titles. `fs.watch`, list, edit, trash, the 500-note cap and the project frontmatter all keep working, through read/write functions that decrypt and encrypt. A note written on one Mac is readable on another Mac restored with the same phrase.

### 4.5 Plaintext while we work with it

- **Speech-to-text:** whisper-server gets audio as HTTP multipart bytes (`whisperServer.js:465`), and sherpa-onnx as WebSocket frames (`parakeetWsServer.js:307`). Neither gets a file path. The only plaintext temp files come from ffmpeg conversion, and those become pipes: webm in on stdin, raw s16le PCM out on stdout, with the WAV header built in memory. The cloud split for large files (`ow-chunks`) uses one ffmpeg per chunk (`-ss/-t` → stdout). Imports read your own file where it already is. Encryption never copies or changes it (but see the deletion bug in section 10).
- **Wiping:** real wiping isn't possible on APFS and SSDs (copy-on-write, TRIM, snapshots), so the design avoids writing plaintext in the first place. Any leftover case writes to a private 0700 folder, `userData/vault/tmp`, which is emptied at startup. FileVault stays the backstop for that last gap.
- **Memory:** MK and derived keys live in `Buffer`s that are zeroed on lock. That's best effort: the password crosses IPC as a JS string, and those can't be wiped. On lock, each window reloads, so decrypted history and notes leave React state. Swap and the sleep image are already encrypted by macOS.
- **Renderer:** decrypted audio and images come over IPC as bytes, then become Blob or data URLs, as they do today. Keys and the vault never reach the renderer.

### 4.6 Locking, and what works while locked

- **Unlocked:** everything works as today.
- **Locked:** the database is closed, the keys are zeroed, and each window shows the lock screen with Touch ID, password, and a recovery phrase link.
- **Dictation keeps working while locked:** it transcribes, polishes and pastes.
  - Memory swaps and hints use the vocabulary already in memory (`_vocabCache`). It's never written to disk in the clear.
  - After a cold start, until the first unlock, dictation runs without Memory. WhisperWoof asks for Touch ID once at launch, so this is rare.
- **The sealed inbox:** anything that would write while locked becomes a sealed `WWENC1` file in `userData/vault/inbox/`: the dictation row, its audio, an fn+N note, a clipboard entry, a Memory correction, a meeting checkpoint. The inbox can be written with only the public key, and nobody can read it without unlocking. On unlock, items are imported oldest first. Each one is removed after its database commit, using deterministic ids with `INSERT OR IGNORE`, so a crash mid-import doesn't duplicate anything. Swap offers ("Always change X to Y?") show after the unlock.
- **Needs an unlock:** opening history, notes, search, projects and snippets; starting a *new* meeting (one already running keeps going); and calendar sync, since its tokens are in the encrypted database.
- **Lock triggers** (defaults in Q3):
  - Quit (always).
  - Mac screen lock or sleep: `powerMonitor` `lock-screen` / `suspend`.
  - Idle time (optional).
  - "Lock now" in the tray and in Settings.
- **The lock is enforced in main, not just in the UI.** Every database and vault IPC handler checks the state, so DevTools or a bug can't read around the lock screen.

### 4.7 Turning it on, off, and changing things

**Turning it on** is a sheet with five steps:
1. It explains what's encrypted and what isn't, with the no-back-door warning. You tick "I understand my data is gone if I lose both".
2. Set a password, twice.
3. The 12 words are shown once. There's no copy button, because the clipboard monitor would save them into history.
4. You type 3 of the words to confirm.
5. You choose whether to use Touch ID, with one test touch.

Then the migration runs, with a progress bar.

**Migration** is journaled in `userData/vault/migration.json`, and every step can be repeated safely:
1. Write `vault.json` (a temp file, fsync, rename), plus `vault.json.bak`. From here on, new writes go to the sealed inbox, so dictation keeps working during the migration.
2. Check free space: the database size plus a margin.
3. **Database:**
   1. `wal_checkpoint(TRUNCATE)`, then close both connections.
   2. Copy to `transcriptions.db.encrypting` and rekey the copy.
   3. Verify it: `integrity_check`, and the row count of every table matches the original.
   4. fsync, then rename the plain file to `…plain-old` and the encrypted one to `transcriptions.db`.
4. **Files** (audio, images, JSON stores, eval audio, notes if chosen): write `x.wwenc.tmp`, fsync, rename to `x.wwenc`, decrypt it and compare the hash, then unlink `x`.
5. Delete `…plain-old`, the old `-wal`/`-shm`, the debug logs and the localStorage dictionary. Mark the vault on. Import the inbox.

If the migration is interrupted (crash, power loss, quit):
- On the next launch, the journal and a file-state check decide where to resume. A plaintext SQLite file starts with `SQLite format 3\0` and an encrypted one doesn't, so the database's state is always knowable.
- Plaintext is deleted only after its encrypted copy has been synced to disk and checked.
- Resuming needs an unlock, because MK is never written down. That's the one case where WhisperWoof waits at the lock screen before starting.

**Turning it off:** unlock again first. The same journal runs in reverse (`PRAGMA rekey = ''` on a copy, then decrypting the files), and `vault.json` is deleted last.

**Changing the password:** the app re-wraps MK with a new salt, writes it atomically, and the old password stops working. No data is re-encrypted.

**Forgotten password:** enter the 12 words, then set a new password.

**The recovery phrase can't be shown again** because it's never stored. Instead, "Make a new recovery phrase" (needs an unlock):
- It creates a new MK.
- It runs `PRAGMA rekey` and rewrites only each file's header. The file bodies keep their own keys.
- The old phrase stops working for everything on disk.

**Restoring on a new Mac** (Migration Assistant or Time Machine): unlock with your password or phrase, then Touch ID asks to be set up again.

### 4.8 Threat model

**What this protects, beyond what FileVault already does:**
- Someone who uses your Mac, or knows your Mac password, while WhisperWoof is locked.
- Other admin users on the same Mac.
- Time Machine disks without encryption, and cloud backup services.
- Notes in iCloud or other synced folders (if notes are encrypted).
- Macs with FileVault off.
- A stolen laptop that is off or locked.
- Anyone who copies the files while WhisperWoof is locked.

**What it does not protect:**
- **Malware or code running as you while WhisperWoof is unlocked.** It can read the screen, the process memory and IPC, or log your password as you type it.
- Anyone who has your password or phrase, or your finger on your unlocked Mac.
- Text once it leaves WhisperWoof:
  - what you paste into other apps
  - the macOS clipboard and clipboard managers
  - cloud STT and LLM providers, if you use cloud mode
  - webhooks, Telegram, and exports you save
- Copies made before you turned encryption on: old Time Machine backups, APFS local snapshots, iCloud version history, and SSD blocks that haven't been overwritten. The turn-on screen says so.
- Metadata:
  - how many files there are, how big, and when (note names are timestamps)
  - the database size
  - your settings, and the fact that you use WhisperWoof
- Notes you choose to keep readable, and the Telegram inbox before import.
- API keys and webhook secrets (section 8).
- **Planted files:** someone who can write to your files can plant *new* sealed items or notes, because the public key is public. They can't read your data or change existing items without detection. As a small guard, the public key cached in `vault.json` is recomputed from MK at every unlock and compared.

## 5. What you'll see

These follow `DESIGN.md`: plain words in sentence case, capsule controls, tokens only, and one primary button per view.

- **Settings → new group "Encryption":**
  - Off: "Your history, notes and recordings are stored as plain files on this Mac." [Turn on encryption…]
  - On: "Encrypted. Unlocks with Touch ID or your password." Then the rows:
    - Unlock with Touch ID (toggle)
    - Lock when my Mac locks or sleeps (toggle)
    - Lock after I'm idle (Never / 15 min / 1 hour)
    - [Lock now]
    - [Change password…]
    - [Make a new recovery phrase…]
    - [Turn off encryption…] (destructive)
- **Lock screen** (inside the control panel, on glass): "WhisperWoof is locked. Dictation still works; new entries are saved sealed until you unlock." [Unlock with Touch ID] · Use password · Forgot your password? Use your recovery phrase.
- **The turn-on warning, in full:**
  > "If you forget your password and lose your recovery phrase, your data is gone. Nobody can recover it, including us."
- **Tray:** Lock WhisperWoof / Unlock….

## 6. Build, release, tests

- **Dependencies:** `better-sqlite3` → `better-sqlite3-multiple-ciphers`. Vendor the BIP39 English wordlist (2,048 words). Check its license when vendoring.
- **New helper:** `resources/macos-vault-helper.swift` + `scripts/build-macos-vault-helper.js`, added to `compile:native` and `extraResources`. It needs no entitlements, and the ad-hoc signing step already covers it.
- **CI:** no change to `release.yml`. `electron-rebuild -f -t prod` builds the new module.
- **Pure modules and their tests** (in `src/whisperwoof/core/vault/`):

  | Module | What its tests cover |
  |---|---|
  | `vault-keys-pure.js` | derive, wrap, unwrap, wrong password, AAD swap |
  | `recovery-phrase-pure.js` | BIP39 round trip, checksum, typo |
  | `wwenc-pure.js` | round trip, tamper each part, truncation, reorder, partial-read recovery |
  | `migration-plan-pure.js` | every interruption point → the right next step |
  | `inbox-pure.js` | order, dedupe |

- **Integration tests:** a real encrypted database under Vitest (the prebuilt binary loads in Node), and an interrupted migration on a temp folder.
- **Before calling it done:** `npm run typecheck`, `cd src && npx vite build`, a manual run through the Touch ID path, and a manual migration on a copy of a real `userData`.

## 7. Phase 2 work plan

1. Pure crypto and format modules, with their tests.
2. `bridge/vault.js`: state, lock and unlock, powerMonitor. Plus `vault-fs.js` (encrypted read/write for files and JSON), `vault-db.js` (keyed open, close and reopen), `vault-inbox.js`, `touchid.js`, and the Swift helper.
3. Plug the vault into the existing stores:
   - `database.js`, `app-init.js`: keyed, deferred open
   - `audioStorage.js`
   - `meetingAudioBuffer.js`: sealed stream, cleanup
   - `whisperServer.js`, `parakeetServer.js`: ffmpeg pipes
   - image IPC
   - notes: `markdown-route.js`, `notes-folder.js`, `project-notes.js`
   - JSON stores
   - `debugLogger.js` redaction
   - `settingsStore.ts`: stop persisting the dictionary
   - `main.js`: startup gate, lock triggers
   - tray
4. Migration runner and the turn-off path.
5. UI: Settings group, turn-on sheet, lock screen, recovery flow.
6. Docs (CLAUDE.md architecture, DESIGN.md if new patterns appear), VERSION, CHANGELOG, README badges, and the PR.

## 8. Defaults I'll use unless you say otherwise

- **12 words** (128-bit), English BIP39. 24 words would add nothing practical and is harder to write down.
- **The master key comes from the phrase** (4.1), so the phrase alone restores everything.
- **scrypt at 256 MiB**, 0.55 s measured on this Mac. My estimate for an M1 is about 1 s.
- **Touch ID re-enrolls after a fingerprint change**, following one password entry.
- **macOS only.** The Encryption group is hidden on other platforms.
- **API keys (`.env`, localStorage) and webhook secrets are out of scope.** They're credentials, not your content, and cloud dictation needs them while locked. The right home is the Keychain once releases are Developer ID signed; safeStorage prompts after every unsigned update. I'll suggest this as a separate task.
- **Imported audio files are yours.** We read them in place and never encrypt, move or delete them.

## 9. Decisions (answered 2026-09-25: all recommended)

1. **Opt-in or on by default?** Recommended: **opt-in** from Settings. Encryption makes data loss possible, and turning it on without asking would risk that for people who never saw the recovery phrase.
2. **Notes?** Recommended: **encrypted in place, with a switch "Keep notes readable by other apps"** for Obsidian and iCloud users, warned clearly. The alternatives are always encrypting notes, or never.
3. **When does it lock?** Recommended: **when the Mac locks or sleeps, and on quit**, with idle lock optional. The alternative is to lock only on quit (unlock once per launch).
4. **What does dictation do while locked?** Recommended: **it keeps working and saves into the sealed inbox.** The alternatives are pasting without saving (fn+N notes would be lost), or asking for Touch ID first.

## 10. Found along the way (unrelated to encryption)

- `whisperwoof-get-image` reads any path the renderer sends (`ipcHandlers.js:3216`).
- `whisperwoof-save-entry` accepts a renderer `audioPath`, which `storage-manager.js:177` later deletes. For imports, that deletes the user's original file.
- The meeting temp WAVs are never deleted (`keepFiles: true` on every stop).
- The audio retention setting (`audioRetentionDays`) never reaches main. The sweep is hard-coded to 30 days.
- `storage-manager.js:55` measures a `database.sqlite` that doesn't exist.
- The `cleanup-app` reset closes only one of the two connections before deleting the database.
- `extraResources` ships the repo-root `.env`.
