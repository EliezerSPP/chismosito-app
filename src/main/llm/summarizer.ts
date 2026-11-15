import OpenAI from 'openai'
import { z } from 'zod'
import type { LlmTestResult } from '@shared/types'
import type { SettingsStore } from '../settings'
import { getEnv } from '../env'
import type { SummaryData } from '../notes/format'
import { log } from '../lib/logger'

const partialSchema = z.object({
  title: z.string().optional().default(''),
  summary_bullets: z.array(z.string()).optional().default([]),
  decisions: z.array(z.any()).optional().default([]),
  action_items: z.array(z.any()).optional().default([]),
  topics: z.array(z.string()).optional().default([])
})

export interface SummaryResult {
  title: string
  summary: SummaryData
  topics: string[]
  model: string
}

export interface SummaryContext {
  date: string
  durationSeconds: number
  language: string
  userName: string
}

const SYSTEM_PROMPT = `Eres un asistente experto en documentar reuniones. Recibes una transcripción con hablantes etiquetados:
- "Yo" es el usuario local que grabó la reunión.
- "Otros" son los demás participantes.

Devuelve EXCLUSIVAMENTE un objeto JSON válido, sin markdown, sin explicaciones y sin texto adicional.

Reglas:
1. "title": título corto y específico de la reunión, de 3 a 8 palabras. Sin la palabra "Reunión" salvo que sea inevitable.
2. "summary_bullets": EXACTAMENTE 5 viñetas. Cada una debe ser concreta, útil y de máximo 25 palabras. Nada de relleno ni frases genéricas.
3. "decisions": solo decisiones tomadas explícitamente en la conversación. Cada elemento: {"decision": "...", "context": "por qué o para qué"}. Si no hay, usa [].
4. "action_items": tareas concretas acordadas. Cada elemento: {"task": "...", "owner": "nombre o Yo/Otros o Sin asignar", "due_date": "YYYY-MM-DD" o null}. No inventes responsables ni fechas; si no se mencionan, usa "Sin asignar" y null. Si no hay acciones, usa [].
5. "topics": de 3 a 5 etiquetas cortas, en minúsculas, sin numeral, para clasificar la reunión.
6. Responde en el idioma dominante de la transcripción.
7. No inventes información que no aparezca en la transcripción.

Formato exacto:
{"title":"...","summary_bullets":["...","...","...","...","..."],"decisions":[{"decision":"...","context":"..."}],"action_items":[{"task":"...","owner":"...","due_date":null}],"topics":["..."]}`

function clientConfig(settings: SettingsStore): { apiKey: string; baseURL: string; model: string } {
  const env = getEnv()
  const model = settings.get().llmModel.trim() || env.llmModel
  return { apiKey: env.opencodeApiKey, baseURL: env.llmBaseUrl, model }
}

export function isLlmConfigured(settings: SettingsStore): boolean {
  return clientConfig(settings).apiKey.trim().length > 0
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('La respuesta del modelo no contiene JSON')
  return JSON.parse(withoutFence.slice(start, end + 1))
}

function normalizeBullets(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
}

function normalizeDecisions(value: unknown): SummaryData['decisions'] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.trim()) return [{ decision: value.trim() }]
    return []
  }
  return value
    .map((entry) => {
      if (typeof entry === 'string') return { decision: entry.trim() }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        const decision = String(
          record.decision ?? record.decisión ?? record.title ?? record.text ?? ''
        ).trim()
        const context = String(record.context ?? record.contexto ?? record.reason ?? '').trim()
        return decision ? { decision, context: context || undefined } : null
      }
      return null
    })
    .filter((entry): entry is { decision: string; context?: string } => Boolean(entry))
}

function normalizeActions(value: unknown): SummaryData['action_items'] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { task: entry.trim(), owner: 'Sin asignar', due_date: null }
      }
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const task = String(
        record.task ?? record.action ?? record.acción ?? record.accion ?? record.text ?? ''
      ).trim()
      if (!task) return null
      const owner = String(
        record.owner ?? record.responsable ?? record.assignee ?? record.who ?? 'Sin asignar'
      ).trim()
      const rawDue = record.due_date ?? record.dueDate ?? record.fecha ?? record.deadline
      const due = typeof rawDue === 'string' && rawDue.trim() ? rawDue.trim() : null
      return { task, owner: owner || 'Sin asignar', due_date: due }
    })
    .filter((entry): entry is { task: string; owner: string; due_date: string | null } =>
      Boolean(entry)
    )
}

function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const topics = value
    .map((entry) => String(entry).trim().toLowerCase().replace(/^#+/, ''))
    .map((entry) => entry.replace(/[^\p{L}\p{N}\s-]/gu, '').trim())
    .filter((entry) => entry.length > 0 && entry.length <= 40)
  return [...new Set(topics)].slice(0, 5)
}

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return title.replace(/^["“]|["”]$/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export class LlmClient {
  constructor(private readonly settings: SettingsStore) {}

  private client(): OpenAI {
    const config = clientConfig(this.settings)
    if (!config.apiKey) {
      throw new Error('Falta OPENCODE_API_KEY en el archivo .env')
    }
    return new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 120_000,
      maxRetries: 0
    })
  }

  configured(): boolean {
    return isLlmConfigured(this.settings)
  }

  async test(): Promise<LlmTestResult> {
    const config = clientConfig(this.settings)
    const started = Date.now()
    try {
      const response = await this.client().chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: 'Responde únicamente con la palabra OK.' },
          { role: 'user', content: 'Prueba de conexión.' }
        ],
        max_tokens: 64,
        temperature: 0
      })
      const message = response.choices[0]?.message as
        | { content?: string | null; reasoning_content?: string | null }
        | undefined
      const content = (message?.content ?? '').trim()
      const reasoning = (message?.reasoning_content ?? '').trim()
      const latencyMs = Date.now() - started
      if (!content && !reasoning) {
        return {
          ok: false,
          model: config.model,
          latencyMs,
          error:
            'El modelo respondió vacío. Verifica que tenga acceso habilitado y créditos en OpenCode Console.'
        }
      }
      return { ok: true, model: config.model, latencyMs }
    } catch (error) {
      return {
        ok: false,
        model: config.model,
        latencyMs: Date.now() - started,
        error: friendlyLlmError(error)
      }
    }
  }

  async chatJson(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxTokens = 800
  ): Promise<unknown> {
    return this.requestJson(messages, maxTokens)
  }

  async chatStream(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: {
      signal?: AbortSignal
      onDelta: (text: string) => void
      maxTokens?: number
      temperature?: number
    }
  ): Promise<{ content: string; model: string }> {
    const config = clientConfig(this.settings)
    if (!config.apiKey) throw new Error('Falta OPENCODE_API_KEY en el archivo .env')
    const client = this.client()
    const maxTokens = options.maxTokens ?? 1800
    const temperature = options.temperature ?? 0.25
    let content = ''

    try {
      const stream = await client.chat.completions.create(
        {
          model: config.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true
        },
        { signal: options.signal }
      )
      for await (const chunk of stream) {
        if (options.signal?.aborted) throw new Error('Respuesta cancelada')
        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
          content += delta
          options.onDelta(delta)
        }
      }
      if (!content.trim()) throw new Error('Respuesta vacía del modelo')
      return { content, model: config.model }
    } catch (error) {
      const aborted =
        options.signal?.aborted ||
        (error instanceof Error && /abort|cancelad/i.test(error.message))
      if (aborted) throw new Error('Respuesta cancelada')
      if (content.trim()) {
        throw new ChatStreamError(friendlyLlmError(error), content)
      }
      log.warn('Streaming del chat falló, reintentando sin streaming', error)
      const response = await client.chat.completions.create(
        {
          model: config.model,
          messages,
          temperature,
          max_tokens: maxTokens
        },
        { signal: options.signal }
      )
      const fallback = response.choices[0]?.message?.content ?? ''
      if (!fallback.trim()) throw new Error(friendlyLlmError(error))
      options.onDelta(fallback)
      return { content: fallback, model: config.model }
    }
  }

  private async requestJson(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxTokens = 3000
  ): Promise<unknown> {
    const client = this.client()
    const config = clientConfig(this.settings)
    let lastError: unknown = null

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const useJsonMode = attempt === 0
        const response = await client.chat.completions.create({
          model: config.model,
          messages,
          temperature: attempt === 0 ? 0.2 : 0.1,
          max_tokens: maxTokens,
          ...(useJsonMode ? { response_format: { type: 'json_object' as const } } : {})
        })
        const content = response.choices[0]?.message?.content ?? ''
        if (!content.trim()) {
          if (response.choices[0]?.finish_reason === 'length') {
            throw new Error('El modelo agotó el límite de tokens antes de devolver el JSON')
          }
          throw new Error('Respuesta vacía del modelo')
        }
        return extractJson(content)
      } catch (error) {
        lastError = error
        log.warn(`Intento ${attempt + 1} del LLM falló`, error)
        if (attempt === 0) await sleep(800)
      }
    }
    throw new Error(friendlyLlmError(lastError))
  }

  async summarize(
    transcript: string,
    context: SummaryContext,
    signal?: AbortSignal
  ): Promise<SummaryResult> {
    if (!transcript.trim()) throw new Error('No hay transcripción para resumir')
    const config = clientConfig(this.settings)
    const partials: Array<z.infer<typeof partialSchema>> = []

    if (transcript.length > 60_000) {
      const chunks = chunkTranscript(transcript)
      for (let i = 0; i < chunks.length; i += 1) {
        if (signal?.aborted) throw new Error('Resumen cancelado')
        const partial = await this.requestJson(
          buildPartialMessages(chunks[i], context, i + 1, chunks.length),
          3000
        )
        partials.push(partialSchema.parse(partial))
      }
    }

    const messages = partials.length
      ? buildSynthesisMessages(partials, context)
      : buildMessages(transcript, context)

    if (signal?.aborted) throw new Error('Resumen cancelado')
    const raw = await this.requestJson(messages, 4500)
    const normalized = normalizeResult(raw, context)

    if (partials.length > 0 && normalized.summary.summary_bullets.length < 3) {
      throw new Error('El modelo devolvió un resumen incompleto')
    }

    return { ...normalized, model: config.model }
  }
}

function normalizeResult(raw: unknown, context: SummaryContext): Omit<SummaryResult, 'model'> {
  const record = (raw ?? {}) as Record<string, unknown>
  const bullets = normalizeBullets(record.summary_bullets ?? record.summary ?? record.resumen).slice(
    0,
    5
  )
  if (bullets.length === 0) throw new Error('El modelo no devolvió viñetas de resumen')

  const title =
    normalizeTitle(record.title ?? record.titulo ?? record.título) ||
    `Reunión ${new Date(context.date).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })}`

  return {
    title,
    summary: {
      summary_bullets: bullets,
      decisions: normalizeDecisions(record.decisions ?? record.decisiones),
      action_items: normalizeActions(
        record.action_items ?? record.actions ?? record.acciones ?? record.tasks
      )
    },
    topics: normalizeTopics(record.topics ?? record.tags ?? record.temas)
  }
}

function buildMessages(
  transcript: string,
  context: SummaryContext
): Array<{ role: 'system' | 'user'; content: string }> {
  const userName = context.userName || 'el usuario local'
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Fecha de la reunión: ${context.date}`,
        `Duración: ${Math.round(context.durationSeconds / 60)} minutos`,
        `Idioma: ${context.language}`,
        `Nombre del usuario local: ${userName}`,
        '',
        'Transcripción:',
        transcript
      ].join('\n')
    }
  ]
}

function buildPartialMessages(
  chunk: string,
  context: SummaryContext,
  index: number,
  total: number
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Este es el fragmento ${index} de ${total} de una reunión del ${context.date}.`,
        `Idioma: ${context.language}. Usuario local: ${context.userName || 'Yo'}.`,
        'Resume este fragmento con el mismo formato JSON. En este paso usa hasta 5 viñetas; el resumen final se hará después.',
        '',
        chunk
      ].join('\n')
    }
  ]
}

function buildSynthesisMessages(
  partials: Array<z.infer<typeof partialSchema>>,
  context: SummaryContext
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Fecha: ${context.date}. Duración: ${Math.round(context.durationSeconds / 60)} minutos.`,
        `Usuario local: ${context.userName || 'Yo'}. Idioma: ${context.language}.`,
        'A continuación tienes resúmenes parciales de la misma reunión. Fusiónalos en UN solo resultado final.',
        'Elimina duplicados, conserva exactamente 5 viñetas finales y no inventes datos.',
        '',
        JSON.stringify(partials, null, 2)
      ].join('\n')
    }
  ]
}

function chunkTranscript(text: string, maxChars = 18_000, overlapChars = 1_500): string[] {
  const lines = text.split(/\r?\n/)
  const chunks: string[] = []
  let current: string[] = []
  let size = 0
  for (const line of lines) {
    if (size + line.length > maxChars && current.length > 0) {
      chunks.push(current.join('\n'))
      const tail: string[] = []
      let tailSize = 0
      for (let i = current.length - 1; i >= 0; i -= 1) {
        tail.unshift(current[i])
        tailSize += current[i].length
        if (tailSize >= overlapChars) break
      }
      current = tail
      size = tailSize
    }
    current.push(line)
    size += line.length + 1
  }
  if (current.length > 0) chunks.push(current.join('\n'))
  return chunks
}

export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly partial: string
  ) {
    super(message)
    this.name = 'ChatStreamError'
  }
}

export function friendlyLlmError(error: unknown): string {
  if (!error) return 'Error desconocido del LLM'
  if (error instanceof Error && error.message) {
    const message = error.message
    if (/model access is disabled/i.test(message)) {
      const url = message.match(/https:\/\/opencode\.ai\/\S+/)?.[0]?.replace(/[.)]+$/, '')
      return `El acceso a este modelo está desactivado en tu cuenta de OpenCode. Actívalo en Console → Models${
        url ? ` (${url})` : ''
      }.`
    }
    if (/model is unavailable/i.test(message)) {
      return 'El modelo no está disponible en tu cuenta de OpenCode. Actívalo en Console → Models o elige otro modelo en Ajustes.'
    }
    if (/401|invalid api key|unauthorized/i.test(message)) {
      return 'La API key del LLM es inválida o expiró. Revisa OPENCODE_API_KEY.'
    }
    if (/429|rate limit/i.test(message)) {
      return 'El proveedor del LLM está limitando solicitudes. Intenta de nuevo en unos minutos.'
    }
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
      return 'No se pudo conectar con el proveedor del LLM. Revisa tu conexión a internet.'
    }
    return message
  }
  return String(error)
}
