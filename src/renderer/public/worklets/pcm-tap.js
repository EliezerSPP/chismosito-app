class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.track = options?.processorOptions?.track ?? 'mic'
    this.capacity = 4096
    this.buffer = new Float32Array(this.capacity)
    this.offset = 0
    this.phase = 0
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'flush') this.flush()
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    const hasInput = Boolean(input && input.length > 0 && input[0])
    const fallbackFrames =
      output && output.length > 0 && output[0] ? output[0].length : 128
    const frames = hasInput ? input[0].length : fallbackFrames

    if (!hasInput) {
      // Chromium entrega `inputs[0]` vacío cuando la pista está en silencio.
      // Si salimos temprano perdemos esos frames y el WAV queda más corto que
      // la grabación. Escribimos silencio para conservar la línea de tiempo.
      for (let i = 0; i < frames; i += 1) {
        this.buffer[this.offset] = 0
        this.offset += 1
        if (this.offset === this.capacity) this.flush()
      }
    } else {
      const channels = input.length
      for (let i = 0; i < frames; i += 1) {
        let sample = 0
        for (let channel = 0; channel < channels; channel += 1) {
          sample += input[channel][i] ?? 0
        }
        sample /= channels
        this.buffer[this.offset] = sample
        this.offset += 1
        if (this.offset === this.capacity) this.flush()
      }
    }

    // Chromium puede omitir worklets cuya salida es silenciosa. Escribimos un
    // tono de baja amplitud en la salida (que solo consume un MediaRecorder
    // descartable) para que el grafo siga renderizando. El PCM del WAV viene
    // de la entrada, no de esta salida.
    if (output && output.length > 0) {
      const length = output[0].length
      for (let i = 0; i < length; i += 1) {
        this.phase += (2 * Math.PI * 220) / sampleRate
        if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI
        const value = Math.sin(this.phase) * 0.01
        for (let channel = 0; channel < output.length; channel += 1) {
          output[channel][i] = value
        }
      }
    }
    return true
  }

  flush() {
    if (this.offset === 0) return
    const chunk = new Float32Array(this.offset)
    chunk.set(this.buffer.subarray(0, this.offset))
    this.port.postMessage(
      { type: 'pcm', track: this.track, samples: chunk.buffer },
      [chunk.buffer]
    )
    this.offset = 0
  }
}

registerProcessor('pcm-tap', PcmTapProcessor)
