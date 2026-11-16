import { describe, expect, it } from 'vitest'
import {
  describeWhisperModels,
  modelFit,
  recommendWhisperModel,
  type WhisperHardware
} from '../src/shared/whisper-policy'
import { whisperModel } from '../src/shared/whisper-models'

const gb = 1024

function hw(overrides: Partial<WhisperHardware> = {}): WhisperHardware {
  return {
    vramMb: null,
    gpuName: null,
    vramSource: 'none',
    ramMb: 16 * gb,
    cores: 8,
    cudaBinary: false,
    ...overrides
  }
}

describe('recommendWhisperModel', () => {
  it('sin GPU elige por RAM y nunca pide CUDA', () => {
    expect(recommendWhisperModel(hw({ ramMb: 32 * gb }))).toEqual({
      recommendedId: 'small-q8_0',
      reason: 'cpu'
    })
    expect(recommendWhisperModel(hw({ ramMb: 8 * gb })).recommendedId).toBe('small-q5_1')
    expect(recommendWhisperModel(hw({ ramMb: 4 * gb })).recommendedId).toBe('base-q5_1')
    expect(recommendWhisperModel(hw({ ramMb: 3 * gb })).recommendedId).toBe('tiny-q5_1')
  })

  it('con CUDA escala por VRAM', () => {
    const cuda = (vramMb: number, ramMb = 16 * gb): WhisperHardware =>
      hw({ vramMb, ramMb, cudaBinary: true, gpuName: 'NVIDIA Test', vramSource: 'nvidia-smi' })

    expect(recommendWhisperModel(cuda(12 * gb))).toEqual({
      recommendedId: 'large-v3-f16',
      reason: 'gpu'
    })
    expect(recommendWhisperModel(cuda(8 * gb)).recommendedId).toBe('large-v3-q5_0')
    expect(recommendWhisperModel(cuda(4 * gb)).recommendedId).toBe('large-v3-turbo-q5_0')
    expect(recommendWhisperModel(cuda(3 * gb)).recommendedId).toBe('small-q8_0')
    expect(recommendWhisperModel(cuda(2 * gb)).recommendedId).toBe('base-q8_0')
    expect(recommendWhisperModel(cuda(1 * gb)).recommendedId).toBe('tiny-q5_1')
  })

  it('cae a CPU cuando la VRAM no alcanza ni para el modelo mínimo', () => {
    const result = recommendWhisperModel(
      hw({ vramMb: 512, cudaBinary: true, gpuName: 'NVIDIA pequeña', vramSource: 'nvidia-smi' })
    )
    expect(result.reason).toBe('cpu')
    expect(result.recommendedId).not.toContain('large')
  })

  it('nunca recomienda un modelo que no quepa en RAM', () => {
    const result = recommendWhisperModel(
      hw({ vramMb: 24 * gb, cudaBinary: true, gpuName: 'NVIDIA grande', ramMb: 6 * gb })
    )
    // large-v3-f16 pide ~3.1 GB de RAM; con 6 GB entra, pero con 3 GB no.
    expect(modelFit(whisperModel('large-v3-f16')!, result ? hw({ ramMb: 6 * gb }) : hw())).not.toBe(
      'ram'
    )
    const tight = recommendWhisperModel(
      hw({ vramMb: 24 * gb, cudaBinary: true, gpuName: 'NVIDIA grande', ramMb: 3 * gb })
    )
    expect(whisperModel(tight.recommendedId)!.ramGb * 1024).toBeLessThanOrEqual(3 * gb * 0.85)
  })

  it('ignora la VRAM si el pack CUDA no está instalado', () => {
    const result = recommendWhisperModel(
      hw({ vramMb: 12 * gb, cudaBinary: false, gpuName: 'NVIDIA sin pack' })
    )
    expect(result.reason).toBe('cpu')
    expect(whisperModel(result.recommendedId)!.family).toBe('small')
  })
})

describe('modelFit', () => {
  it('marca GPU, CPU y RAM según el equipo', () => {
    const medium = whisperModel('medium-q5_0')!
    expect(modelFit(medium, hw({ vramMb: 4 * gb, cudaBinary: true }))).toBe('gpu')
    expect(modelFit(medium, hw({ vramMb: 1 * gb, cudaBinary: true }))).toBe('cpu')
    expect(modelFit(medium, hw({ cudaBinary: false }))).toBe('cpu')
    expect(modelFit(whisperModel('large-v3-f16')!, hw({ ramMb: 2 * gb }))).toBe('ram')
  })

  it('respeta el margen del 15 % de VRAM', () => {
    const model = whisperModel('large-v3-q5_0')!
    const justBarely = Math.ceil((model.vramGb * 1024) / 0.85)
    expect(modelFit(model, hw({ vramMb: justBarely - 64, cudaBinary: true }))).toBe('cpu')
    expect(modelFit(model, hw({ vramMb: justBarely + 64, cudaBinary: true }))).toBe('gpu')
  })
})

describe('describeWhisperModels', () => {
  it('marca exactamente un recomendado y respeta el orden del catálogo', () => {
    const entries = describeWhisperModels(hw({ vramMb: 4 * gb, cudaBinary: true }))
    expect(entries.filter((entry) => entry.recommended)).toHaveLength(1)
    expect(entries.find((entry) => entry.recommended)?.spec.id).toBe('large-v3-turbo-q5_0')
    expect(entries[0].spec.langs).toBe('multi')
    expect(entries[entries.length - 1].spec.langs).toBe('en')
  })
})
