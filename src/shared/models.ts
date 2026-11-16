/** Catálogo de modelos de OpenCode Go. */

export interface LlmModelOption {
  id: string
  label: string
}

/** Ids de modelo canónicos según la tabla de endpoints de OpenCode Go. */
export const MODEL_LABELS: Record<string, string> = {
  'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'glm-5.3-flash': 'GLM-5.3-Flash',
  'glm-5.3': 'GLM-5.3',
  'glm-5.2': 'GLM-5.2',
  'kimi-k3.1-pro': 'Kimi K3.1 Pro',
  'kimi-k3': 'Kimi K3',
  'kimi-k2.7-code': 'Kimi K2.7 Code',
  'gpt-6-luna': 'GPT 6 Luna',
  'gpt-5.6-luna': 'GPT 5.6 Luna',
  'grok-4.7': 'Grok 4.7',
  'gemini-4-argon': 'Gemini 4 Argon',
  'minimax-m3.1-flash': 'MiniMax M3.1 Flash',
  'minimax-m3': 'MiniMax M3',
  'qwen4-max': 'Qwen4 Max',
  'qwen3.8-max': 'Qwen3.8 Max',
  'qwen3.8-flash': 'Qwen3.8 Flash',
  'qwen3.7-plus': 'Qwen3.7 Plus',
  'mimo-v2.6-flash': 'MiMo-V2.6-Flash',
  'mimo-v2.6-pro': 'MiMo-V2.6-Pro',
  'mimo-v2.5': 'MiMo-V2.5',
  'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
  'longcat-2.0': 'LongCat-2.0',
  'hy4': 'Hy4',
  'hy3': 'Hy3',
  'step-5-preview': 'Step 5 Preview'
}

/**
 * Respaldo cuando `/models` no responde (sin API key, sin red o gateway caído).
 * La lista real se pide a la API con la key del usuario.
 */
export const FALLBACK_MODEL_IDS: string[] = [
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'claude-haiku-5-5',
  'glm-5.3-flash',
  'glm-5.3',
  'kimi-k3.1-pro',
  'kimi-k3',
  'gpt-6-luna',
  'grok-4.7',
  'gemini-4-argon',
  'minimax-m3.1-flash',
  'qwen3.8-flash',
  'mimo-v2.6-flash',
  'longcat-2.0'
]

export function modelLabel(id: string): string {
  const known = MODEL_LABELS[id]
  if (known) return known
  return id
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function fallbackModelOptions(): LlmModelOption[] {
  return FALLBACK_MODEL_IDS.map((id) => ({ id, label: modelLabel(id) }))
}

export type ModelPickerItem =
  | { kind: 'default'; id: string; label: string }
  | { kind: 'model'; id: string; label: string }
  | { kind: 'custom'; id: string; label: string }

export const CUSTOM_MODEL_ID = '__custom__'
export const CUSTOM_MODEL_LABEL = 'Otro modelo (escribir el ID)…'

/**
 * Filas del selector: "default del .env", los modelos que coinciden con la
 * búsqueda y siempre la opción de escribir un ID a mano.
 */
export function buildModelItems(
  options: LlmModelOption[],
  defaultLabel: string,
  query: string
): ModelPickerItem[] {
  const needle = query.trim().toLowerCase()
  const matches = (label: string, id: string): boolean =>
    !needle || label.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)

  const items: ModelPickerItem[] = []
  if (matches(defaultLabel, 'llm_model')) {
    items.push({ kind: 'default', id: '', label: defaultLabel })
  }
  for (const option of options) {
    if (matches(option.label, option.id)) {
      items.push({ kind: 'model', id: option.id, label: option.label })
    }
  }
  items.push({ kind: 'custom', id: CUSTOM_MODEL_ID, label: CUSTOM_MODEL_LABEL })
  return items
}

/**
 * Normaliza las formas habituales de un listado de modelos: `{data:[{id}]}`
 * (OpenAI), `{models:[{id,name}]}`, o un arreglo de strings/objetos.
 */
export function parseModelIds(payload: unknown): string[] {
  const collect = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const ids: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string') {
        ids.push(entry)
        continue
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        const id = record.id ?? record.model ?? record.slug ?? record.name
        if (typeof id === 'string') ids.push(id)
      }
    }
    return ids
  }

  let ids: string[] = []
  if (Array.isArray(payload)) {
    ids = collect(payload)
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    ids = collect(record.data)
    if (ids.length === 0) ids = collect(record.models)
    if (ids.length === 0) ids = collect(record.model)
  }

  const seen = new Set<string>()
  const clean: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    clean.push(id)
  }
  return clean
}
