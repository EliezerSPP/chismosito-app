import { describe, expect, it } from 'vitest'
import {
  CUSTOM_MODEL_ID,
  FALLBACK_MODEL_IDS,
  buildModelItems,
  fallbackModelOptions,
  modelLabel,
  parseModelIds
} from '../src/shared/models'

describe('parseModelIds', () => {
  it('lee el formato OpenAI { data: [{ id }] }', () => {
    expect(parseModelIds({ data: [{ id: 'deepseek-v4.1-flash' }, { id: 'glm-5.3' }] })).toEqual([
      'deepseek-v4.1-flash',
      'glm-5.3'
    ])
  })

  it('acepta { models: [...] } y arreglos sueltos', () => {
    expect(parseModelIds({ models: [{ id: 'kimi-k3' }] })).toEqual(['kimi-k3'])
    expect(parseModelIds(['a', 'b'])).toEqual(['a', 'b'])
    expect(parseModelIds({ model: ['c'] })).toEqual(['c'])
  })

  it('usa name cuando falta el id', () => {
    expect(parseModelIds({ data: [{ name: 'mimo-v2.6-flash' }] })).toEqual(['mimo-v2.6-flash'])
  })

  it('recorta, deduplica y descarta entradas inválidas', () => {
    expect(
      parseModelIds({
        data: [{ id: '  deepseek-v4.1-flash  ' }, { id: 'deepseek-v4.1-flash' }, { id: '' }, null, 42]
      })
    ).toEqual(['deepseek-v4.1-flash'])
  })

  it('devuelve una lista vacía si el payload no sirve', () => {
    expect(parseModelIds(null)).toEqual([])
    expect(parseModelIds({ data: 'nope' })).toEqual([])
    expect(parseModelIds({})).toEqual([])
  })
})

describe('modelLabel', () => {
  it('usa las etiquetas conocidas', () => {
    expect(modelLabel('deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash')
    expect(modelLabel('claude-haiku-5.5')).toBe('Claude Haiku 5.5')
  })

  it('formatea ids desconocidos de forma legible', () => {
    expect(modelLabel('nuevo-modelo-2')).toBe('Nuevo Modelo 2')
  })
})

describe('buildModelItems', () => {
  const options = [
    { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
    { id: 'kimi-k3', label: 'Kimi K3' }
  ]

  it('pone el default primero y la opción personalizada al final', () => {
    const items = buildModelItems(options, 'Default del .env', '')
    expect(items.map((item) => item.kind)).toEqual(['default', 'model', 'model', 'custom'])
    expect(items[0].id).toBe('')
    expect(items[items.length - 1].id).toBe(CUSTOM_MODEL_ID)
  })

  it('filtra por nombre o por id sin perder la opción personalizada', () => {
    expect(buildModelItems(options, 'Default del .env', 'kimi').map((item) => item.id)).toEqual([
      'kimi-k3',
      CUSTOM_MODEL_ID
    ])
    expect(
      buildModelItems(options, 'Default del .env', 'deepseek-v4.1').map((item) => item.id)
    ).toEqual(['deepseek-v4.1-flash', CUSTOM_MODEL_ID])
    expect(buildModelItems(options, 'Default del .env', 'k3').map((item) => item.id)).toEqual([
      'kimi-k3',
      CUSTOM_MODEL_ID
    ])
  })

  it('mantiene el default si la búsqueda lo menciona', () => {
    const items = buildModelItems(options, 'Default del .env (deepseek-v4.1-flash)', 'default')
    expect(items[0].kind).toBe('default')
  })
})

describe('fallbackModelOptions', () => {
  it('incluye el modelo por defecto con etiqueta', () => {
    const options = fallbackModelOptions()
    expect(options.length).toBe(FALLBACK_MODEL_IDS.length)
    expect(options[0]).toEqual({ id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' })
    expect(FALLBACK_MODEL_IDS).toContain('claude-haiku-5.5')
    expect(new Set(FALLBACK_MODEL_IDS).size).toBe(FALLBACK_MODEL_IDS.length)
  })
})
