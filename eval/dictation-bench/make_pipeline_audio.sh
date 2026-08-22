#!/usr/bin/env bash
# Replicate WhisperWoof's real capture path:
#   MediaRecorder (audio/webm;codecs=opus, channelCount:2)  -- audioManager.js:241,357
#   -> whisperServer._convertToWav -> ffmpegUtils.convertToWav {16000, 1}  -- ffmpegUtils.js:110
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p webm wav
for f in raw/*.wav; do
  id=$(basename "$f" .wav)
  # 1. what the browser hands us: stereo webm/opus
  ffmpeg -v error -y -i "$f" -ac 2 -c:a libopus -b:a 128k "webm/$id.webm"
  # 2. what whisper.cpp actually receives — app's exact args
  ffmpeg -v error -y -i "webm/$id.webm" -ar 16000 -ac 1 -c:a pcm_s16le "wav/$id.wav"
done
echo "webm: $(ls webm | wc -l)  wav16k: $(ls wav | wc -l)"
ffprobe -v error -show_entries stream=sample_rate,channels,codec_name -of csv=p=0 wav/cs01.wav
