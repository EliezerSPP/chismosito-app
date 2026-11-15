import type { LlmTestResult } from '@shared/types'
import type { SettingsStore } from '../settings'
import { getEnv } from '../env'
import { log } from '../lib/logger'
import {
  buildFolderProfiles,
  buildJevRequest,
  parseJevSuggestion,
  type FolderSuggestion,
  type JevResponse,
  type JevSuggestionInput
} from './jev-core'

export type { FolderSuggestion } from './jev-core'

interface JevRequest {
  model: string
  state: string
  questions: Record<string, unknown>
}

export class JevClient {
  constructor(private readonly settings: SettingsStore) {}

  private config(): { apiKey: string; baseUrl: string; model: string } {
    const env = getEnv()
    const settings = this.settings.get()
    return {
      apiKey: env.opencodeApiKey,
      baseUrl: env.jevBaseUrl,
      model: settings.jevModel.trim() || env.jevModel
    }
  }

  configured(): boolean {
    return this.config().apiKey.trim().length > 0
  }

  private async request(body: JevRequest, timeoutMs = 30_000): Promise<JevResponse> {
    const config = this.config()
    if (!config.apiKey) throw new Error('Falta OPENCODE_API_KEY en el archivo .env')
    let response: Response
    try {
      response = await fetch(config.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw new Error(friendlyJevError(error))
    }
    if (!response.ok) throw new Error(await jevError(response))
    return (await response.json()) as JevResponse
  }

  async suggestFolder(input: JevSuggestionInput): Promise<FolderSuggestion | null> {
    if (!this.configured()) return null
    const profiles = buildFolderProfiles(input.folders, input.index)
    if (profiles.length === 0) return null
    const config = this.config()
    const { request, mapping } = buildJevRequest(input, profiles, config.model)
    try {
      const response = await this.request(request, 15_000)
      const suggestion = parseJevSuggestion(response, mapping, config.model)
      if (suggestion) {
        log.info(
          `Jev sugirió la carpeta «${suggestion.folder}» (${Math.round(
            suggestion.confidence * 100
          )} %)`
        )
      } else {
        const fit = response.answers?.has_fit?.noul
        const choice = response.answers?.folder?.choice
        const probability =
          choice && response.answers?.folder?.probabilities
            ? response.answers.folder.probabilities[choice]
            : undefined
        log.info(
          `Jev no propuso carpeta (encaje=${fit ?? 'n/d'}, elección=${
            choice ?? 'n/d'
          }, probabilidad=${probability ?? 'n/d'})`
        )
      }
      return suggestion
    } catch (error) {
      log.warn('No se pudo obtener una sugerencia de carpeta con Jev', error)
      return null
    }
  }

  async test(): Promise<LlmTestResult> {
    const config = this.config()
    const started = Date.now()
    if (!config.apiKey) {
      return {
        ok: false,
        model: config.model,
        latencyMs: 0,
        error: 'Falta OPENCODE_API_KEY en el archivo .env'
      }
    }
    try {
      const response = await this.request(
        {
          model: config.model,
          state: 'Prueba de conexión de Chismosito. Es una comprobación del modelo Jev.',
          questions: {
            connection: {
              type: 'noul',
              instructions: '¿Este texto es una prueba de conexión?'
            }
          }
        },
        15_000
      )
      const value = response.answers?.connection?.noul
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {
          ok: false,
          model: config.model,
          latencyMs: Date.now() - started,
          error: 'Jev respondió, pero sin la estructura esperada.'
        }
      }
      return {
        ok: true,
        model: response.model || config.model,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return {
        ok: false,
        model: config.model,
        latencyMs: Date.now() - started,
        error: friendlyJevError(error)
      }
    }
  }
}

function friendlyJevError(error: unknown): string {
  if (!error) return 'Error desconocido de Jev'
  if (error instanceof Error && error.message) {
    if (/401|invalid api key|unauthorized/i.test(error.message)) {
      return 'La API key no es válida para Jev. Revisa OPENCODE_API_KEY en el .env.'
    }
    if (/403|access|disabled|not available/i.test(error.message)) {
      return 'Jev no está habilitado para esta API key. Actívalo en OpenCode Console → Models.'
    }
    if (/429|rate limit/i.test(error.message)) {
      return 'Jev está limitando solicitudes. Intenta de nuevo en unos minutos.'
    }
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|network|timeout|abort/i.test(error.message)) {
      return 'No se pudo conectar con Jev. Revisa tu conexión a internet.'
    }
    return error.message
  }
  return String(error)
}

async function jevError(response: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string }
      message?: string
    }
    detail = body.error?.message ?? body.error?.status ?? body.message ?? ''
  } catch {
    try {
      detail = await response.text()
    } catch {
      // ignore
    }
  }
  if (response.status === 401) {
    return 'Jev rechazó la API key (401). Revisa OPENCODE_API_KEY.'
  }
  if (response.status === 403) {
    return 'Jev no está habilitado para esta API key (403). Actívalo en OpenCode Console → Models.'
  }
  if (response.status === 404) {
    return 'El modelo o endpoint de Jev no está disponible (404). Revisa JEV_MODEL y JEV_BASE_URL.'
  }
  if (response.status === 429) {
    return 'Jev está limitando solicitudes (429). Intenta de nuevo en unos minutos.'
  }
  return `Jev respondió ${response.status}${detail ? `: ${detail}` : ''}`
}
