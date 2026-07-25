# Piper TTS — French voice, fully local

Ticket #4. Piper generates the per-unit dispatch audio. Everything runs offline once
the voice model is downloaded.

## Setup

```bash
cd speech/tts
python3.12 -m venv .venv
./.venv/bin/pip install piper-tts          # tested with piper-tts 1.6.0
./.venv/bin/python -m piper.download_voices fr_FR-siwis-medium --data-dir piper-voices
```

The voice model lands in `speech/tts/piper-voices/fr_FR-siwis-medium.onnx`
(~63 MB, gitignored via `piper-voices/`). Set in `.env`:

```
PIPER_VOICE_PATH=speech/tts/piper-voices/fr_FR-siwis-medium.onnx
```

## Generate a WAV

```bash
./.venv/bin/python -m piper -m fr_FR-siwis-medium --data-dir piper-voices \
  -f out.wav -- "PC à Bravo 2 : repli immédiat vers le point d'eau numéro 2."
```

Or from Python (what the TTS service will use):

```python
from piper import PiperVoice
voice = PiperVoice.load(os.environ["PIPER_VOICE_PATH"])
with wave.open("out.wav", "wb") as f:
    voice.synthesize_wav("PC à Bravo 2 : repli immédiat.", f)
```

## Measured latency (MacBook Apple Silicon, CPU)

- Test sentence: 24 words / 7.8 s of generated audio
- End-to-end CLI run (Python start + model load + synthesis + write): **1.1 s wall**
- Well under real time (~7× faster than playback) — fine for per-unit dispatch WAVs.

Sample output: `hello_dispatch_test.wav` (generated, not committed).
