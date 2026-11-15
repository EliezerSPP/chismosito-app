import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  chunkTranscript,
  collectActions,
  formatActionsAsMarkdown,
  matchesAssignee,
  matchesFolder,
  retrieveChunks,
  scoreNoteMetadata
} from '../src/main/chat/retrieval'

const lines = [
  { timestamp: '00:00:10', seconds: 10, speaker: 'Yo', text: 'Hola, hoy revisamos el presupuesto del Q4.' },
  { timestamp: '00:00:20', seconds: 20, speaker: 'Otros', text: 'El presupuesto de marketing sube un 10%.' },
  {
    timestamp: '00:00:30',
    seconds: 30,
    speaker: 'Otros',
    text: 'También hablamos del roadmap de producto y del lanzamiento de la beta.'
  },
  {
    timestamp: '00:00:40',
    seconds: 40,
    speaker: 'Yo',
    text: 'Carlos se encarga de la presentación y Ana revisa los precios.'
  }
]

describe('chunkTranscript y retrieveChunks', () => {
  it('trocea la transcripción conservando timestamps', () => {
    const chunks = chunkTranscript(lines, 80)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].timestamp).toBe('00:00:10')
    expect(chunks[0].text).toContain('presupuesto')
  })

  it('encuentra los fragmentos relevantes para una pregunta', () => {
    const chunks = retrieveChunks(lines, ['¿Qué pasó con el presupuesto de marketing?'], 2)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.map((chunk) => chunk.text).join('\n')).toContain('marketing')
  })

  it('devuelve vacío cuando no hay coincidencias', () => {
    expect(retrieveChunks(lines, ['fotosíntesis cuántica'])).toEqual([])
  })
})

const notes = [
  {
    title: 'Plan Q4',
    dateKey: '2026-11-10',
    folder: 'Producto',
    tags: ['q4'],
    summary: {
      summary_bullets: ['Se revisó el presupuesto de marketing.'],
      decisions: [{ decision: 'Aprobar el presupuesto' }],
      action_items: [
        { task: 'Preparar la presentación', owner: 'Yo', due_date: '2026-11-20' },
        { task: 'Revisar precios', owner: 'Ana', due_date: null }
      ]
    }
  },
  {
    title: 'Retro semana',
    dateKey: '2026-11-14',
    folder: 'Producto/Móvil',
    tags: [],
    summary: {
      summary_bullets: [],
      decisions: [],
      action_items: [
        { task: 'Escribir el resumen', owner: 'Carlos', due_date: '2026-11-15' }
      ]
    }
  },
  {
    title: 'Ventas',
    dateKey: '2026-11-05',
    folder: '',
    tags: ['ventas'],
    summary: {
      summary_bullets: ['Cierre del trimestre.'],
      decisions: [],
      action_items: []
    }
  }
]

describe('applyFilters', () => {
  it('filtra por rango de fechas y carpeta con subcarpetas', () => {
    const result = applyFilters(notes, {
      from: '2026-11-09',
      to: '2026-11-15',
      folder: 'Producto'
    })
    expect(result.map((note) => note.title)).toEqual(['Plan Q4', 'Retro semana'])
  })

  it('filtra solo las notas sin carpeta', () => {
    expect(applyFilters(notes, { from: null, to: null, folder: '' })).toHaveLength(1)
    expect(matchesFolder('Producto/Móvil', 'Producto')).toBe(true)
    expect(matchesFolder('Producto', 'Producto')).toBe(true)
    expect(matchesFolder('Ventas', 'Producto')).toBe(false)
  })
})

describe('collectActions', () => {
  it('encuentra las tareas asignadas al usuario local', () => {
    const matches = collectActions(notes, {
      filters: null,
      mine: true,
      userName: 'Carlos'
    })
    expect(matches.map((match) => match.task)).toEqual([
      'Preparar la presentación',
      'Escribir el resumen'
    ])
  })

  it('filtra por fecha límite', () => {
    const matches = collectActions(notes, {
      filters: null,
      mine: false,
      userName: 'Carlos',
      dueFrom: '2026-11-15',
      dueTo: '2026-11-20'
    })
    expect(matches.map((match) => match.task)).toEqual([
      'Preparar la presentación',
      'Escribir el resumen'
    ])
  })

  it('formatea las acciones como tabla markdown', () => {
    const matches = collectActions(notes, { filters: null, mine: false, userName: 'Carlos' })
    const table = formatActionsAsMarkdown(matches)
    expect(table).toContain('| Acción | Responsable | Fecha límite | Reunión |')
    expect(table).toContain('Preparar la presentación')
    expect(table).toContain('Plan Q4 (2026-11-10)')
  })

  it('puede buscar explícitamente las tareas sin asignar', () => {
    expect(
      matchesAssignee('Sin asignar', {
        mine: false,
        userName: 'Carlos',
        assignee: 'Sin asignar'
      })
    ).toBe(true)
    expect(
      matchesAssignee('Ana', {
        mine: false,
        userName: 'Carlos',
        assignee: 'Sin asignar'
      })
    ).toBe(false)
    expect(
      matchesAssignee('Sin asignar', { mine: true, userName: 'Carlos' })
    ).toBe(false)
  })
})

describe('scoreNoteMetadata', () => {
  it('prioriza notas con más coincidencias', () => {
    const budget = scoreNoteMetadata(notes[0], ['presupuesto marketing'])
    const unrelated = scoreNoteMetadata(notes[2], ['presupuesto marketing'])
    expect(budget).toBeGreaterThan(unrelated)
  })
})
