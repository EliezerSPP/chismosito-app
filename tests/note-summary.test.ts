import { describe, expect, it } from 'vitest'
import { buildNoteMarkdown, extractSummary } from '../src/main/notes/format'

describe('extractSummary', () => {
  it('lee viñetas, decisiones y la tabla de acciones', () => {
    const markdown = buildNoteMarkdown({
      title: 'Planificación Q4',
      date: '2026-11-14T15:30:00-06:00',
      durationSeconds: 3_720,
      language: 'es',
      audio: 'audio.webm',
      folder: 'Producto',
      tags: ['q4'],
      status: 'complete',
      llm: 'modelo',
      summary: {
        summary_bullets: ['Uno', 'Dos'],
        decisions: [
          { decision: 'Lanzar la beta', context: 'Validar con clientes' },
          { decision: 'Subir el precio' }
        ],
        action_items: [
          { task: 'Preparar la guía', owner: 'María', due_date: '2026-11-25' },
          { task: 'Revisar precios', owner: 'Sin asignar', due_date: null }
        ]
      },
      transcript: '[00:00:12] **Yo:** Hola.',
      createdAt: '2026-11-14T16:00:00-06:00',
      updatedAt: '2026-11-14T16:32:00-06:00'
    })

    const summary = extractSummary(
      markdown.slice(markdown.indexOf('# Planificación'))
    )
    expect(summary.summary_bullets).toEqual(['Uno', 'Dos'])
    expect(summary.decisions).toEqual([
      { decision: 'Lanzar la beta', context: 'Validar con clientes' },
      { decision: 'Subir el precio' }
    ])
    expect(summary.action_items).toEqual([
      { task: 'Preparar la guía', owner: 'María', due_date: '2026-11-25' },
      { task: 'Revisar precios', owner: 'Sin asignar', due_date: null }
    ])
  })

  it('devuelve listas vacías cuando la nota no tiene resumen', () => {
    const summary = extractSummary(
      '## Resumen\n\n_(Pendiente de generar)_\n\n---\n\n## Transcripción\n\n_(Sin transcripción)_'
    )
    expect(summary.summary_bullets).toEqual([])
    expect(summary.decisions).toEqual([])
    expect(summary.action_items).toEqual([])
  })

  it('ignora la fila vacía de acciones y desescapa pipes', () => {
    const content = [
      '## Acciones',
      '',
      '| Acción | Responsable | Fecha límite |',
      '| --- | --- | --- |',
      '| Escribir A \\| B | Yo | — |',
      '| Sin acciones asignadas | — | — |'
    ].join('\n')
    const summary = extractSummary(content)
    expect(summary.action_items).toEqual([
      { task: 'Escribir A | B', owner: 'Yo', due_date: null }
    ])
  })
})
