import { describe, expect, it } from 'vitest'
import { normalizeLlmBaseUrl } from '../src/shared/url'

describe('normalizeLlmBaseUrl', () => {
  it('expands the OpenCode gateway root to the OpenAI-compatible base', () => {
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

  it('completes the OpenAI sub-path when only /openai is present', () => {
    expect(normalizeLlmBaseUrl('https://opencode.ai/inference/openai')).toBe(
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

  it('falls back to the default when empty', () => {
    expect(normalizeLlmBaseUrl('   ')).toBe('https://opencode.ai/inference/openai/v1')
  })
})
