"""Run an mlx-audio ASR model over the real-dictation clips (Apple GPU, MLX).

Writes <data>/hyps/<name>.json in the same format as run_models.js, so the
rating page and score.js treat it like any other engine. Language is left on
auto-detect and no hotwords are passed, like the other engines.

    pip install mlx-audio==0.6.3
    python eval/real-dictation/run_mlx.py --data ~/.whisperwoof-bench/dictation-real-1 \
        --name qwen3-asr-1.7b --model mlx-community/Qwen3-ASR-1.7B-8bit
"""

import argparse
import datetime
import json
import os
import time

from mlx_audio.stt import load
from mlx_audio.version import __version__ as MLX_AUDIO_VERSION


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--name", required=True, help="engine name shown in results")
    parser.add_argument("--model", required=True, help="HF repo id or local folder")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    data = os.path.expanduser(args.data)
    with open(os.path.join(data, "manifest.json")) as f:
        clips = json.load(f)["clips"]
    out_file = os.path.join(data, "hyps", f"{args.name}.json")
    done = {}
    if os.path.exists(out_file) and not args.force:
        with open(out_file) as f:
            done = json.load(f)["clips"]
    todo = [c for c in clips if str(c["id"]) not in done]
    if not todo:
        print(f"{args.name}: nothing to do")
        return

    model = load(args.model)
    model.generate(os.path.join(data, todo[0]["file"]))  # warm up
    for clip in todo:
        t0 = time.time()
        result = model.generate(os.path.join(data, clip["file"]))
        done[str(clip["id"])] = {"text": (result.text or "").strip(), "ms": round((time.time() - t0) * 1000)}

    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w") as f:
        json.dump(
            {
                "engine": args.name,
                "model": os.path.basename(args.model.rstrip("/")),
                "runtime": f"mlx-audio {MLX_AUDIO_VERSION} (Apple GPU)",
                "streaming": False,
                "date": datetime.date.today().isoformat(),
                "clips": done,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    os.chmod(out_file, 0o600)
    ms = sorted(done[str(c["id"])]["ms"] for c in todo)
    print(f"{args.name}: {len(todo)} clips, decode p50 {ms[len(ms) // 2]} ms, p90 {ms[int(len(ms) * 0.9)]} ms")


if __name__ == "__main__":
    main()
