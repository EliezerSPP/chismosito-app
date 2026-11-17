import { describe, expect, it } from 'vitest'
import { isRepetitiveText, mergeSpeakers, renderTranscript } from '../src/main/whisper/merge'

describe('isRepetitiveText', () => {
  it('detecta los bucles típicos de whisper sobre audio corrupto', () => {
    expect(
      isRepetitiveText(
        'Pero cuando... Pero cuando... Pero cuando... Pero cuando... Pero cuando...'
      )
    ).toBe(true)
    expect(isRepetitiveText('No, no, no, no, no, no, no, no, no, no.')).toBe(true)
  })

  it('no descarta una frase normal aunque repita alguna palabra', () => {
    expect(
      isRepetitiveText(
        'Revisamos el plan de migración y quedaron 519 archivos pendientes de pasar al repositorio nuevo.'
      )
    ).toBe(false)
  })
})

describe('mergeSpeakers', () => {
  it('descarta segmentos que son puro bucle de whisper', () => {
    const merged = mergeSpeakers(
      [
        { fromMs: 0, toMs: 13_000, text: 'Pero cuando... Pero cuando... Pero cuando... Pero cuando...' },
        { fromMs: 13_000, toMs: 26_000, text: 'No, no, no, no, no, no, no, no, no, no.' }
      ],
      []
    )
    expect(merged).toHaveLength(0)
  })
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

  it('también descarta el eco cuando la transcripción del micrófono es imprecisa', () => {
    const merged = mergeSpeakers(
      [
        {
          fromMs: 0,
          toMs: 8_000,
          text: 'El equipo hizo una parte del programa manual y se perdieron archivos.'
        }
      ],
      [
        {
          fromMs: 0,
          toMs: 8_000,
          text: 'La migración se hizo en parte con un programa manual y se perdieron archivos en SharePoint y logs.'
        }
      ]
    )
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
