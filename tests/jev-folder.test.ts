import { describe, expect, it } from 'vitest'
import type { NoteIndexEntry } from '../src/main/notes/repository'
import {
  buildFolderProfiles,
  buildJevRequest,
  buildJevState,
  parseJevSuggestion,
  type JevSuggestionInput
} from '../src/main/llm/jev-core'

function note(overrides: Partial<NoteIndexEntry>): NoteIndexEntry {
  return {
    path: 'C:/MeetingNotes/Producto/nota.md',
    relativePath: 'Producto/nota.md',
    baseName: 'nota',
    title: 'Roadmap Q4',
    date: '2026-11-10T10:00:00.000Z',
    dateKey: '2026-11-10',
    durationSeconds: 1800,
    folder: 'Producto',
    tags: ['roadmap', 'q4'],
    status: 'complete',
    summary: {
      summary_bullets: ['Se revisó el roadmap.'],
      decisions: [{ decision: 'Lanzar en diciembre' }],
      action_items: [
        { task: 'Preparar la beta', owner: 'Yo', due_date: '2026-11-20' }
      ]
    },
    ...overrides
  }
}

const input: JevSuggestionInput = {
  title: 'Planificación del roadmap',
  topics: ['producto', 'roadmap'],
  folders: ['Producto', 'Ventas'],
  index: [
    note({}),
    note({
      path: 'C:/MeetingNotes/Ventas/cierre.md',
      relativePath: 'Ventas/cierre.md',
      baseName: 'cierre',
      title: 'Cierre de ventas',
      dateKey: '2026-11-12',
      folder: 'Ventas',
      tags: ['clientes', 'precios']
    })
  ],
  summary: {
    summary_bullets: ['Se revisó el roadmap del producto.'],
    decisions: [{ decision: 'Lanzar la beta' }],
    action_items: [{ task: 'Preparar la beta', owner: 'Yo', due_date: null }]
  }
}

describe('buildFolderProfiles', () => {
  it('crea perfiles con notas, etiquetas y ejemplos', () => {
    const profiles = buildFolderProfiles(input.folders, input.index)
    expect(profiles.map((profile) => profile.path)).toEqual(['Ventas', 'Producto'])
    const product = profiles.find((profile) => profile.path === 'Producto')
    expect(product?.noteCount).toBe(1)
    expect(product?.tags).toEqual(['q4', 'roadmap'])
    expect(product?.examples).toEqual(['Roadmap Q4'])
  })

  it('incluye carpetas vacías', () => {
    const profiles = buildFolderProfiles(['Producto', 'Archivo'], input.index)
    const archive = profiles.find((profile) => profile.path === 'Archivo')
    expect(archive?.noteCount).toBe(0)
    expect(archive?.examples).toEqual([])
  })
})

describe('buildJevRequest', () => {
  it('arma las preguntas de encaje y elección con un id por carpeta', () => {
    const profiles = buildFolderProfiles(input.folders, input.index)
    const { request, mapping } = buildJevRequest(input, profiles, 'jev-1.13-free')
    expect(request.model).toBe('jev-1.13-free')
    expect(request.questions.has_fit).toMatchObject({ type: 'noul' })
    const folder = request.questions.folder as {
      type: string
      criteria: Record<string, unknown>
    }
    expect(folder.type).toBe('choice')
    expect(Object.keys(folder.criteria)).toHaveLength(2)
    expect(Object.values(mapping).sort()).toEqual(['Producto', 'Ventas'])
    expect(buildJevState(input, profiles)).toContain('Carpetas existentes:')
  })
})

describe('parseJevSuggestion', () => {
  const mapping = { folder_1: 'Producto', folder_2: 'Ventas' }

  it('acepta una elección con encaje y probabilidad suficientes', () => {
    const suggestion = parseJevSuggestion(
      {
        model: 'jev-1.13.0',
        answers: {
          has_fit: { type: 'noul', noul: 0.94 },
          folder: {
            type: 'choice',
            choice: 'folder_1',
            confidence: 0.9,
            probabilities: { folder_1: 0.91, folder_2: 0.09 }
          }
        }
      },
      mapping,
      'jev-1.13-free'
    )
    expect(suggestion).toEqual({
      folder: 'Producto',
      confidence: 0.91,
      model: 'jev-1.13.0'
    })
  })

  it('acepta un encaje medio cuando la elección es clara', () => {
    const suggestion = parseJevSuggestion(
      {
        answers: {
          has_fit: { noul: 0.61 },
          folder: {
            choice: 'folder_2',
            confidence: 1,
            probabilities: { folder_1: 0, folder_2: 1, folder_3: 0 }
          }
        }
      },
      { folder_1: 'Producto', folder_2: 'Smart Compliance', folder_3: 'Test' },
      'jev-1.13-free'
    )
    expect(suggestion?.folder).toBe('Smart Compliance')
    expect(suggestion?.confidence).toBe(1)
  })

  it('rechaza un encaje bajo, una probabilidad baja o una opción inválida', () => {
    const base = {
      answers: {
        has_fit: { type: 'noul', noul: 0.94 },
        folder: {
          type: 'choice',
          choice: 'folder_1',
          probabilities: { folder_1: 0.91, folder_2: 0.09 }
        }
      }
    }
    expect(
      parseJevSuggestion(
        { ...base, answers: { ...base.answers, has_fit: { type: 'noul', noul: 0.3 } } },
        mapping,
        'm'
      )
    ).toBeNull()
    expect(
      parseJevSuggestion(
        {
          ...base,
          answers: {
            ...base.answers,
            folder: {
              type: 'choice',
              choice: 'folder_1',
              probabilities: { folder_1: 0.3, folder_2: 0.7 }
            }
          }
        },
        mapping,
        'm'
      )
    ).toBeNull()
    expect(
      parseJevSuggestion(
        {
          ...base,
          answers: {
            ...base.answers,
            folder: { type: 'choice', choice: 'nope', probabilities: {} }
          }
        },
        mapping,
        'm'
      )
    ).toBeNull()
  })

  it('acepta que el modelo devuelva directamente la ruta de la carpeta', () => {
    const suggestion = parseJevSuggestion(
      {
        answers: {
          has_fit: { noul: 0.9 },
          folder: {
            choice: 'Producto',
            confidence: 0.86,
            probabilities: {}
          }
        }
      },
      mapping,
      'm'
    )
    expect(suggestion?.folder).toBe('Producto')
    expect(suggestion?.confidence).toBe(0.86)
  })
})
