#!/usr/bin/env bash
# Ticket #5 — Convert source audios to clean + radio-degraded WAV.
#
# Input : data/audio/source/audio_NN_<name>.m4a
# Output: data/audio/NN_<name>_clean.wav  (16 kHz mono PCM)
#         data/audio/NN_<name>_radio.wav  (bandpass 300-3400 Hz + pink noise + compression)
#
# Usage: ./scripts/platform/convert_audio.sh
# Requires: ffmpeg

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$REPO_ROOT/data/audio/source"
OUT_DIR="$REPO_ROOT/data/audio"

for src in "$SRC_DIR"/audio_*.m4a; do
  base="$(basename "$src" .m4a)"          # audio_01_alpha_initial
  stem="${base#audio_}"                   # 01_alpha_initial
  clean="$OUT_DIR/${stem}_clean.wav"
  radio="$OUT_DIR/${stem}_radio.wav"

  echo "== $base"

  # Clean: 16 kHz mono PCM, loudness-normalized so all takes sit at a consistent level.
  ffmpeg -y -v error -i "$src" \
    -af "loudnorm=I=-19:TP=-1.5:LRA=7" \
    -ar 16000 -ac 1 -c:a pcm_s16le "$clean"

  # Radio: telephone-band voice (300-3400 Hz), heavy compression like a radio limiter,
  # mixed with low-level pink noise, then the same output format as clean.
  ffmpeg -y -v error -i "$src" -filter_complex \
    "[0:a]highpass=f=300,lowpass=f=3400,acompressor=threshold=-18dB:ratio=8:attack=5:release=120:makeup=6dB,aformat=sample_rates=16000:channel_layouts=mono[voice];\
     anoisesrc=color=pink:amplitude=0.025:sample_rate=16000[noise];\
     [voice][noise]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95" \
    -ar 16000 -ac 1 -c:a pcm_s16le "$radio"
done

echo
echo "Done. Generated files:"
ls -l "$OUT_DIR"/*_clean.wav "$OUT_DIR"/*_radio.wav
