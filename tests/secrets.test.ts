import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({
  dataDir: '',
  appDir: '',
  encryptionAvailable: true
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? paths.dataDir : paths.appDir),
    getAppPath: () => paths.appDir,
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => paths.encryptionAvailable,
    // "Cifrado" simulado: reversible, pero nunca deja la key en claro en el archivo.
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const { SecretStore } = await import('../src/main/secrets')
const { reloadEnv } = await import('../src/main/env')

let root = ''
const envFile = (): string => join(paths.appDir, '.env')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chismosito-secrets-'))
  paths.dataDir = join(root, 'userData')
  paths.appDir = join(root, 'app')
  paths.encryptionAvailable = true
  mkdirSync(paths.dataDir, { recursive: true })
  mkdirSync(paths.appDir, { recursive: true })
  delete process.env.OPENCODE_API_KEY
  reloadEnv()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.OPENCODE_API_KEY
  paths.encryptionAvailable = true
})

describe('SecretStore', () => {
  it('empieza vacío cuando no hay secrets.json ni key en el .env', () => {
    const store = new SecretStore()
    expect(store.configured()).toBe(false)
    expect(store.status()).toMatchObject({ configured: false, state: 'missing', keyInEnv: false })
  })

  it('guarda la key cifrada y solo expone un hint enmascarado', () => {
    const store = new SecretStore()
    const status = store.setApiKey('  sk-live-1234567890  ')

    expect(store.apiKey()).toBe('sk-live-1234567890')
    expect(status).toMatchObject({ configured: true, state: 'ok', encrypted: true })
    expect(status.hint).toBe('••••7890')
    expect(status.hint).not.toContain('sk-live')

    const raw = readFileSync(store.path, 'utf8')
    expect(raw).not.toContain('sk-live-1234567890')
    expect(JSON.parse(raw)).toMatchObject({ version: 1, encrypted: true })
  })

  it('recupera la key desde disco en una instancia nueva', () => {
    new SecretStore().setApiKey('sk-test-abcdefgh')
    expect(new SecretStore().apiKey()).toBe('sk-test-abcdefgh')
  })

  it('rechaza keys vacías o con espacios internos', () => {
    const store = new SecretStore()
    expect(() => store.setApiKey('   ')).toThrow(/Escribe una API key/)
    expect(() => store.setApiKey('sk con espacios')).toThrow(/espacios/)
  })

  it('permite quitar la key', () => {
    const store = new SecretStore()
    store.setApiKey('sk-test-abcdefgh')
    const status = store.clearApiKey()
    expect(status.configured).toBe(false)
    expect(new SecretStore().configured()).toBe(false)
  })

  it('falla cerrado si Windows no ofrece cifrado', () => {
    paths.encryptionAvailable = false
    const store = new SecretStore()

    expect(() => store.setApiKey('sk-test-abcdefgh')).toThrow(/No se guardará en claro/)
    expect(store.configured()).toBe(false)
    expect(existsSync(store.path)).toBe(false)
  })

  it('no cambia el estado en memoria si la escritura falla', () => {
    const store = new SecretStore()
    store.setApiKey('sk-first-0000')

    // Ruta inválida (un directorio): writeAtomic no puede escribir el archivo.
    const broken = new SecretStore(paths.dataDir)
    expect(broken.configured()).toBe(false)
    expect(() => broken.setApiKey('sk-second-1111')).toThrow()
    expect(broken.apiKey()).toBe('')
  })

  it('marca state=unreadable cuando el archivo no se puede leer', () => {
    const store = new SecretStore()
    writeFileSync(store.path, '{ esto no es json')
    const reloaded = new SecretStore()
    expect(reloaded.configured()).toBe(false)
    expect(reloaded.status().state).toBe('unreadable')
    expect(reloaded.status().error).toMatch(/No se pudo leer la API key/)
  })

  it('adopta y vuelve a cifrar un archivo heredado en claro', () => {
    const store = new SecretStore()
    writeFileSync(
      store.path,
      JSON.stringify({ version: 1, encrypted: false, opencodeApiKey: 'sk-plain-9999' })
    )
    const reloaded = new SecretStore()
    expect(reloaded.apiKey()).toBe('sk-plain-9999')
    expect(reloaded.status()).toMatchObject({ configured: true, encrypted: true })
    expect(readFileSync(store.path, 'utf8')).not.toContain('sk-plain-9999')
  })

  it('avisa cuando hereda una key en claro y no hay cifrado disponible', () => {
    paths.encryptionAvailable = false
    const store = new SecretStore()
    writeFileSync(
      store.path,
      JSON.stringify({ version: 1, encrypted: false, opencodeApiKey: 'sk-plain-9999' })
    )
    const reloaded = new SecretStore()
    expect(reloaded.status()).toMatchObject({ configured: true, encrypted: false })
    expect(reloaded.status().error).toMatch(/sin cifrar/)
  })

  it('migra la key del .env una sola vez y limpia el archivo con respaldo', () => {
    writeFileSync(
      envFile(),
      'LLM_MODEL=deepseek-v4.1-flash\nOPENCODE_API_KEY=sk-from-env-9999\nUSER_NAME=Eliezer\n'
    )
    reloadEnv()

    const store = new SecretStore()
    expect(store.apiKey()).toBe('sk-from-env-9999')
    expect(existsSync(store.path)).toBe(true)

    const cleaned = readFileSync(envFile(), 'utf8')
    expect(cleaned).not.toContain('OPENCODE_API_KEY=sk-from-env-9999')
    expect(cleaned).toContain('LLM_MODEL=deepseek-v4.1-flash')
    expect(cleaned).toContain('USER_NAME=Eliezer')
    expect(cleaned).toContain('secrets.json')
    expect(readFileSync(`${envFile()}.bak`, 'utf8')).toContain('OPENCODE_API_KEY=sk-from-env-9999')

    // La key ya no está en el .env, así que getEnv() deja de verla.
    reloadEnv()
    expect(new SecretStore().status().keyInEnv).toBe(false)

    // Y borrar secrets.json no la revive: el .env quedó limpio.
    rmSync(store.path, { force: true })
    expect(new SecretStore().configured()).toBe(false)
  })

  it('detecta una key reintroducida en el .env y la limpia a pedido', () => {
    const store = new SecretStore()
    store.setApiKey('sk-test-abcdefgh')

    writeFileSync(envFile(), 'OPENCODE_API_KEY=sk-again-7777\n')
    reloadEnv()
    expect(new SecretStore().status().keyInEnv).toBe(true)

    const status = store.scrubEnvKey()
    expect(status.keyInEnv).toBe(false)
    expect(readFileSync(envFile(), 'utf8')).not.toContain('sk-again-7777')
    expect(store.apiKey()).toBe('sk-test-abcdefgh')
  })
})
