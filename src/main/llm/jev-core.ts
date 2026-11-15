import type { NoteIndexEntry } from '../notes/repository'
import type { SummaryData } from '../notes/format'

export interface FolderProfile {
  path: string
  noteCount: number
  tags: string[]
  examples: string[]
  lastDate: string
}

export interface FolderSuggestion {
  folder: string
  confidence: number
  model: string
}

export interface JevSuggestionInput {
  title: string
  summary: SummaryData
  topics: string[]
  folders: string[]
  index: NoteIndexEntry[]
}

interface JevAnswer {
  type?: string
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
  noul?: number
}

export interface JevResponse {
  model?: string
  answers?: Record<string, JevAnswer>
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface JevRequest {
  model: string
  state: string
  questions: Record<string, unknown>
}

const MAX_PROFILES = 100
const MIN_FIT = 0.5
const MIN_CONFIDENCE = 0.6

export function buildFolderProfiles(
  folders: string[],
  index: NoteIndexEntry[]
): FolderProfile[] {
  const profiles = folders.map((folder) => {
    const entries = index
      .filter(
        (entry) =>
          entry.folder === folder || entry.folder.startsWith(`${folder}/`)
      )
      .sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''))
    const tagCounts = new Map<string, number>()
    for (const entry of entries) {
      for (const tag of entry.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
    return {
      path: folder,
      noteCount: entries.length,
      tags: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
        .slice(0, 5)
        .map(([tag]) => tag),
      examples: entries.slice(0, 4).map((entry) => entry.title),
      lastDate: entries[0]?.dateKey ?? ''
    }
  })

  return profiles
    .sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''))
    .slice(0, MAX_PROFILES)
}

function formatBullets(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '(sin datos)'
}

function describeProfile(profile: FolderProfile): string {
  return [
    `${profile.path}: ${profile.noteCount} ${
      profile.noteCount === 1 ? 'reunión' : 'reuniones'
    }`,
    profile.tags.length > 0 ? `temas: ${profile.tags.join(', ')}` : 'sin temas',
    profile.examples.length > 0
      ? `ejemplos: ${profile.examples.join('; ')}`
      : 'carpeta vacía'
  ].join('; ')
}

export function buildJevState(input: JevSuggestionInput, profiles: FolderProfile[]): string {
  return [
    `Título: ${input.title}`,
    '',
    'Resumen:',
    formatBullets(input.summary.summary_bullets),
    '',
    'Decisiones:',
    formatBullets(
      input.summary.decisions.map((entry) =>
        entry.context ? `${entry.decision} — ${entry.context}` : entry.decision
      )
    ),
    '',
    'Acciones:',
    formatBullets(
      input.summary.action_items.map(
        (entry) =>
          `${entry.task} · Responsable: ${entry.owner || 'Sin asignar'} · Límite: ${
            entry.due_date ?? 'sin fecha'
          }`
      )
    ),
    '',
    `Temas: ${input.topics.length > 0 ? input.topics.join(', ') : '(sin temas)'}`,
    'Carpeta actual: Sin clasificar',
    '',
    'Carpetas existentes:',
    profiles.length > 0
      ? profiles.map((profile) => `- ${describeProfile(profile)}`).join('\n')
      : '(ninguna)'
  ].join('\n')
}

export function buildJevRequest(
  input: JevSuggestionInput,
  profiles: FolderProfile[],
  model: string
): { request: JevRequest; mapping: Record<string, string> } {
  const mapping: Record<string, string> = {}
  const criteria: Record<string, Record<string, string | string[] | number>> = {}

  profiles.forEach((profile, index) => {
    const id = `folder_${index + 1}`
    mapping[id] = profile.path
    criteria[id] = {
      name: profile.path,
      meetings: profile.noteCount,
      topics: profile.tags.join(', ') || 'sin temas',
      examples: profile.examples.length > 0 ? profile.examples : ['carpeta vacía']
    }
  })

  return {
    mapping,
    request: {
      model,
      state: buildJevState(input, profiles),
      questions: {
        has_fit: {
          type: 'noul',
          instructions:
            '¿El tema principal de esta reunión encaja claramente en alguna de las carpetas existentes?'
        },
        folder: {
          type: 'choice',
          instructions:
            '¿En qué carpeta existente debería guardarse esta reunión? Elige la opción cuyo contenido se parezca más al de la reunión.',
          criteria
        }
      }
    }
  }
}

export function parseJevSuggestion(
  response: JevResponse,
  mapping: Record<string, string>,
  fallbackModel: string
): FolderSuggestion | null {
  const fit = response.answers?.has_fit?.noul
  if (typeof fit !== 'number' || !Number.isFinite(fit) || fit < MIN_FIT) return null

  const answer = response.answers?.folder
  if (!answer) return null
  const choice = typeof answer.choice === 'string' ? answer.choice : ''
  if (!choice) return null

  let folder = mapping[choice]
  if (!folder) {
    const direct = Object.values(mapping).find(
      (entry) => entry.toLowerCase() === choice.toLowerCase()
    )
    if (direct) folder = direct
  }
  if (!folder) return null

  const probability = answer.probabilities?.[choice]
  const confidence =
    typeof probability === 'number' && Number.isFinite(probability)
      ? probability
      : typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
        ? answer.confidence
        : 0
  if (confidence < MIN_CONFIDENCE) return null

  return {
    folder,
    confidence,
    model: response.model || fallbackModel
  }
}
