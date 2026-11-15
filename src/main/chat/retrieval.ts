import type { ChatFilter, TranscriptLine } from '@shared/types'
import type { SummaryData } from '../notes/format'

export interface FilterableNote {
  dateKey: string
  folder: string
}

export interface SummaryNote extends FilterableNote {
  title: string
  summary: SummaryData
}

export interface TranscriptChunk {
  timestamp: string
  startSeconds: number
  endSeconds: number
  text: string
}

export interface ActionMatch<T extends SummaryNote> {
  note: T
  task: string
  owner: string
  dueDate: string | null
}

const STOPWORDS = new Set([
  'aqui',
  'algo',
  'algun',
  'alguna',
  'algunas',
  'alguno',
  'algunos',
  'ante',
  'antes',
  'aquel',
  'aquella',
  'aquellas',
  'aquello',
  'aquellos',
  'asi',
  'aun',
  'bajo',
  'bien',
  'cada',
  'como',
  'con',
  'contra',
  'cual',
  'cuales',
  'cuando',
  'de',
  'del',
  'desde',
  'donde',
  'dos',
  'durante',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'entre',
  'era',
  'eran',
  'es',
  'esa',
  'esas',
  'ese',
  'eso',
  'esos',
  'esta',
  'estaba',
  'estaban',
  'estas',
  'este',
  'esto',
  'estos',
  'fue',
  'fueron',
  'ha',
  'habia',
  'han',
  'hasta',
  'hay',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'me',
  'mi',
  'mis',
  'mucho',
  'muy',
  'no',
  'nos',
  'o',
  'otra',
  'otras',
  'otro',
  'otros',
  'para',
  'pero',
  'poco',
  'por',
  'porque',
  'que',
  'quien',
  'quienes',
  'se',
  'sea',
  'segun',
  'ser',
  'si',
  'sin',
  'sobre',
  'son',
  'su',
  'sus',
  'tambien',
  'tanto',
  'te',
  'tiene',
  'tienen',
  'todo',
  'todos',
  'tu',
  'tus',
  'un',
  'una',
  'unas',
  'uno',
  'unos',
  'y',
  'ya',
  'yo'
])

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(value: string): string[] {
  return normalizeSearch(value)
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

export function chunkTranscript(
  lines: TranscriptLine[],
  maxChars = 1400,
  overlapLines = 1
): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = []
  let current: TranscriptLine[] = []
  let size = 0

  const flush = (): void => {
    if (current.length === 0) return
    const first = current[0]
    const last = current[current.length - 1]
    chunks.push({
      timestamp: first.timestamp,
      startSeconds: first.seconds,
      endSeconds: last.seconds,
      text: current
        .map((line) => `[${line.timestamp}] ${line.speaker}: ${line.text}`)
        .join('\n')
    })
  }

  for (const line of lines) {
    const lineSize = line.text.length + line.speaker.length + 16
    if (size + lineSize > maxChars && current.length > 0) {
      flush()
      current = overlapLines > 0 ? current.slice(-overlapLines) : []
      size = current.reduce(
        (total, item) => total + item.text.length + item.speaker.length + 16,
        0
      )
    }
    current.push(line)
    size += lineSize
  }
  flush()
  return chunks
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

export function retrieveChunks(
  lines: TranscriptLine[],
  queries: string[],
  maxChunks = 4
): TranscriptChunk[] {
  if (lines.length === 0) return []
  const terms = [...new Set(queries.flatMap((query) => tokenize(query)))]
  if (terms.length === 0) return []

  const chunks = chunkTranscript(lines)
  const normalizedQueries = queries.map((query) => normalizeSearch(query)).filter(Boolean)
  const scored = chunks
    .map((chunk, index) => {
      const text = normalizeSearch(chunk.text)
      let score = 0
      for (const term of terms) score += countOccurrences(text, term)
      for (const query of normalizedQueries) {
        if (query.length >= 6 && text.includes(query)) score += 12
      }
      return { chunk, index, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)

  if (scored.length === 0) return []

  const selected = new Set<number>()
  for (const entry of scored) {
    selected.add(entry.index)
    if (entry.index > 0 && selected.size < maxChunks + 2) selected.add(entry.index - 1)
  }

  const ordered = [...selected].sort((a, b) => a - b)
  const merged: TranscriptChunk[] = []
  for (const index of ordered) {
    const chunk = chunks[index]
    const previous = merged[merged.length - 1]
    if (previous && previous.endSeconds >= chunk.startSeconds) {
      previous.endSeconds = chunk.endSeconds
      previous.text = `${previous.text}\n${chunk.text}`
    } else {
      merged.push({ ...chunk })
    }
  }
  return merged
}

export function matchesFolder(folder: string, target: string): boolean {
  if (target === '') return folder === ''
  const normalizedFolder = folder.toLowerCase()
  const normalizedTarget = target.toLowerCase()
  return (
    normalizedFolder === normalizedTarget ||
    normalizedFolder.startsWith(`${normalizedTarget}/`)
  )
}

export function applyFilters<T extends FilterableNote>(
  entries: T[],
  filters: ChatFilter | null
): T[] {
  if (!filters) return entries
  return entries.filter((entry) => {
    if (filters.from && (!entry.dateKey || entry.dateKey < filters.from)) return false
    if (filters.to && (!entry.dateKey || entry.dateKey > filters.to)) return false
    if (filters.folder !== null && !matchesFolder(entry.folder, filters.folder)) return false
    return true
  })
}

export function matchesAssignee(
  owner: string,
  options: { mine: boolean; userName: string; assignee?: string | null }
): boolean {
  const normalized = normalizeSearch(owner)
  if (!normalized) return false
  if (options.mine) {
    if (normalized === 'sin asignar') return false
    const userName = normalizeSearch(options.userName)
    if (normalized === 'yo') return true
    if (userName && (normalized === userName || normalized.includes(userName))) return true
    return false
  }
  if (!options.assignee) return true
  const assignee = normalizeSearch(options.assignee)
  if (assignee === 'sin asignar') return normalized === 'sin asignar'
  return normalized === assignee || normalized.includes(assignee)
}

export function collectActions<T extends SummaryNote>(
  entries: T[],
  options: {
    filters: ChatFilter | null
    mine: boolean
    userName: string
    assignee?: string | null
    dueFrom?: string | null
    dueTo?: string | null
    limit?: number
  }
): ActionMatch<T>[] {
  const filtered = applyFilters(entries, options.filters)
  const matches: ActionMatch<T>[] = []
  for (const note of filtered) {
    for (const action of note.summary.action_items) {
      if (!action.task?.trim()) continue
      if (
        !matchesAssignee(action.owner, {
          mine: options.mine,
          userName: options.userName,
          assignee: options.assignee
        })
      ) {
        continue
      }
      if (options.dueFrom || options.dueTo) {
        if (!action.due_date) continue
        if (options.dueFrom && action.due_date < options.dueFrom) continue
        if (options.dueTo && action.due_date > options.dueTo) continue
      }
      matches.push({
        note,
        task: action.task,
        owner: action.owner,
        dueDate: action.due_date
      })
    }
  }
  return matches.slice(0, options.limit ?? 80)
}

export function scoreNoteMetadata<T extends SummaryNote & { tags: string[] }>(
  entry: T,
  queries: string[]
): number {
  const terms = [...new Set(queries.flatMap((query) => tokenize(query)))]
  if (terms.length === 0) return 0
  const haystack = normalizeSearch(
    [
      entry.title,
      entry.tags.join(' '),
      entry.summary.summary_bullets.join(' '),
      entry.summary.decisions.map((item) => `${item.decision} ${item.context ?? ''}`).join(' '),
      entry.summary.action_items
        .map((item) => `${item.task} ${item.owner}`)
        .join(' ')
    ].join(' ')
  )
  let score = 0
  for (const term of terms) score += countOccurrences(haystack, term)
  for (const query of queries) {
    const normalized = normalizeSearch(query)
    if (normalized.length >= 6 && haystack.includes(normalized)) score += 8
  }
  return score
}

export function formatActionsAsMarkdown<T extends SummaryNote>(
  matches: ActionMatch<T>[],
  limit = 40
): string {
  if (matches.length === 0) return ''
  const rows = matches
    .slice(0, limit)
    .map((match) => {
      const meeting = `${match.note.title} (${match.note.dateKey})`.replace(/\|/g, '\\|')
      return `| ${match.task.replace(/\|/g, '\\|')} | ${match.owner.replace(
        /\|/g,
        '\\|'
      )} | ${match.dueDate ?? '—'} | ${meeting} |`
    })
  return [
    '| Acción | Responsable | Fecha límite | Reunión |',
    '| --- | --- | --- | --- |',
    ...rows
  ].join('\n')
}
