"""Live dictation bench: streaming preview vs two-pass final.

Simulates the live-dictation flow on the same app-pipeline 16k wavs as
run_asr.py:

  hotkey down -> 100ms chunks -> x-asr streaming partials (the preview)
  hotkey up   -> final pass: A = streaming final (0.6s tail pad + input_finished)
                             B = SenseVoice offline re-decode of the full audio
                             C = whisper.cpp large-v3-turbo (whisper-server, Metal)

Usage:
  python run_streaming.py                 # all systems on corpus + human controls
  python run_streaming.py --polish        # also run finals through cleanupPrompt (Ollama)
  python run_streaming.py --mem           # resident-memory probe per model
"""
import argparse, glob, json, os, re, statistics, subprocess, sys, tempfile, time, urllib.request
import numpy as np, sherpa_onnx
from run_asr import tokenize, edit_distance, load, ROOT, MODELS, WAV

REPO = os.path.dirname(os.path.dirname(ROOT))
CHUNK_S = 0.1
TAIL_PAD_S = 0.6  # parakeetWsServer.js ONLINE_END_TAIL_PADDING_S
THREADS = 4       # parakeetWsServer.js: min(4, floor(cpus * 0.75))
STREAMS = {
    "x-asr-160": "sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05",
    "x-asr-480": "sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05",
}
SV_DIR = os.path.join(MODELS, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")
# Renamed copy of resources/bin/whisper-server-darwin-arm64 (statically linked): a running
# app's sidecarReaper kills any process named whisper-server mid-bench.
WHISPER_BIN = os.environ.get("WHISPER_SERVER", os.path.join(MODELS, "whispercpp", "bench-wcpp-srv"))
WHISPER_MODEL = os.path.expanduser("~/.cache/openwhispr/whisper-models/ggml-large-v3-turbo.bin")
WHISPER_PORT = 8791
WHISPER_LOG = os.path.join(tempfile.gettempdir(), "bench-whisper-server.log")
OLLAMA = "http://localhost:11434/api/chat"
POLISH_MODEL = "qwen2.5:3b"
HAN = re.compile(r"[一-鿿]")
LATIN = re.compile(r"[a-zA-Z]")
ORIG14 = {f"cs{i:02d}" for i in range(1, 11)} | {"zh01", "zh02", "en01", "en02"}
# Common chars whose Traditional form differs; a hit means the model emitted 繁体.
TRAD = set("這個們說時間點會發對後還開過來為麼裡體檢報視頻網絡議預結變複寫實現務節處問題級據")

# --- metrics -----------------------------------------------------------------

CN_DIG = dict(zip("零一二两三四五六七八九", [0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
CN_UNIT = {"十": 10, "百": 100, "千": 1000}
EN_NUM = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
          "eight": "8", "nine": "9", "ten": "10", "twelve": "12", "twenty": "20", "thirty": "30",
          "eighty": "80", "hundred": "100", "thousand": "1000"}

def cn_to_int(s):
    total, sec, num = 0, 0, 0
    for ch in s:
        if ch in CN_DIG:
            num = CN_DIG[ch]
        elif ch in CN_UNIT:
            sec += (num or 1) * CN_UNIT[ch]; num = 0
        elif ch == "万":
            total += (sec + num) * 10000; sec = num = 0
    return str(total + sec + num)

def norm_numbers(s):
    """Secondary metric only: map spoken numerals to digits on BOTH sides so
    '十五号' vs '15号' is not scored as an ASR error (ITN style, not content)."""
    s = re.sub(r"[零一二两三四五六七八九十百千万]{2,}|[二三四五六七八九十](?=[点号月块秒分次个楼%])",
               lambda m: cn_to_int(m.group()), s)
    s = s.replace("%", " percent ")
    return re.sub(r"[A-Za-z]+", lambda m: EN_NUM.get(m.group().lower(), m.group()), s)

def score(ref, hyp):
    r, h = tokenize(ref), tokenize(hyp)
    rn, hn = tokenize(norm_numbers(ref)), tokenize(norm_numbers(hyp))
    return {"err": edit_distance(r, h), "n": len(r), "err_norm": edit_distance(rn, hn), "n_norm": len(rn)}

def script_mix(text):
    han, latin = len(HAN.findall(text)), len(LATIN.findall(text))
    return "en" if han == 0 else ("zh" if latin < 2 else "mixed")

def revisions(partials):
    """Tokens shown then taken back. partials = [(t, text)] in emit order."""
    emitted = revised = rewrites = 0
    prev = []
    for _, text in partials:
        cur = tokenize(text)
        k = 0
        while k < min(len(prev), len(cur)) and prev[k] == cur[k]:
            k += 1
        gone = len(prev) - k
        revised += gone
        rewrites += gone > 0
        emitted += len(cur) - k
        prev = cur
    return emitted, revised, rewrites

def speech_onset(x, sr):
    frame = int(0.02 * sr)
    e = np.array([np.sqrt(np.mean(x[i:i + frame] ** 2)) for i in range(0, len(x) - frame, frame)])
    idx = np.argmax(e > max(0.01, e.max() * 0.05)) if e.size else 0
    return idx * 0.02

# --- systems -----------------------------------------------------------------

def find(d, pat):
    hits = sorted(glob.glob(os.path.join(d, pat)))
    if not hits:
        raise FileNotFoundError(f"{pat} in {d}")
    return hits[0]

def build_stream(name):
    d = os.path.join(MODELS, STREAMS[name])
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=find(d, "tokens.txt"), encoder=find(d, "encoder*.onnx"),
        decoder=find(d, "decoder*.onnx"), joiner=find(d, "joiner*.onnx"),
        num_threads=THREADS, sample_rate=16000, feature_dim=80, decoding_method="greedy_search")

def last_token_time(rec, st):
    try:
        ts = rec.get_result_all(st).timestamps
        return ts[-1] if ts else None
    except Exception:
        return None

def run_stream(rec, x, sr):
    st = rec.create_stream()
    step = int(CHUNK_S * sr)
    partials, lags, chunk_walls, last = [], [], [], ""
    for i in range(0, len(x), step):
        t0 = time.perf_counter()
        st.accept_waveform(sr, x[i:i + step])
        while rec.is_ready(st):
            rec.decode_stream(st)
        chunk_walls.append(time.perf_counter() - t0)
        text = rec.get_result(st).strip()
        if text != last:
            t_audio = min(i + step, len(x)) / sr
            partials.append((round(t_audio, 2), text))
            lt = last_token_time(rec, st)
            if lt is not None:
                lags.append(t_audio - lt)
            last = text
    t0 = time.perf_counter()
    st.accept_waveform(sr, np.zeros(int(TAIL_PAD_S * sr), dtype=np.float32))
    st.input_finished()
    while rec.is_ready(st):
        rec.decode_stream(st)
    final = rec.get_result(st).strip()
    post = time.perf_counter() - t0
    return {"final": final, "post_stop_s": post, "partials": partials, "lags": lags,
            "chunk_wall_max_s": max(chunk_walls), "compute_s": sum(chunk_walls) + post}

def build_sv():
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=os.path.join(SV_DIR, "model.int8.onnx"), tokens=os.path.join(SV_DIR, "tokens.txt"),
        language="", use_itn=True, num_threads=THREADS)

def run_offline(rec, x, sr):
    st = rec.create_stream()
    t0 = time.perf_counter()
    st.accept_waveform(sr, x)
    rec.decode_stream(st)
    return st.result.text.strip(), time.perf_counter() - t0

class Whisper:
    """whisper-server with the app's args (whisperServer.js:255-269), Metal default."""
    def __enter__(self):
        args = [WHISPER_BIN, "--model", WHISPER_MODEL, "--host", "127.0.0.1",
                "--port", str(WHISPER_PORT), "--language", "auto"]
        t0 = time.perf_counter()
        self.proc = subprocess.Popen(args, cwd=os.path.dirname(WHISPER_BIN),
                                     stdout=subprocess.DEVNULL, stderr=open(WHISPER_LOG, "w"))
        while True:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{WHISPER_PORT}/", timeout=1); break
            except Exception:
                if self.proc.poll() is not None:
                    raise RuntimeError("whisper-server exited; see " + WHISPER_LOG)
                time.sleep(0.2)
        self.load_s = time.perf_counter() - t0
        return self

    def transcribe(self, path):
        b = "----bench"
        body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n"
                f"Content-Type: audio/wav\r\n\r\n").encode() + open(path, "rb").read() + (
                f"\r\n--{b}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nauto\r\n"
                f"--{b}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n--{b}--\r\n").encode()
        req = urllib.request.Request(f"http://127.0.0.1:{WHISPER_PORT}/inference", data=body,
                                     headers={"Content-Type": f"multipart/form-data; boundary={b}"})
        t0 = time.perf_counter()
        text = json.loads(urllib.request.urlopen(req, timeout=300).read())["text"]
        return text.strip(), time.perf_counter() - t0

    def __exit__(self, *a):
        self.proc.terminate(); self.proc.wait()

# --- polish ------------------------------------------------------------------

def polish_prompt(text):
    body = json.load(open(os.path.join(REPO, "src/locales/en/prompts.json")))["cleanupPrompt"]
    hints = json.load(open(os.path.join(REPO, "src/whisperwoof/core/language/script-mix-hints.json")))
    mix = "none" if not (HAN.search(text) or LATIN.search(text)) else (
        "en" if not HAN.search(text) else ("zh" if len(LATIN.findall(text)) < 2 else "mixed"))
    hint = hints.get(mix, "")
    return ("Output in the same language as the input. Never translate.\n\n" + body
            + (f"\n\n{hint}" if hint else ""))

def polish(text):
    """Mirrors eval/run-polish-eval.js (prod sampling params, prod prompt)."""
    if not text:
        return "", 0.0
    msg = {"model": POLISH_MODEL, "stream": False,
           "options": {"temperature": 0.3, "top_k": 40, "top_p": 0.9, "num_predict": 512},
           "messages": [{"role": "system", "content": polish_prompt(text)}, {"role": "user", "content": text}]}
    req = urllib.request.Request(OLLAMA, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    out = json.loads(urllib.request.urlopen(req, timeout=120).read())["message"]["content"]
    return re.sub(r"<think>[\s\S]*?</think>", "", out).strip(), time.perf_counter() - t0

# --- driver ------------------------------------------------------------------

def human_cases():
    """Human recordings shipped with the models + their reference transcripts."""
    out = [{"id": "h-sv-zh", "wav": os.path.join(SV_DIR, "test_wavs/zh.wav"), "text": "开放时间早上9点至下午5点。"},
           {"id": "h-sv-en", "wav": os.path.join(SV_DIR, "test_wavs/en.wav"),
            "text": "The tribal chieftain called for the boy and presented him with 50 pieces of gold."}]
    refs = json.load(open(os.path.join(ROOT, "human_refs.json"))) if os.path.exists(
        os.path.join(ROOT, "human_refs.json")) else []
    return out + [dict(r, wav=os.path.join(MODELS, r["wav"])) for r in refs]

def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))] if xs else None

def aggregate(rows, key):
    def mer(sel, norm=False):
        e = sum(r[key]["err_norm" if norm else "err"] for r in sel)
        n = sum(r[key]["n_norm" if norm else "n"] for r in sel)
        return round(e / n, 4) if n else None
    mixed = [r for r in rows if r["mix"] == "mixed"]
    return {"MER": mer(rows), "MER_numnorm": mer(rows, True), "MER_codeswitch": mer(mixed),
            "MER_long": mer([r for r in rows if r["id"].startswith("lg")]),
            "MER_orig14": mer([r for r in rows if r["id"] in ORIG14])}

def evaluate(cases, do_polish, streams, offline=True):
    rows = []
    for c in cases:
        x, sr = load(c["wav"])
        rows.append({"id": c["id"], "ref": c["text"], "mix": script_mix(c["text"]),
                     "audio_s": round(len(x) / sr, 2), "onset_s": speech_onset(x, sr), "x": x, "sr": sr})
    systems = {}
    for name in streams:
        try:
            t0 = time.perf_counter(); rec = build_stream(name); load_s = time.perf_counter() - t0
        except Exception as e:
            print(f"!! {name} failed to load: {e}"); systems[name] = {"error": str(e)}; continue
        systems[name] = {"load_s": round(load_s, 2)}
        for r in rows:
            out = run_stream(rec, r["x"], r["sr"])
            em, rv, rw = revisions(out["partials"])
            first = next((t for t, txt in out["partials"] if tokenize(txt)), None)
            r[name] = dict(score(r["ref"], out["final"]), hyp=out["final"], post_stop_s=out["post_stop_s"],
                           partials=out["partials"], n_partials=len(out["partials"]),
                           first_partial_s=first, first_partial_after_onset_s=None if first is None else first - r["onset_s"],
                           mean_lag_s=statistics.mean(out["lags"]) if out["lags"] else None,
                           emitted=em, revised=rv, rewrites=rw, chunk_wall_max_s=out["chunk_wall_max_s"],
                           rtf=out["compute_s"] / r["audio_s"])
            print(f"  {name} {r['id']} mer={r[name]['err']/max(1,r[name]['n']):.0%} rev={rv}/{em} "
                  f"post={out['post_stop_s']*1000:.0f}ms | {out['final'][:90]}")
    sv = build_sv() if offline else None
    for r in rows if offline else []:
        hyp, wall = run_offline(sv, r["x"], r["sr"])
        r["sensevoice"] = dict(score(r["ref"], hyp), hyp=hyp, post_stop_s=wall)
        print(f"  sv {r['id']} mer={r['sensevoice']['err']/max(1,r['sensevoice']['n']):.0%} {wall*1000:.0f}ms | {hyp[:90]}")
    if offline:
        run_whisper(rows, cases, systems)
    finals = [s for s in list(streams) + ["sensevoice", "whisper-turbo"] if s in rows[0]]
    return summarize(rows, systems, finals, streams, do_polish)

def run_whisper(rows, cases, systems):
    with Whisper() as w:
        w.transcribe(cases[0]["wav"])  # warm-up (Metal kernels), excluded from timing
        systems["whisper-turbo"] = {"load_s": round(w.load_s, 2)}
        for r, c in zip(rows, cases):
            hyp, wall = w.transcribe(c["wav"])
            r["whisper-turbo"] = dict(score(r["ref"], hyp), hyp=hyp, post_stop_s=wall)
            print(f"  wt {r['id']} mer={r['whisper-turbo']['err']/max(1,r['whisper-turbo']['n']):.0%} {wall*1000:.0f}ms | {hyp[:90]}")

def summarize(rows, systems, finals, streams, do_polish):
    if do_polish:
        for s in finals:
            for r in rows:
                out, wall = polish(r[s]["hyp"])
                r[s]["polished"] = dict(score(r["ref"], out), hyp=out, polish_s=wall)
            print(f"  polished {s}")
    for s in finals:
        sel = [r for r in rows if s in r]
        agg = dict(systems.get(s, {}), **aggregate(sel, s))
        posts = [r[s]["post_stop_s"] for r in sel]
        agg.update(post_stop_p50_ms=round(pct(posts, .5) * 1000), post_stop_p90_ms=round(pct(posts, .9) * 1000),
                   trad_chars=sum(ch in TRAD for r in sel for ch in r[s]["hyp"]))
        if s in streams:
            em = sum(r[s]["emitted"] for r in sel); rv = sum(r[s]["revised"] for r in sel)
            fp = [r[s]["first_partial_after_onset_s"] for r in sel if r[s]["first_partial_after_onset_s"] is not None]
            lags = [r[s]["mean_lag_s"] for r in sel if r[s]["mean_lag_s"] is not None]
            agg.update(revision_rate=round(rv / em, 4) if em else None,
                       rewrites_per_utt=round(sum(r[s]["rewrites"] for r in sel) / len(sel), 2),
                       partials_per_utt=round(sum(r[s]["n_partials"] for r in sel) / len(sel), 1),
                       first_partial_after_onset_p50_s=round(pct(fp, .5), 2) if fp else None,
                       mean_lag_s=round(statistics.mean(lags), 2) if lags else None,
                       max_chunk_wall_ms=round(max(r[s]["chunk_wall_max_s"] for r in sel) * 1000, 1),
                       rtf=round(statistics.mean(r[s]["rtf"] for r in sel), 3))
        if do_polish:
            sub = [dict(r, **{"p": r[s]["polished"]}) for r in sel]
            pa = aggregate(sub, "p")
            agg.update(polished_MER=pa["MER"], polished_MER_codeswitch=pa["MER_codeswitch"],
                       polished_MER_numnorm=pa["MER_numnorm"])
        systems[s] = agg
    for r in rows:
        r.pop("x"); r.pop("sr")
    return systems, rows

MEM_PROBE = r"""
import sys, os, psutil, resource, numpy as np
sys.path.insert(0, %r); import run_streaming as R
p = psutil.Process(); base = p.memory_info().rss
rec = R.build_stream(sys.argv[1]) if sys.argv[1] in R.STREAMS else R.build_sv()
x, sr = R.load(os.path.join(R.WAV, "lg01.wav"))
if sys.argv[1] in R.STREAMS: R.run_stream(rec, x, sr)
else: R.run_offline(rec, x, sr)
print((p.memory_info().rss - base) / 2**20, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20)
"""

def mem_probe():
    out = {}
    for name in list(STREAMS) + ["sensevoice"]:
        r = subprocess.run([sys.executable, "-c", MEM_PROBE % ROOT, name], capture_output=True, text=True, cwd=ROOT)
        try:
            delta, peak = map(float, r.stdout.split()[-2:])
            out[name] = {"rss_delta_mb": round(delta), "peak_rss_mb": round(peak)}
        except Exception:
            out[name] = {"error": r.stderr[-400:]}
    import psutil
    with Whisper() as w:
        w.transcribe(os.path.join(WAV, "lg01.wav"))
        rss = psutil.Process(w.proc.pid).memory_info().rss
        fp = subprocess.run(["footprint", str(w.proc.pid)], capture_output=True, text=True).stdout
        m = re.search(r"Footprint:\s*([\d.]+)\s*([KMG]B)", fp)
        out["whisper-turbo"] = {"rss_mb": round(rss / 2**20),
                                "phys_footprint": f"{m.group(1)} {m.group(2)}" if m else None}
    return out

def main():
    global TAIL_PAD_S
    ap = argparse.ArgumentParser()
    ap.add_argument("--polish", action="store_true")
    ap.add_argument("--mem", action="store_true")
    ap.add_argument("--streams", default=",".join(STREAMS))
    ap.add_argument("--only", default="")
    ap.add_argument("--tail-pad", type=float, default=TAIL_PAD_S)
    ap.add_argument("--no-offline", action="store_true", help="streams only (skip SenseVoice/whisper)")
    a = ap.parse_args()
    TAIL_PAD_S = a.tail_pad
    suffix = "" if a.tail_pad == 0.6 else f"_pad{a.tail_pad}"
    streams = [s for s in a.streams.split(",") if s]
    out_path = os.path.join(ROOT, "results-streaming.json")
    res = json.load(open(out_path)) if os.path.exists(out_path) else {}
    if a.mem:
        res["memory"] = mem_probe(); print(json.dumps(res["memory"], indent=1))
    else:
        corpus = [dict(c, wav=os.path.join(WAV, c["id"] + ".wav")) for c in json.load(open(os.path.join(ROOT, "corpus.json")))]
        if a.only:
            corpus = [c for c in corpus if c["id"] in a.only.split(",")]
        for tag, cases in (("corpus", corpus), ("human", human_cases())):
            print(f"\n##### {tag} ({len(cases)} cases)")
            systems, rows = evaluate(cases, a.polish, streams, not a.no_offline)
            res[tag + suffix] = {"tail_pad_s": TAIL_PAD_S, "systems": systems, "rows": rows}
            print(json.dumps(systems, indent=1, ensure_ascii=False))
    res["meta"] = {"date": time.strftime("%Y-%m-%d"), "chunk_s": CHUNK_S, "tail_pad_s": TAIL_PAD_S,
                   "threads": THREADS, "sherpa_onnx": sherpa_onnx.__version__, "polish_model": POLISH_MODEL}
    json.dump(res, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"wrote {out_path}")

if __name__ == "__main__":
    main()
