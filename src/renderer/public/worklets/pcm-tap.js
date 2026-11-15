class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.track = options?.processorOptions?.track ?? 'mic'
    this.capacity = 4096
    this.buffer = new Float32Array(this.capacity)
    this.offset = 0
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'flush') this.flush()
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frames = input[0].length
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
