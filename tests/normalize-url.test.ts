import { describe, expect, it } from 'vitest'
import { normalizeLlmBaseUrl } from '../src/shared/url'
import { DEFAULT_LLM_BASE_URL } from '../src/shared/constants'

describe('normalizeLlmBaseUrl', () => {
  it('mantiene la raíz como pago por uso para no romper .env existentes', () => {
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference')).toBe(
      'https://opencode.ai/inference/openai/v1'
    )
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/')).toBe(
      'https://opencode.ai/inference/openai/v1'
    )
    expect(normalizeLlmBaseUrl('https://opencode.ai')).toBe(
      'https://opencode.ai/inference/openai/v1'
    )
  })

  it('usa OpenCode Go como default cuando no hay URL', () => {
    expect(DEFAULT_LLM_BASE_URL).toBe('https://opencode.ai/inference/go/openai/v1')
    expect(normalizeLlmBaseUrl('')).toBe(DEFAULT_LLM_BASE_URL)
    expect(normalizeLlmBaseUrl('   ')).toBe(DEFAULT_LLM_BASE_URL)
  })

  it('completa la sub-ruta de Go cuando falta /openai/v1', () => {
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/go')).toBe(
      'https://opencode.ai/inference/go/openai/v1'
    )
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/go/openai')).toBe(
      'https://opencode.ai/inference/go/openai/v1'
    )
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/go/openai/v1')).toBe(
      'https://opencode.ai/inference/go/openai/v1'
    )
  })

  it('completes the pay-as-you-go sub-path when only /openai is present', () => {
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/openai')).toBe(
      'https://opencode.ai/inference/openai/v1'
    )
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/openai/v1')).toBe(
      'https://opencode.ai/inference/openai/v1'
    )
  })

  it('keeps a complete endpoint untouched', () => {
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/openai/v1')).toBe(
      'https://opencode.ai/inference/openai/v1'
    )
  })

  it('leaves other compatible providers untouched', () => {
    expect(normalizeLlmBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
    expect(normalizeLlmBaseUrl('http://127.0.0.1:8787/v1/')).toBe('http://127.0.0.1:8787/v1')
  })
})
