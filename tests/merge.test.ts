import { describe, expect, it } from 'vitest'
import { mergeSpeakers, renderTranscript } from '../src/main/whisper/merge'

describe('mergeSpeakers', () => {
  it('labels each track and drops the microphone echo when speakers are used', () => {
    const mic = [
      {
        fromMs: 0,
        toMs: 8000,
        text: 'Today we reviewed the beta launch plan and decided to release it in December.'
      }
    ]
    const system = [
      {
        fromMs: 0,
        toMs: 8000,
        text: 'Today we reviewed the beta launch plan and decided to release it in December.'
      }
    ]
    const merged = mergeSpeakers(mic, system)
    expect(merged).toHaveLength(1)
    expect(merged[0].speaker).toBe('Otros')
  })

  it('keeps simultaneous interventions when they say different things', () => {
    const merged = mergeSpeakers(
      [{ fromMs: 1_000, toMs: 4_000, text: 'Yo creo que debemos posponer el experimento.' }],
      [{ fromMs: 1_200, toMs: 5_000, text: 'De acuerdo, pero necesitamos validar el precio.' }]
    )
    expect(merged.map((segment) => segment.speaker)).toEqual(['Yo', 'Otros'])
  })

  it('merges consecutive fragments by the same speaker and renders timestamps', () => {
    const merged = mergeSpeakers(
      [
        { fromMs: 0, toMs: 1_200, text: 'Hola a todos,' },
        { fromMs: 1_200, toMs: 2_400, text: 'gracias por venir.' }
      ],
      []
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toContain('gracias')
    const rendered = renderTranscript(merged)
    expect(rendered.markdown).toBe('[00:00:00] **Yo:** Hola a todos, gracias por venir.')
    expect(rendered.plain).toBe('[00:00:00] Yo: Hola a todos, gracias por venir.')
  })
})
