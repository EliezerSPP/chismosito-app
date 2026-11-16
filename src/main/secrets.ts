import { app, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LlmKeyStatus } from '@shared/types'
import { getEnv, reloadEnv } from './env'
import { writeAtomic } from './lib/fs'
import { log } from './lib/logger'

const MAX_KEY_LENGTH = 200
const ENV_KEY_LINE = /^\s*(?:#+\s*)?(?:export\s+)?OPENCODE_API_KEY\s*=.*$/i

/** Devuelve el contenido sin líneas activas de OPENCODE_API_KEY. */
function stripEnvKey(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !ENV_KEY_LINE.test(line))
    .join('\n')
}

/** Comprueba el archivo .env (no process.env), para no avisar de una key que no está ahí. */
function envFileHasKey(envPath: string): boolean {
  if (!envPath || !existsSync(envPath)) return false
  try {
    return readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .some((line) => ENV_KEY_LINE.test(line))
  } catch {
    return false
  }
}

interface SecretsFile {
  version: 1
  encrypted: boolean
  opencodeApiKey: string
}

/**
 * Almacén de secretos de la aplicación (por ahora, la API key de OpenCode).
 * Vive fuera de settings.json porque `AppSettings` se envía al renderer y
 * también se difunde en cada cambio: la key nunca debe viajar por IPC.
 *
 * El archivo siempre se escribe cifrado con DPAPI (safeStorage). Si el cifrado
 * no está disponible se falla cerrado: preferimos un error visible a guardar
 * la key en claro sin que el usuario lo sepa.
 */
export class SecretStore {
  private key = ''
  private encrypted = false
  private error: string | null = null

  constructor(private readonly filePath: string = secretsFile()) {
    this.load()
  }

  get path(): string {
    return this.filePath
  }

  private load(): void {
    // Sanea respaldos de versiones anteriores que todavía tengan la key.
    const backupError = sanitizeEnvBackup(getEnv().envPath)
    if (backupError) log.warn('No se pudo sanear .env.bak', backupError)
    if (!existsSync(this.filePath)) {
      this.migrateFromEnv()
      return
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<SecretsFile>
      const raw = typeof parsed.opencodeApiKey === 'string' ? parsed.opencodeApiKey : ''
      if (!raw) {
        this.key = ''
        return
      }
      if (parsed.encrypted === false) {
        // Archivo heredado en claro: se adopta y se vuelve a cifrar si se puede.
        this.key = raw
        this.encrypted = false
        try {
          this.persistKey(raw)
          this.encrypted = true
          log.info('API key sin cifrar migrada a DPAPI')
        } catch (error) {
          this.error = `La API key está guardada sin cifrar y no se pudo cifrar: ${
            (error as Error).message
          }`
          log.warn('No se pudo cifrar la API key heredada', error)
        }
        return
      }
      this.key = this.decrypt(raw)
      this.encrypted = true
      this.error = null
    } catch (error) {
      this.key = ''
      this.error = `No se pudo leer la API key guardada: ${(error as Error).message}`
      log.error('No se pudo leer secrets.json', error)
    }
  }

  /**
   * Compatibilidad: si todavía no existe secrets.json y el .env trae una key,
   * se adopta una sola vez, se guarda cifrada y se elimina del .env (con un
   * respaldo .env.bak sin la key) para no dejar una copia en claro.
   */
  private migrateFromEnv(): void {
    const env = getEnv()
    const fromEnv = env.opencodeApiKey.trim()
    if (!fromEnv) return
    try {
      this.persistKey(fromEnv)
      this.key = fromEnv
      this.encrypted = true
      this.error = null
      log.info('API key migrada del .env a secrets.json')
      const cleaned = scrubEnvKey(env.envPath)
      if (cleaned.removed) {
        log.info(
          `OPENCODE_API_KEY eliminada del .env${
            cleaned.backupPath ? ` (respaldo en ${cleaned.backupPath})` : ''
          }`
        )
      } else if (cleaned.error) {
        log.warn('No se pudo limpiar la key del .env', cleaned.error)
      }
    } catch (error) {
      this.error = (error as Error).message
      log.warn('No se pudo migrar la API key del .env', error)
    }
  }

  private encryptOrThrow(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Windows no ofrece cifrado para la API key (safeStorage/DPAPI). No se guardará en claro.'
      )
    }
    try {
      return safeStorage.encryptString(value).toString('base64')
    } catch (error) {
      throw new Error(`No se pudo cifrar la API key: ${(error as Error).message}`)
    }
  }

  private decrypt(payload: string): string {
    if (!payload) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows no ofrece descifrado (safeStorage/DPAPI) para la API key guardada')
    }
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  }

  private persistKey(value: string): void {
    const data: SecretsFile = {
      version: 1,
      encrypted: true,
      opencodeApiKey: value ? this.encryptOrThrow(value) : ''
    }
    // Se escribe primero: si falla, el estado en memoria no cambia.
    writeAtomic(this.filePath, JSON.stringify(data, null, 2))
  }

  apiKey(): string {
    return this.key
  }

  configured(): boolean {
    return this.key.trim().length > 0
  }

  setApiKey(raw: string): LlmKeyStatus {
    const value = String(raw ?? '').trim()
    if (!value) throw new Error('Escribe una API key')
    if (value.length > MAX_KEY_LENGTH) throw new Error('La API key es demasiado larga')
    if (/\s/.test(value)) throw new Error('La API key no puede tener espacios ni saltos de línea')
    this.persistKey(value)
    this.key = value
    this.encrypted = true
    this.error = null
    log.info('API key de OpenCode actualizada desde Ajustes')
    return this.status()
  }

  clearApiKey(): LlmKeyStatus {
    this.persistKey('')
    this.key = ''
    this.error = null
    const backupError = sanitizeEnvBackup(getEnv().envPath)
    log.info('API key de OpenCode eliminada desde Ajustes')
    if (backupError) {
      throw new Error(
        `La API key se borró, pero no se pudo limpiar el respaldo .env.bak: ${backupError}`
      )
    }
    return this.status()
  }

  /** Borra una OPENCODE_API_KEY que haya quedado en el .env (respaldo sin la key). */
  scrubEnvKey(): LlmKeyStatus {
    const result = scrubEnvKey(getEnv().envPath)
    if (result.error) throw new Error(result.error)
    return this.status()
  }

  status(): LlmKeyStatus {
    const key = this.key.trim()
    const configured = key.length > 0
    return {
      configured,
      hint: key.length >= 8 ? `••••${key.slice(-4)}` : key.length > 0 ? '••••' : '',
      storagePath: this.filePath,
      state: configured ? 'ok' : this.error ? 'unreadable' : 'missing',
      encrypted: this.encrypted,
      error: this.error,
      keyInEnv: envFileHasKey(getEnv().envPath)
    }
  }
}

export interface ScrubResult {
  removed: boolean
  backupPath: string | null
  error?: string
}

/**
 * Quita `OPENCODE_API_KEY` del archivo .env y deja un respaldo `.env.bak`
 * **sin la key** (conserva el resto de la configuración). También recarga la
 * configuración en memoria para que deje de verse la key.
 */
export function scrubEnvKey(envPath: string): ScrubResult {
  if (!envPath || !existsSync(envPath)) return { removed: false, backupPath: null }
  try {
    const content = readFileSync(envPath, 'utf8')
    const lines = content.split(/\r?\n/)
    if (!lines.some((line) => ENV_KEY_LINE.test(line))) {
      return { removed: false, backupPath: null }
    }
    const backupPath = `${envPath}.bak`
    const sanitized = stripEnvKey(content)
    try {
      // Se sobrescribe siempre para sanear también un .bak de una versión previa.
      writeAtomic(backupPath, sanitized)
    } catch (error) {
      return {
        removed: false,
        backupPath: null,
        error: `No se pudo respaldar el .env antes de limpiarlo: ${(error as Error).message}`
      }
    }
    const cleaned = sanitized.split('\n')
    const note =
      '# OPENCODE_API_KEY se movió a Ajustes → Resumen con LLM (secrets.json, cifrado con DPAPI).'
    const firstContent = cleaned.findIndex((line) => line.trim().length > 0)
    cleaned.splice(firstContent < 0 ? cleaned.length : firstContent, 0, note)
    writeAtomic(envPath, cleaned.join('\n'))
    reloadEnv()
    return { removed: true, backupPath }
  } catch (error) {
    return { removed: false, backupPath: null, error: (error as Error).message }
  }
}

/**
 * Sanea un `.env.bak` heredado que todavía contenga OPENCODE_API_KEY.
 * Devuelve el error si no se pudo limpiar; null si quedó bien o no existía.
 */
function sanitizeEnvBackup(envPath: string): string | null {
  if (!envPath) return null
  const backupPath = `${envPath}.bak`
  if (!existsSync(backupPath)) return null
  try {
    const content = readFileSync(backupPath, 'utf8')
    if (!content.split(/\r?\n/).some((line) => ENV_KEY_LINE.test(line))) return null
    writeAtomic(backupPath, stripEnvKey(content))
    log.info('Respaldo .env.bak saneado: se eliminó OPENCODE_API_KEY')
    return null
  } catch (error) {
    return (error as Error).message
  }
}

export const secretsFile = (): string => join(app.getPath('userData'), 'secrets.json')
