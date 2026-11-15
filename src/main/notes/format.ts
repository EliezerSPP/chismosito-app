import matter from 'gray-matter'
import dayjs from 'dayjs'
import 'dayjs/locale/es'
import type { NoteStatus, TranscriptLine } from '@shared/types'

dayjs.locale('es')

export interface SummaryData {
  summary_bullets: string[]
  decisions: Array<{ decision: string; context?: string }>
  action_items: Array<{ task: string; owner: string; due_date: string | null }>
}

export interface NoteBuildInput {
  title: string
  date: string
  durationSeconds: number
  language: string
  audio: string | null
  folder: string
  tags: string[]
  status: NoteStatus
  llm: string | null
  summary: SummaryData | null
  transcript: string
  createdAt: string
  updatedAt: string
}

export interface ParsedNote {
  data: Record<string, unknown>
  content: string
  raw: string
}

const SAME_LINE = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim()

function quote(value: string): string {
  return JSON.stringify(SAME_LINE(value))
}

function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ['---']
  const order = [
    'title',
    'date',
    'duration_seconds',
    'language',
    'audio',
    'folder',
    'tags',
    'source',
    'llm',
    'status',
    'created_at',
    'updated_at'
  ]
  const keys = [...order.filter((key) => key in data), ...Object.keys(data).filter((key) => !order.includes(key))]

  for (const key of keys) {
    const value = data[key]
    if (value === undefined) continue
    if (value === null) {
      lines.push(`${key}: null`)
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`)
    } else if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value.map((entry) => String(entry)))}`)
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

export function composeNote(data: Record<string, unknown>, content: string): string {
  return `${serializeFrontmatter(data)}\n\n${content.trim()}\n`
}

export function parseNote(raw: string): ParsedNote {
  const parsed = matter(raw)
  return { data: parsed.data as Record<string, unknown>, content: parsed.content.trim(), raw }
}

export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}

function tableCell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

export function buildNoteMarkdown(input: NoteBuildInput): string {
  const title = SAME_LINE(input.title) || 'Reunión sin título'
  const dateLabel = dayjs(input.date).isValid()
    ? dayjs(input.date).format('D [de] MMMM [de] YYYY, HH:mm')
    : input.date

  const data: Record<string, unknown> = {
    title,
    date: input.date,
    duration_seconds: Math.max(0, Math.round(input.durationSeconds)),
    language: input.language,
    audio: input.audio,
    folder: input.folder,
    tags: input.tags,
    source: 'chismosito',
    llm: input.llm,
    status: input.status,
    created_at: input.createdAt,
    updated_at: input.updatedAt
  }

  const sections: string[] = [`# ${title} — ${dateLabel}`]

  if (input.status === 'processing' || input.status === 'recording') {
    sections.push(
      '> Procesando la grabación… El resumen y la transcripción aparecerán aquí al terminar.'
    )
    sections.push('---')
    sections.push('## Transcripción\n\n_(Pendiente)_')
    return composeNote(data, sections.join('\n\n'))
  }

  if (input.summary) {
    const bullets = input.summary.summary_bullets.slice(0, 5)
    sections.push(
      `## Resumen\n\n${
        bullets.length > 0 ? bullets.map((bullet) => `- ${SAME_LINE(bullet)}`).join('\n') : '- Sin resumen disponible.'
      }`
    )

    const decisions = input.summary.decisions.filter((entry) => entry.decision?.trim())
    sections.push(
      `## Decisiones\n\n${
        decisions.length > 0
          ? decisions
              .map((entry) =>
                entry.context
                  ? `- **${SAME_LINE(entry.decision)}** — ${SAME_LINE(entry.context)}`
                  : `- **${SAME_LINE(entry.decision)}**`
              )
              .join('\n')
          : 'Sin decisiones registradas.'
      }`
    )

    const actions = input.summary.action_items.filter((entry) => entry.task?.trim())
    sections.push(
      `## Acciones\n\n| Acción | Responsable | Fecha límite |\n| --- | --- | --- |\n${
        actions.length > 0
          ? actions
              .map(
                (entry) =>
                  `| ${tableCell(entry.task)} | ${tableCell(entry.owner || 'Sin asignar')} | ${tableCell(
                    entry.due_date || '—'
                  )} |`
              )
              .join('\n')
          : '| Sin acciones asignadas | — | — |'
      }`
    )
  } else {
    sections.push('## Resumen\n\n_(Pendiente de generar)_')
  }

  sections.push('---')
  const transcript = input.transcript.trim()
  sections.push(`## Transcripción\n\n${transcript || '_(Sin transcripción)_'}`)

  return composeNote(data, sections.join('\n\n'))
}

const TRANSCRIPT_LINE = /^\[(\d{2}):(\d{2}):(\d{2})\]\s+\*\*(.+?):\*\*\s+(.*)$/

export function extractTranscript(content: string): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(TRANSCRIPT_LINE)
    if (!match) continue
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    lines.push({
      timestamp: `${match[1]}:${match[2]}:${match[3]}`,
      seconds,
      speaker: match[4].trim(),
      text: match[5].trim()
    })
  }
  return lines
}

export function excerptFromContent(content: string, maxLength = 180): string {
  const cleaned = content
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^---+$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\|[^\n]*\|/g, ' ')
    .replace(/_\([^)]*\)_/g, ' ')
    .replace(/\[\d{2}:\d{2}:\d{2}\]\s*/g, ' ')
    .replace(/\*\*[^*\n]+:\*\*\s*/g, ' ')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trim()}…` : cleaned
}

export function stringField(data: Record<string, unknown>, key: string, fallback = ''): string {
  const value = data[key]
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return String(value)
  return fallback
}

export function numberField(data: Record<string, unknown>, key: string, fallback = 0): number {
  const value = data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return fallback
}

export function tagsField(data: Record<string, unknown>): string[] {
  const value = data.tags
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return []
}

export function statusField(data: Record<string, unknown>): NoteStatus {
  const value = String(data.status ?? '')
  const allowed: NoteStatus[] = [
    'recording',
    'processing',
    'complete',
    'summary_failed',
    'transcription_failed',
    'cancelled'
  ]
  return (allowed as string[]).includes(value) ? (value as NoteStatus) : 'complete'
}
