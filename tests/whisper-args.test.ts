import { describe, expect, it } from 'vitest'
import { buildWhisperArgs } from '../src/main/whisper/args'

const base = {
  modelPath: 'C:\\models\\ggml-medium-q5_0.bin',
  wavPath: 'C:\\tmp\\mic.wav',
  language: 'es',
  threads: 10,
  outputBase: 'C:\\tmp\\result'
}

describe('buildWhisperArgs', () => {
  it('activa VAD y los flags anti-bucle con un modelo VAD disponible', () => {
    const args = buildWhisperArgs({
      ...base,
      device: 'cpu',
      vadModelPath: 'C:\\whisper\\ggml-silero-v5.1.2.bin'
    })

    expect(args).toContain('--vad')
    expect(args[args.indexOf('-vm') + 1]).toBe('C:\\whisper\\ggml-silero-v5.1.2.bin')
    expect(args[args.indexOf('-mc') + 1]).toBe('0')
    expect(args[args.indexOf('-et') + 1]).toBe('2.0')
    expect(args).toContain('-sns')
    expect(args).toContain('-ng')
  })

  it('omite VAD si no hay modelo y no usa -ng en CUDA', () => {
    const args = buildWhisperArgs({
      ...base,
      device: 'cuda',
      vadModelPath: null
    })

    expect(args).not.toContain('--vad')
    expect(args).not.toContain('-vm')
    expect(args).not.toContain('-ng')
  })
})
