#!/usr/bin/env bash
# Profiles local whisper-server STT latency on real speech samples.
# Replicates the app's runtime path: same binary, same --language auto, POST /inference.
#
# Usage: bash eval/bench-stt.sh [model.bin ...]
set -uo pipefail

BIN="resources/bin/whisper-server-darwin-arm64"
MODELS_DIR="$HOME/.cache/openwhispr/whisper-models"
PORT=8899
TMP="$(mktemp -d)"
THREADS=$(( $(sysctl -n hw.ncpu) * 3 / 4 ))

trap 'kill "${SRV_PID:-0}" 2>/dev/null; rm -rf "$TMP"' EXIT

# --- generate speech samples (16kHz mono, what whisper expects) ---
say -o "$TMP/short.wav" --data-format=LEI16@16000 \
  "Hey can you remind me to call Sarah about Friday's meeting and also check the budget numbers." 2>/dev/null
say -o "$TMP/long.wav" --data-format=LEI16@16000 \
  "So basically what I'm thinking is that we should redesign the landing page because the current one isn't really converting well, and I think if we add some social proof and testimonials and maybe a clearer call to action it would probably help a lot with conversions. Let me know what you think when you get a chance." 2>/dev/null

dur() { python3 -c "import wave,sys; w=wave.open(sys.argv[1]); print(f'{w.getnframes()/w.getframerate():.1f}')" "$1"; }
echo "Samples: short=$(dur "$TMP/short.wav")s  long=$(dur "$TMP/long.wav")s  | threads=$THREADS"

MODELS=("$@")
if [ ${#MODELS[@]} -eq 0 ]; then
  MODELS=("$MODELS_DIR/ggml-base.bin" "$MODELS_DIR/ggml-large-v3-turbo.bin")
fi

now_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

for MODEL in "${MODELS[@]}"; do
  [ -f "$MODEL" ] || { echo "skip (missing): $MODEL"; continue; }
  echo ""
  echo "===== $(basename "$MODEL") ====="
  T0=$(now_ms)
  "$BIN" --model "$MODEL" --host 127.0.0.1 --port "$PORT" --threads "$THREADS" --language auto >/dev/null 2>&1 &
  SRV_PID=$!
  # wait for REAL readiness: poll /inference until it returns a transcript
  for _ in $(seq 1 200); do
    R=$(curl -s "http://127.0.0.1:$PORT/inference" -F "file=@$TMP/short.wav" -F "response_format=json" -F "temperature=0" 2>/dev/null)
    echo "$R" | grep -q '"text"' && break
    sleep 0.1
  done
  echo "  startup (load+first-infer): $(( $(now_ms) - T0 )) ms"

  for SAMPLE in short long; do
    # 3 warm runs, report each
    times=()
    for i in 1 2 3; do
      S=$(now_ms)
      curl -s "http://127.0.0.1:$PORT/inference" \
        -F "file=@$TMP/$SAMPLE.wav" -F "response_format=json" -F "temperature=0" >/dev/null 2>&1
      times+=( $(( $(now_ms) - S )) )
    done
    echo "  $SAMPLE  runs(ms): ${times[*]}"
  done

  kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null
  SRV_PID=
done
