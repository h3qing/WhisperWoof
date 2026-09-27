# Words in images (Clipboard search)

Opt-in. Clipboard search finds an image by the words in it. macOS reads the
text on the Mac with Apple's Vision framework, in the background, and the
words are stored next to the history they belong to.

## Flow

```
 copy a screenshot                                  Clipboard view
        │                                          ┌────────────────────────────┐
        ▼                                          │ [search: bottleneck      ] │
 app-init storeClipboardImage                      │ Words in images ●          │
        │  saves bf_entries row + image file       │ Reading…: 2,340 of 13,179  │
        │                                          │ ┌──────┐                   │
        └─► clipboard-image-text.noteNewImage(id)  │ │ img  │ …the real         │
                   │                               │ └──────┘ [bottleneck] was… │
                   ▼                               └────────────▲───────────────┘
        ┌─────────── reader loop (main) ───────────┐            │ listClipboard:
        │ decidePace(): off? locked? dictating?    │            │ raw_text / polished
        │ meeting? hot? busy? battery?             │            │ OR bf_image_text LIKE
        │ next: new copies → older, newest first   │            │
        │ resolveAppFile (whisperwoof-images only) │            │
        │ read bytes (sealed → decrypt in memory)  │            │
        └───────┬──────────────────────────▲───────┘            │
                │ u32 length + bytes       │ {"text": "…"}      │
                ▼  (stdin pipe)            │ (stdout line)      │
        ┌──────────────────────────────────┴───────┐            │
        │ macos-ocr-helper (Swift, Vision)          │            │
        │ background band · one image at a time     │            │
        │ no files written · no network             │            │
        └───────────────────────────────────────────┘            │
                │                                                 │
                ▼                                                 │
        bf_image_text (entry_id, status, text, read_at) ─────────┘
        same database as the history (SQLCipher when encrypted);
        trigger: row goes when its bf_entries row goes
```

## Decisions

- **Engine: Apple Vision, not a bundled model.** It's already on every Mac,
  runs on the Neural Engine, reads Chinese and English together, and needs no
  download. A bundled OCR model (Tesseract, PaddleOCR) would add tens of MB
  and read CJK worse. Languages come from the Mac's preferred languages:
  Chinese/Japanese/Korean first (their models also read Latin), English always.
- **Consent before anything is read.** The switch opens a panel that says why
  (search), how (on this Mac), the cost (older images in the background, only
  on power), privacy (words stored with the history, encrypted only when
  encryption is on; a screenshot of a password becomes searchable text) and
  how to undo it. Off deletes every word (`DELETE FROM bf_image_text`); the
  images stay.
- **Never in the way.** One image at a time, the helper at Darwin background
  priority (`setpriority(PRIO_DARWIN_PROCESS, 0, PRIO_DARWIN_BG)`) plus
  `nice 19`. After each older image it rests at least as long as the image
  took (twice as long while the user is active), so the helper works at most
  half the time. Pauses (`decidePace`):

  | Condition | What happens |
  |---|---|
  | Dictating (start → 20 s after stop) | wait |
  | Meeting recording | wait, check every 30 s |
  | Load average ≥ 0.75 per core | wait, check every 20 s |
  | Thermal state serious / critical | wait, check every 60 s |
  | On battery | new copies only; older images wait |
  | Locked (database closed) | wait for the database to open again |

- **Safety.** Paths come from our own rows but still pass `resolveAppFile`
  (strictly inside `userData/whisperwoof-images`), so a bad row can't point
  the reader at another file. Bytes are piped; a sealed image is decrypted in
  memory and wiped after its answer. On lock the helper is killed before the
  keys go. Logs carry counts, never recognized text.
- **Failure handling.** An image the helper answers "unreadable" is stored as
  `failed` and not retried. A crash or 60 s timeout on the same image three
  times marks it `failed`. The helper says `{"ready":true}` when it starts; if
  it dies before that three times in a row, the helper is broken (not the
  image) and reading is unavailable until restart.

## Wire format

```
stdin   ┌──────────────┬──────────────────────┐
        │ u32 BE length│ image bytes (PNG, …) │  × n, EOF ends the helper
        └──────────────┴──────────────────────┘
stdout  {"ready":true,"languages":["zh-Hans","en-US"]}
        {"text":"line one\nline two","lines":2}
        {"error":"unreadable","message":"…"}   not an image macOS can open
        {"error":"failed","message":"…"}       recognition failed
```

## Not done (yet)

- History and Cmd+K search don't include image words; only the Clipboard view
  does.
- Other platforms: the switch is hidden where the helper isn't available.
