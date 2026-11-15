import { describe, expect, it } from 'vitest'
import {
  chatKeyForLibrary,
  chatKeyForNote,
  chatRemotePathForLibrary,
  chatRemotePathForNote,
  parentRemotePath,
  remoteFileName
} from '../src/main/drive/paths'

describe('rutas de conversaciones en Drive', () => {
  it('espeja la ruta de la nota para los chats de grabación', () => {
    expect(chatRemotePathForNote('2026-11-14-15-30.md')).toBe(
      'Conversaciones/2026-11-14-15-30.json'
    )
    expect(chatRemotePathForNote('Producto\\2026-11-14-15-30.md')).toBe(
      'Conversaciones/Producto/2026-11-14-15-30.json'
    )
    expect(chatKeyForNote('Producto/2026-11-14-15-30.md')).toBe(
      'note:Producto/2026-11-14-15-30.md'
    )
  })

  it('usa una carpeta Global y el id para las conversaciones globales', () => {
    expect(chatRemotePathForLibrary('abc-123')).toBe('Conversaciones/Global/abc-123.json')
    expect(chatKeyForLibrary('abc-123')).toBe('global:abc-123')
  })

  it('separa carpeta y nombre del archivo remoto', () => {
    expect(parentRemotePath('Conversaciones/Producto/nota.json')).toBe(
      'Conversaciones/Producto'
    )
    expect(remoteFileName('Conversaciones/Producto/nota.json')).toBe('nota.json')
  })
})
