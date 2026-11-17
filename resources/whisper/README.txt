whisper.cpp
===========

Los binarios de `win32-x64/Release` provienen de whisper.cpp (https://github.com/ggml-org/whisper.cpp),
build b5454, y se distribuyen bajo la licencia MIT.

El modelo `ggml-medium-q5_0.bin` se descarga aparte desde
https://huggingface.co/ggerganov/whisper.cpp y corresponde a los pesos de Whisper,
publicados por OpenAI bajo licencia MIT.

El modelo `ggml-silero-v5.1.2.bin` proviene de
https://huggingface.co/ggml-org/whisper-vad y corresponde a Silero VAD,
publicado bajo licencia MIT. Se usa con `--vad` para ignorar silencios.

La app no modifica los binarios; solo los ejecuta como proceso local.
