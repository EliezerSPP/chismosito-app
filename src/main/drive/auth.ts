import { app, net } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { shell, safeStorage } from 'electron'
import { OAuth2Client, type Credentials } from 'google-auth-library'
import { DRIVE_SCOPE } from '@shared/constants'
import { getEnv } from '../env'
import { ensureDir } from '../lib/fs'
import { log } from '../lib/logger'

const CALLBACK_PATH = '/oauth2callback'

export class DriveAuth {
  private tokenPath(): string {
    return join(app.getPath('userData'), 'drive-token.bin')
  }

  clientConfigured(): boolean {
    const env = getEnv()
    return Boolean(env.googleClientId && env.googleClientSecret)
  }

  tokenSource(): 'env' | 'stored' | 'none' {
    const env = getEnv()
    if (env.googleRefreshToken) return 'env'
    if (this.readStoredToken()?.refresh_token) return 'stored'
    return 'none'
  }

  connected(): boolean {
    return this.tokenSource() !== 'none'
  }

  private readStoredToken(): Credentials | null {
    const path = this.tokenPath()
    if (!existsSync(path)) return null
    try {
      const encrypted = readFileSync(path)
      if (!safeStorage.isEncryptionAvailable()) return null
      return JSON.parse(safeStorage.decryptString(encrypted)) as Credentials
    } catch (error) {
      log.warn('No se pudo leer el token de Drive', error)
      return null
    }
  }

  private saveStoredToken(tokens: Credentials): void {
    const path = this.tokenPath()
    ensureDir(dirname(path))
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('El almacenamiento seguro de Windows no está disponible')
    }
    writeFileSync(path, safeStorage.encryptString(JSON.stringify(tokens)))
  }

  private clearStoredToken(): void {
    const path = this.tokenPath()
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch (error) {
        log.warn('No se pudo borrar el token de Drive', error)
      }
    }
  }

  private createClient(redirectUri?: string): OAuth2Client {
    const env = getEnv()
    if (!env.googleClientId || !env.googleClientSecret) {
      throw new Error('Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el archivo .env')
    }
    return new OAuth2Client({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      redirectUri
    })
  }

  getClient(): OAuth2Client {
    const source = this.tokenSource()
    if (source === 'none') {
      throw new Error('Google Drive no está conectado. Conéctalo en Ajustes.')
    }
    const client = this.createClient()
    if (source === 'env') {
      client.setCredentials({ refresh_token: getEnv().googleRefreshToken })
      return client
    }
    const stored = this.readStoredToken()
    if (!stored) throw new Error('No se encontró el token de Google Drive. Vuelve a conectar.')
    client.setCredentials(stored)
    client.on('tokens', (tokens) => {
      try {
        this.saveStoredToken({ ...stored, ...tokens })
      } catch (error) {
        log.warn('No se pudo actualizar el token de Drive', error)
      }
    })
    return client
  }

  async accessToken(forceRefresh = false): Promise<string> {
    const client = this.getClient()
    if (forceRefresh) client.setCredentials({ ...client.credentials, expiry_date: 0 })
    const result = await client.getAccessToken()
    if (!result.token) {
      throw new Error('Google no devolvió un token de acceso. Vuelve a conectar Drive.')
    }
    return result.token
  }

  async ensure(): Promise<void> {
    await this.accessToken()
  }

  async connect(): Promise<void> {
    if (!this.clientConfigured()) {
      throw new Error('Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el .env')
    }

    const state = randomBytes(24).toString('hex')
    const server = createServer()
    let settled = false
    const result = new Promise<string>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        server.close()
        reject(new Error('La conexión con Google tardó demasiado. Intenta de nuevo.'))
      }, 5 * 60_000)

      const finish = (error: Error | null, code?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        server.close()
        if (error) reject(error)
        else resolvePromise(code as string)
      }

      server.on('request', (request, response) => {
        try {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          if (url.pathname !== CALLBACK_PATH) {
            response.writeHead(404).end('Not found')
            return
          }
          const error = url.searchParams.get('error')
          const returnedState = url.searchParams.get('state')
          const code = url.searchParams.get('code')
          if (error) {
            response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end(htmlPage('No se pudo conectar', `Google devolvió: ${error}`))
            finish(new Error(`Google rechazó la conexión: ${error}`))
            return
          }
          if (returnedState !== state) {
            response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end(htmlPage('Error de seguridad', 'El estado OAuth no coincide.'))
            finish(new Error('Estado OAuth inválido'))
            return
          }
          if (!code) {
            response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end(htmlPage('Error', 'No se recibió el código de autorización.'))
            return
          }
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(
            htmlPage(
              'Chismosito se conectó a Google Drive',
              'Puedes cerrar esta pestaña y volver a la aplicación.'
            )
          )
          finish(null, code)
        } catch (error) {
          finish(error as Error)
        }
      })
      server.on('error', (error) => finish(error))
    })

    await new Promise<void>((resolvePromise, reject) => {
      server.listen(0, '127.0.0.1', () => resolvePromise())
      server.once('error', reject)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('No se pudo abrir el puerto local para OAuth')
    }
    const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    const client = this.createClient(redirectUri)
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE],
      state,
      redirect_uri: redirectUri
    })

    log.info('Abriendo consentimiento de Google Drive')
    await shell.openExternal(authUrl)
    const code = await result
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri })
    if (!tokens.refresh_token) {
      const previous = this.readStoredToken()
      if (previous?.refresh_token) tokens.refresh_token = previous.refresh_token
      else {
        throw new Error(
          'Google no devolvió un refresh token. Revoca el acceso de Chismosito en tu cuenta de Google e inténtalo otra vez.'
        )
      }
    }
    this.saveStoredToken(tokens)
    log.info('Google Drive conectado')
  }

  disconnect(): void {
    this.clearStoredToken()
    log.info('Google Drive desconectado')
  }
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title>
  <style>body{font-family:Segoe UI,system-ui,sans-serif;background:#faf7f2;color:#2a2420;display:grid;place-items:center;height:100vh;margin:0}main{max-width:520px;padding:40px;background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(50,35,20,.12)}h1{font-size:24px;margin:0 0 12px}p{line-height:1.6;margin:0;color:#61554a}</style>
  </head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
