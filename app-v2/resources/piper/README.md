# Piper TTS — Bundled voices

This directory contains the Piper TTS engine and voice models bundled with the
Windows installer via `electron-builder extraResources`.

**The binaries and models are NOT stored in git.** Run the fetch script before
building the installer:

```bash
bash scripts/fetch-piper-voices.sh
```

## Layout

```
resources/piper/
├── piper.exe          ← Windows x64 binary (fetched by script)
├── onnxruntime.dll    ← dependency extracted from piper zip
├── LICENSE            ← Piper MIT license
├── LICENSE-voices.md  ← Per-voice license summary
└── voices/
    ├── pt_BR-faber-medium.onnx
    ├── pt_BR-faber-medium.onnx.json
    ├── pt_BR-edresson_carla-low.onnx
    ├── pt_BR-edresson_carla-low.onnx.json
    ├── en_US-amy-low.onnx
    ├── en_US-amy-low.onnx.json
    ├── en_US-ryan-medium.onnx
    └── en_US-ryan-medium.onnx.json
```

## Voices & licenses

All voices are **MIT licensed**.

| Voice ID                     | Language | Quality | License |
|------------------------------|----------|---------|---------|
| pt_BR-faber-medium           | pt-BR    | medium  | MIT     |
| pt_BR-edresson_carla-low     | pt-BR    | low     | MIT     |
| en_US-amy-low                | en-US    | low     | MIT     |
| en_US-ryan-medium            | en-US    | medium  | MIT     |

Voice models sourced from: https://huggingface.co/rhasspy/piper-voices  
Piper engine: https://github.com/rhasspy/piper (MIT)

## How it works at runtime

- Main process (`src/main/tts/piper.ts`) resolves the engine at
  `process.resourcesPath/piper/piper.exe`.
- If the binary is absent the handlers return `null` and the renderer
  transparently falls back to OS Web Speech voices.
- When a Piper voice is selected and the binary is present, the main process
  synthesises a WAV, sends it to the renderer as a `Buffer`, and the renderer
  plays it via `HTMLAudioElement` — enabling `setSinkId` output-device routing.
