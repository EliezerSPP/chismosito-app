import { WHISPER_MODELS, whisperModel, type WhisperModelSpec } from './whisper-models'

export interface WhisperHardware {
  /** VRAM en MiB, o null si no hay GPU NVIDIA detectable. */
  vramMb: number | null
  gpuName: string | null
  vramSource: 'nvidia-smi' | 'registry' | 'none'
  ramMb: number
  cores: number
  /** El pack CUDA está instalado y whisper-cli.exe existe. */
  cudaBinary: boolean
}

export type WhisperModelFit = 'gpu' | 'cpu' | 'ram'

/** Margen para el escritorio/driver: nunca prometemos el 100 % de la VRAM. */
const GPU_BUDGET = 0.85
const RAM_BUDGET = 0.85

/**
 * Preferencia por tramos. Se recorre de arriba abajo y se elige el primero que
 * entre; así el resultado nunca depende de un equipo concreto ni de un default
 * fijo escrito a mano.
 */
const CUDA_TIERS: Array<{ minVramMb: number; id: string }> = [
  { minVramMb: 10_240, id: 'large-v3-f16' },
  { minVramMb: 6_144, id: 'large-v3-q5_0' },
  { minVramMb: 4_096, id: 'large-v3-turbo-q5_0' },
  { minVramMb: 2_560, id: 'small-q8_0' },
  { minVramMb: 1_536, id: 'base-q8_0' },
  { minVramMb: 0, id: 'tiny-q5_1' }
]

const CPU_TIERS: Array<{ minRamMb: number; id: string }> = [
  { minRamMb: 15_360, id: 'small-q8_0' },
  { minRamMb: 7_168, id: 'small-q5_1' },
  { minRamMb: 3_584, id: 'base-q5_1' },
  { minRamMb: 0, id: 'tiny-q5_1' }
]

/** Orden de preferencia por calidad (también se usa para el modo automático). */
export const QUALITY_ORDER = [
  'large-v3-f16',
  'large-v3-q5_0',
  'large-v3-turbo-f16',
  'large-v3-turbo-q8_0',
  'large-v3-turbo-q5_0',
  'medium-f16',
  'medium-q8_0',
  'medium-q5_0',
  'small-f16',
  'small-q8_0',
  'small-q5_1',
  'base-f16',
  'base-q8_0',
  'base-q5_1',
  'tiny-f16',
  'tiny-q8_0',
  'tiny-q5_1'
]

export function modelFit(spec: WhisperModelSpec, hardware: WhisperHardware): WhisperModelFit {
  if (spec.ramGb * 1024 > hardware.ramMb * RAM_BUDGET) return 'ram'
  const vram = hardware.cudaBinary ? hardware.vramMb : null
  if (vram && vram > 0 && spec.vramGb * 1024 <= vram * GPU_BUDGET) return 'gpu'
  return 'cpu'
}

function firstFit(
  candidateIds: string[],
  hardware: WhisperHardware,
  accept: (fit: WhisperModelFit) => boolean
): string | null {
  for (const id of candidateIds) {
    const spec = whisperModel(id)
    if (!spec) continue
    if (accept(modelFit(spec, hardware))) return id
  }
  return null
}

function tierId(hardware: WhisperHardware): string {
  if (hardware.cudaBinary && hardware.vramMb) {
    const tier = CUDA_TIERS.find((entry) => hardware.vramMb! >= entry.minVramMb)
    if (tier) return tier.id
  }
  const tier = CPU_TIERS.find((entry) => hardware.ramMb >= entry.minRamMb)
  return tier ? tier.id : 'tiny-q5_1'
}

export interface WhisperRecommendation {
  recommendedId: string
  reason: 'gpu' | 'cpu'
}

/**
 * Modelo sugerido para este equipo. Prefiere GPU cuando hay pack CUDA y VRAM
 * suficiente; si no, cae a CPU y elige la talla según RAM. Siempre devuelve un
 * id del catálogo, aunque no quepa: la UI lo marca como "solo CPU".
 */
export function recommendWhisperModel(hardware: WhisperHardware): WhisperRecommendation {
  const preferred = tierId(hardware)
  const order = [preferred, ...QUALITY_ORDER.filter((id) => id !== preferred)]
  const gpuAware = hardware.cudaBinary && hardware.vramMb

  const gpuChoice = gpuAware ? firstFit(order, hardware, (fit) => fit === 'gpu') : null
  if (gpuChoice) return { recommendedId: gpuChoice, reason: 'gpu' }

  const cpuChoice = firstFit(order, hardware, (fit) => fit !== 'ram')
  return { recommendedId: cpuChoice ?? 'tiny-q5_1', reason: 'cpu' }
}

export interface WhisperCatalogueEntry {
  spec: WhisperModelSpec
  fit: WhisperModelFit
  recommended: boolean
}

/** Catálogo con el veredicto por equipo, en el orden de presentación. */
export function describeWhisperModels(hardware: WhisperHardware): WhisperCatalogueEntry[] {
  const { recommendedId } = recommendWhisperModel(hardware)
  return WHISPER_MODELS.map((spec) => ({
    spec,
    fit: modelFit(spec, hardware),
    recommended: spec.id === recommendedId
  }))
}
