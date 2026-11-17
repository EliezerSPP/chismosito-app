import { describe, expect, it } from 'vitest'
import { buildWhisperArgs, type WhisperRunOptions } from '../src/main/whisper/runner'
import { VAD_MODEL } from '../src/shared/whisper-vad'

const base: WhisperRunOptions = {
  cliPath: 'whisper-cli.exe',
  modelPath: 'ggml-large-v3-q5_0.bin',
  wavPath: 'audio.wav',
  language: 'es',
  device: 'cuda',
  threads: 8
}

function args(overrides: Partial<WhisperRunOptions> = {}): string[] {
  return buildWhisperArgs({ ...base, ...overrides }, 'result')
}

describe('buildWhisperArgs', () => {
  it('arma los argumentos base', () => {
    expect(args()).toEqual([
      '-m',
      'ggml-large-v3-q5_0.bin',
      '-f',
      'audio.wav',
      '-l',
      'es',
      '-t',
      '8',
      '-oj',
      '-of',
      'result',
      '-pp'
    ])
  })

  it('no usa contexto ni VAD si no se piden', () => {
    const list = args()
    expect(list).not.toContain('--vad')
    expect(list).not.toContain('-mc')
    expect(list).not.toContain('-ng')
  })

  it('agrega VAD con su modelo', () => {
    const list = args({ vadModelPath: 'ggml-silero-v6.2.0.bin' })
    expect(list.join(' ')).toContain('--vad -vm ggml-silero-v6.2.0.bin')
  })

  it('agrega -mc 0 y -sns en modo sin contexto', () => {
    const list = args({ noContext: true })
    expect(list.join(' ')).toContain('-mc 0 -sns')
  })

  it('fuerza CPU y respeta el idioma', () => {
    expect(args({ device: 'cpu' })).toContain('-ng')
    expect(args({ language: '' }).slice(4, 6)).toEqual(['-l', 'es'])
  })

  it('nunca pasa menos de un hilo', () => {
    const list = args({ threads: 0 })
    expect(list[list.indexOf('-t') + 1]).toBe('1')
  })
})

describe('VAD_MODEL', () => {
  it('apunta al modelo de silero del repo de whisper.cpp', () => {
    expect(VAD_MODEL.file).toBe('ggml-silero-v6.2.0.bin')
    expect(VAD_MODEL.bytes).toBe(885_098)
    expect(VAD_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(VAD_MODEL.url).toBe(
      'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin'
    )
  })
})
