"""WhisperWoof dictation bench — zh/en code-switching.

Feeds the exact 16k mono PCM that whisper.cpp receives in the real app
(TTS -> webm/opus stereo -> ffmpeg -ar 16000 -ac 1 -c:a pcm_s16le)
through each candidate ASR config and scores Mixed Error Rate.
"""
import json, os, re, sys, time, unicodedata
import numpy as np, soundfile as sf, sherpa_onnx

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(ROOT), "models")
WAV = os.path.join(ROOT, "wav")

CJK = re.compile(r"[一-鿿㐀-䶿]")

def tokenize(s):
    """Chinese -> per-character tokens, English -> per-word. Punctuation dropped."""
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r"[^\w一-鿿\s]", " ", s)
    out = []
    for chunk in s.split():
        buf = ""
        for ch in chunk:
            if CJK.match(ch):
                if buf:
                    out.append(buf); buf = ""
                out.append(ch)
            else:
                buf += ch
        if buf:
            out.append(buf)
    return out

def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]

def mer(ref, hyp):
    r, h = tokenize(ref), tokenize(hyp)
    return (edit_distance(r, h) / len(r)) if r else 0.0, len(r)

def load(path):
    data, sr = sf.read(path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data, sr

def build(name):
    if name.startswith("sensevoice"):
        lang = name.split(":")[1] if ":" in name else "auto"
        d = os.path.join(MODELS, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=os.path.join(d, "model.int8.onnx"),
            tokens=os.path.join(d, "tokens.txt"),
            language="" if lang == "auto" else lang,
            use_itn=True, num_threads=4,
        )
    head = name.split(":")[0]
    lang = name.split(":")[1] if ":" in name else "auto"
    fp32 = head.endswith("-fp32")
    if fp32:
        head = head[:-5]
    size = head.split("-", 1)[1]
    q = "" if fp32 else ".int8"
    d = os.path.join(MODELS, f"sherpa-onnx-whisper-{size}")
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=os.path.join(d, f"{size}-encoder{q}.onnx"),
        decoder=os.path.join(d, f"{size}-decoder{q}.onnx"),
        tokens=os.path.join(d, f"{size}-tokens.txt"),
        language="" if lang == "auto" else lang,
        task="transcribe", num_threads=4,
    )

def main(configs):
    cases = json.load(open(os.path.join(ROOT, "corpus.json")))
    report = {}
    for cfg in configs:
        try:
            t0 = time.time()
            rec = build(cfg)
            load_s = time.time() - t0
        except Exception as e:
            print(f"!! {cfg}: {e}"); continue
        rows, tot_err, tot_ref, tot_audio, tot_wall = [], 0.0, 0, 0.0, 0.0
        for c in cases:
            p = os.path.join(WAV, c["id"] + ".wav")
            samples, sr = load(p)
            st = rec.create_stream()
            t0 = time.time()
            st.accept_waveform(sr, samples)
            rec.decode_stream(st)
            wall = time.time() - t0
            hyp = st.result.text.strip()
            e, n = mer(c["text"], hyp)
            tot_err += e * n; tot_ref += n
            tot_audio += len(samples) / sr; tot_wall += wall
            rows.append({"id": c["id"], "ref": c["text"], "hyp": hyp, "mer": e, "wall_s": wall})
        agg = {
            "config": cfg, "load_s": round(load_s, 2),
            "MER": round(tot_err / tot_ref, 4) if tot_ref else None,
            "RTF": round(tot_wall / tot_audio, 3),
            "wall_s": round(tot_wall, 1), "audio_s": round(tot_audio, 1),
            "rows": rows,
        }
        report[cfg] = agg
        print(f"\n=== {cfg}  MER={agg['MER']:.1%}  RTF={agg['RTF']}  load={agg['load_s']}s ===")
        for r in rows:
            print(f"  {r['id']} mer={r['mer']:.0%} {r['wall_s']:.2f}s | {r['hyp'][:110]}")
    out = os.path.join(ROOT, "results.json")
    prev = json.load(open(out)) if os.path.exists(out) else {}
    prev.update(report)
    json.dump(prev, open(out, "w"), ensure_ascii=False, indent=2)
    print(f"\nwrote {out}")

if __name__ == "__main__":
    main(sys.argv[1:])
