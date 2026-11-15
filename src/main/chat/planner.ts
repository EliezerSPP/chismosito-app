import dayjs from 'dayjs'
import type { ChatFilter } from '@shared/types'
import { normalizeSearch } from './retrieval'

export interface JsonChatClient {
  chatJson(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxTokens?: number
  ): Promise<unknown>
}

export interface LibraryPlan {
  queries: string[]
  from: string | null
  to: string | null
  folder: string | null
  actions: {
    requested: boolean
    mine: boolean
    assignee: string | null
    dueFrom: string | null
    dueTo: string | null
  } | null
}

export interface PlanInput {
  question: string
  today: string
  userName: string
  filters: ChatFilter | null
  folders: string[]
  recentTitles: string[]
  history?: string[]
}

const PLANNER_PROMPT = `Eres un planificador de búsquedas sobre una biblioteca local de notas de reuniones.
Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin markdown ni explicaciones.

Esquema:
{
  "queries": ["término o frase", "..."],
  "from": "YYYY-MM-DD" | null,
  "to": "YYYY-MM-DD" | null,
  "folder": "carpeta exacta" | null,
  "actions": {
    "requested": true,
    "mine": true,
    "assignee": "nombre" | null,
    "dueFrom": "YYYY-MM-DD" | null,
    "dueTo": "YYYY-MM-DD" | null
  } | null
}

Reglas:
- "queries": entre 1 y 4 búsquedas con sinónimos o palabras clave. No incluyas fechas ni nombres de carpetas.
- "from"/"to": rango de fechas de las reuniones. "esta semana" es de lunes a domingo. Si la pregunta no limita fechas, usa null.
- "folder": solo si el usuario nombra explícitamente una carpeta de la lista permitida.
- "actions": úsalo cuando pregunte por tareas, pendientes, responsables o fechas límite.
  - "mine": true si las pide para el usuario local ("mis tareas", "lo que me asignaron").
  - "assignee": nombre de otra persona si la pregunta lo menciona.
  - "dueFrom"/"dueTo": solo si la pregunta habla de vencimientos, no de cuándo se asignaron.
- Usa el historial reciente solo para entender referencias como "eso", "lo mismo" o "esa persona". No busques información nueva en el historial.
- No inventes información. Respeta los filtros activos que se indican; son obligatorios.`

function dateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = dayjs(trimmed)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 4)
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

export function sanitizePlan(raw: unknown, input: PlanInput): LibraryPlan {
  const record = (raw ?? {}) as Record<string, unknown>
  const actionsRaw = record.actions
  const actions =
    actionsRaw && typeof actionsRaw === 'object'
      ? (actionsRaw as Record<string, unknown>)
      : null

  const queries = stringList(record.queries ?? record.search ?? record.busquedas)
  const proposedFolder =
    typeof record.folder === 'string' && record.folder.trim()
      ? record.folder.trim().replace(/\\/g, '/')
      : null
  const folderFromPlan =
    proposedFolder && normalizeSearch(proposedFolder) === 'sin clasificar'
      ? ''
      : proposedFolder
        ? input.folders.find(
            (folder) =>
              normalizeSearch(folder) === normalizeSearch(proposedFolder) ||
              normalizeSearch(folder).startsWith(`${normalizeSearch(proposedFolder)}/`)
          ) ?? null
        : null

  return {
    queries: queries.length > 0 ? queries : [input.question],
    from: maxDate(input.filters?.from ?? null, dateKey(record.from)),
    to: minDate(input.filters?.to ?? null, dateKey(record.to)),
    folder:
      input.filters && input.filters.folder !== null
        ? input.filters.folder
        : folderFromPlan,
    actions: actions
      ? {
          requested: actions.requested !== false,
          mine: Boolean(actions.mine),
          assignee:
            typeof actions.assignee === 'string' && actions.assignee.trim()
              ? actions.assignee.trim()
              : null,
          dueFrom: dateKey(actions.dueFrom),
          dueTo: dateKey(actions.dueTo)
        }
      : null
  }
}

export function resolveNaturalRange(
  question: string,
  today: string
): { from: string | null; to: string | null } {
  const text = normalizeSearch(question)
  const now = dayjs(today)
  if (!now.isValid()) return { from: null, to: null }
  const fmt = (value: dayjs.Dayjs): string => value.format('YYYY-MM-DD')

  if (/\b(hoy|del dia|de hoy)\b/.test(text)) {
    return { from: fmt(now), to: fmt(now) }
  }
  if (/\bayer\b/.test(text)) {
    const yesterday = now.subtract(1, 'day')
    return { from: fmt(yesterday), to: fmt(yesterday) }
  }
  if (/\b(semana pasada|ultima semana|la semana anterior)\b/.test(text)) {
    const start = startOfWeek(now).subtract(7, 'day')
    return { from: fmt(start), to: fmt(start.add(6, 'day')) }
  }
  if (/\b(esta semana|semana actual|ultimos 7 dias|los ultimos siete dias)\b/.test(text)) {
    if (text.includes('ultimos 7 dias') || text.includes('los ultimos siete dias')) {
      return { from: fmt(now.subtract(6, 'day')), to: fmt(now) }
    }
    const start = startOfWeek(now)
    return { from: fmt(start), to: fmt(start.add(6, 'day')) }
  }
  if (/\b(mes pasado|el mes anterior)\b/.test(text)) {
    const previous = now.subtract(1, 'month')
    return { from: fmt(previous.startOf('month')), to: fmt(previous.endOf('month')) }
  }
  if (/\b(este mes|mes actual|ultimos 30 dias)\b/.test(text)) {
    if (text.includes('ultimos 30 dias')) {
      return { from: fmt(now.subtract(29, 'day')), to: fmt(now) }
    }
    return { from: fmt(now.startOf('month')), to: fmt(now.endOf('month')) }
  }
  const lastDays = text.match(/ultimos?\s+(\d{1,2})\s+dias/)
  if (lastDays) {
    const days = Math.max(1, Math.min(365, Number(lastDays[1])))
    return { from: fmt(now.subtract(days - 1, 'day')), to: fmt(now) }
  }
  return { from: null, to: null }
}

function startOfWeek(value: dayjs.Dayjs): dayjs.Dayjs {
  const day = value.day()
  const offset = day === 0 ? -6 : 1 - day
  return value.add(offset, 'day').startOf('day')
}

export function fallbackPlan(input: PlanInput): LibraryPlan {
  const text = normalizeSearch(input.question)
  const range = resolveNaturalRange(input.question, input.today)
  const actionsRequested =
    /\b(tarea|tareas|pendiente|pendientes|accion|acciones|asignad|asigno|asignaron|responsable|compromiso|me toca|me pidio)\b/.test(
      text
    )
  const mine =
    /\b(me|mi|mis|yo|mio|mios)\b/.test(text) ||
    /\b(asignad[oa]s?\s+a\s+mi)\b/.test(text)

  return {
    queries: [input.question],
    from: range.from,
    to: range.to,
    folder: input.filters?.folder ?? null,
    actions: actionsRequested
      ? {
          requested: true,
          mine,
          assignee: null,
          dueFrom: null,
          dueTo: null
        }
      : null
  }
}

export async function planLibraryQuery(
  client: JsonChatClient,
  input: PlanInput
): Promise<LibraryPlan> {
  const folders = input.folders.slice(0, 80)
  const filters = input.filters
    ? [
        input.filters.from ? `desde ${input.filters.from}` : '',
        input.filters.to ? `hasta ${input.filters.to}` : '',
        input.filters.folder !== null
          ? `carpeta ${input.filters.folder === '' ? 'Sin clasificar' : input.filters.folder}`
          : ''
      ]
        .filter(Boolean)
        .join(', ')
    : 'ninguno'
  const messages = [
    { role: 'system' as const, content: PLANNER_PROMPT },
    {
      role: 'user' as const,
      content: [
        `Hoy es ${input.today}. El usuario local se llama ${input.userName || 'Yo'}.`,
        `Filtros activos de la interfaz: ${filters || 'ninguno'}.`,
        `Carpetas disponibles: ${folders.length > 0 ? folders.join(', ') : '(ninguna)'}.`,
        `Reuniones recientes: ${
          input.recentTitles.length > 0 ? input.recentTitles.join(' · ') : '(ninguna)'
        }.`,
        ...(input.history && input.history.length > 0
          ? ['', 'Historial reciente de la conversación:', ...input.history]
          : []),
        '',
        `Pregunta: ${input.question}`
      ].join('\n')
    }
  ]

  try {
    const raw = await client.chatJson(messages, 700)
    const plan = sanitizePlan(raw, input)
    const fallback = fallbackPlan(input)
    if (!plan.actions && fallback.actions) plan.actions = fallback.actions
    if (!plan.from && !plan.to) {
      plan.from = fallback.from
      plan.to = fallback.to
    }
    return plan
  } catch {
    return fallbackPlan(input)
  }
}
