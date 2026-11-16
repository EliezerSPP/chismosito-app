import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_LLM_MODEL } from '@shared/constants'
import { normalizeLlmBaseUrl } from '@shared/url'
import { log } from './lib/logger'

export interface EnvConfig {
  envPath: string
  /** Solo para migrar una key existente a secrets.json en el primer arranque. */
  opencodeApiKey: string
  llmBaseUrl: string
  llmModel: string
  jevBaseUrl: string
  jevModel: string
  googleClientId: string
  googleClientSecret: string
  googleRefreshToken: string
  googleFolderName: string
  googleAutoBackup: boolean
  meetingNotesDir: string
  whisperDevice: string
  whisperLanguage: string
  whisperModelPath: string
  userName: string
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

function envPath(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), '.env')
    : join(app.getAppPath(), '.env')
}

export function loadEnv(): EnvConfig {
  const path = envPath()
  let parsed: Record<string, string> = {}
  if (existsSync(path)) {
    try {
      parsed = parseEnvFile(readFileSync(path, 'utf8'))
      log.info(`Configuración cargada desde ${path}`)
    } catch (error) {
      log.error('No se pudo leer el .env', error)
    }
  }

  const read = (key: string): string => {
    const fromProcess = process.env[key]
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess
    return parsed[key] ?? ''
  }

  return {
    envPath: path,
    opencodeApiKey: read('OPENCODE_API_KEY'),
    llmBaseUrl: normalizeLlmBaseUrl(read('LLM_BASE_URL') || read('OPENCODE_BASE_URL')),
    llmModel: read('LLM_MODEL') || DEFAULT_LLM_MODEL,
    jevBaseUrl:
      read('JEV_BASE_URL') || 'https://opencode.ai/inference/systemone/v1/systemone',
    jevModel: read('JEV_MODEL') || 'jev-1.13-free',
    googleClientId: read('GOOGLE_CLIENT_ID'),
    googleClientSecret: read('GOOGLE_CLIENT_SECRET'),
    googleRefreshToken: read('GOOGLE_REFRESH_TOKEN'),
    googleFolderName: read('GOOGLE_DRIVE_FOLDER_NAME') || 'Chismosito',
    googleAutoBackup: (read('GOOGLE_DRIVE_AUTO_BACKUP') || 'true').toLowerCase() !== 'false',
    meetingNotesDir: read('MEETING_NOTES_DIR'),
    whisperDevice: read('WHISPER_DEVICE'),
    whisperLanguage: read('WHISPER_LANGUAGE'),
    whisperModelPath: read('WHISPER_MODEL_PATH'),
    userName: read('USER_NAME')
  }
}

let cached = loadEnv()

export function getEnv(): EnvConfig {
  return cached
}

export function reloadEnv(): EnvConfig {
  cached = loadEnv()
  return cached
}

const ENV_TEMPLATE = `# Chismosito — configuración local
# La app lee este archivo al iniciar. Reinicia después de editarlo.
# La API key de OpenCode ya NO se guarda aquí: configúrala en
# Ajustes → Resumen con LLM (se guarda cifrada en secrets.json).

# LLM (OpenCode Go es OpenAI-compatible; /go/ es la ruta del plan Go)
LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1
LLM_MODEL=deepseek-v4.1-flash

# Jev (sugerencia de carpeta al terminar)
JEV_MODEL=jev-1.13-free
JEV_BASE_URL=https://opencode.ai/inference/systemone/v1/systemone

# Google Drive (cliente OAuth tipo "Desktop app")
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_NAME=Chismosito
GOOGLE_DRIVE_AUTO_BACKUP=true

# Rutas y whisper
MEETING_NOTES_DIR=
WHISPER_DEVICE=auto
WHISPER_LANGUAGE=es
WHISPER_MODEL_PATH=
USER_NAME=
`

export function ensureEnvFile(): void {
  const path = envPath()
  if (existsSync(path)) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, ENV_TEMPLATE, { encoding: 'utf8', flag: 'wx' })
    log.info(`Plantilla .env creada en ${path}`)
  } catch (error) {
    log.warn('No se pudo crear la plantilla .env', error)
  }
}
