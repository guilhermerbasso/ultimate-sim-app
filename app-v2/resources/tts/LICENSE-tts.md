# Neural TTS (sherpa-onnx) — License Summary

Engine: sherpa-onnx (https://github.com/k2-fsa/sherpa-onnx) — Apache-2.0.
Voices: sherpa-onnx `tts-models` VITS piper bundles (the same upstream piper
voices, MIT). espeak-ng-data: espeak-ng (https://github.com/espeak-ng/espeak-ng)
— GPLv3, redistributed as the phonemizer data dir.

By default this app DOWNLOADS voice weights on demand at runtime; none are bundled.
The shared espeak-ng-data is bundled once under resources/tts/espeak-ng-data.

| Voice ID             | Source / Attribution                         | License |
|----------------------|----------------------------------------------|---------|
| pt_BR-faber-medium   | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| pt_BR-cadu-medium    | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| pt_BR-jeff-medium    | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| pt_BR-edresson-low   | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-lessac-medium  | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-amy-medium     | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-amy-low        | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-ryan-medium    | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |

Source: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
