"""Generate zh-en code-switching speech for the WhisperWoof dictation bench."""
import json, os, sys, time
import sherpa_onnx, soundfile as sf

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(ROOT), "models")
M = os.path.join(MODELS, "vits-melo-tts-zh_en")
OUT = os.path.join(ROOT, "raw")
os.makedirs(OUT, exist_ok=True)

cfg = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=os.path.join(M, "model.onnx"),
            lexicon=os.path.join(M, "lexicon.txt"),
            tokens=os.path.join(M, "tokens.txt"),
            dict_dir=os.path.join(M, "dict"),
        ),
        provider="cpu",
        num_threads=4,
    ),
    rule_fsts=",".join(
        os.path.join(M, f) for f in ("date.fst", "number.fst", "phone.fst", "new_heteronym.fst")
    ),
    max_num_sentences=1,
)
if not cfg.validate():
    sys.exit("invalid TTS config")

tts = sherpa_onnx.OfflineTts(cfg)
cases = json.load(open(os.path.join(ROOT, "corpus.json")))

for c in cases:
    t0 = time.time()
    audio = tts.generate(c["text"], sid=0, speed=1.0)
    path = os.path.join(OUT, f"{c['id']}.wav")
    sf.write(path, audio.samples, samplerate=audio.sample_rate, subtype="PCM_16")
    dur = len(audio.samples) / audio.sample_rate
    print(f"{c['id']:6s} {dur:5.2f}s  gen={time.time()-t0:5.2f}s  {path}")
print(f"\n{len(cases)} files -> {OUT}")
