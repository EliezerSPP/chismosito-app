import { describe, expect, it } from 'vitest'
import {
  fallbackPlan,
  planLibraryQuery,
  resolveNaturalRange,
  sanitizePlan,
  type PlanInput
} from '../src/main/chat/planner'

const input: PlanInput = {
  question: '¿Qué tareas me asignaron esta semana?',
  today: '2026-11-15',
  userName: 'Carlos',
  filters: null,
  folders: ['Producto', 'Ventas'],
  recentTitles: []
}

describe('resolveNaturalRange', () => {
  it('resuelve esta semana de lunes a domingo', () => {
    expect(resolveNaturalRange('¿Qué pasó esta semana?', '2026-11-15')).toEqual({
      from: '2026-11-09',
      to: '2026-11-15'
    })
  })

  it('resuelve hoy, ayer y el mes pasado', () => {
    expect(resolveNaturalRange('lo de hoy', '2026-11-15')).toEqual({
      from: '2026-11-15',
      to: '2026-11-15'
    })
    expect(resolveNaturalRange('lo de ayer', '2026-11-15')).toEqual({
      from: '2026-11-14',
      to: '2026-11-14'
    })
    expect(resolveNaturalRange('decisiones del mes pasado', '2026-11-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31'
    })
  })
})

describe('sanitizePlan', () => {
  it('respeta los filtros de la interfaz como límites duros', () => {
    const plan = sanitizePlan(
      {
        queries: ['presupuesto'],
        from: '2026-11-01',
        to: '2026-11-30',
        folder: 'Ventas',
        actions: {
          requested: true,
          mine: true,
          assignee: null,
          dueFrom: '2026-11-01',
          dueTo: '2026-11-30'
        }
      },
      {
        ...input,
        filters: { from: '2026-11-09', to: '2026-11-15', folder: 'Producto' }
      }
    )
    expect(plan.from).toBe('2026-11-09')
    expect(plan.to).toBe('2026-11-15')
    expect(plan.folder).toBe('Producto')
    expect(plan.actions?.mine).toBe(true)
    expect(plan.actions?.dueFrom).toBe('2026-11-01')
  })

  it('acepta una carpeta del plan cuando no hay filtro manual', () => {
    const plan = sanitizePlan({ queries: ['ventas'], folder: 'ventas' }, input)
    expect(plan.folder).toBe('Ventas')
  })

  it('interpreta «Sin clasificar» como la carpeta raíz', () => {
    const plan = sanitizePlan({ queries: ['pendientes'], folder: 'Sin clasificar' }, input)
    expect(plan.folder).toBe('')
  })

  it('cae a la pregunta original cuando el plan no trae búsquedas', () => {
    const plan = sanitizePlan({}, input)
    expect(plan.queries).toEqual([input.question])
  })
})

describe('fallbackPlan', () => {
  it('detecta tareas propias y el rango semanal', () => {
    const plan = fallbackPlan(input)
    expect(plan.actions?.requested).toBe(true)
    expect(plan.actions?.mine).toBe(true)
    expect(plan.from).toBe('2026-11-09')
    expect(plan.to).toBe('2026-11-15')
  })

  it('no inventa rango cuando la pregunta no lo pide', () => {
    const plan = fallbackPlan({
      ...input,
      question: '¿De qué hablamos con Ana sobre el roadmap?'
    })
    expect(plan.actions).toBeNull()
    expect(plan.from).toBeNull()
    expect(plan.to).toBeNull()
  })
})

describe('planLibraryQuery', () => {
  it('completa acciones y fechas cuando el modelo las omite', async () => {
    const plan = await planLibraryQuery(
      { chatJson: async () => ({ queries: ['tareas'] }) },
      input
    )
    expect(plan.actions?.requested).toBe(true)
    expect(plan.actions?.mine).toBe(true)
    expect(plan.from).toBe('2026-11-09')
    expect(plan.to).toBe('2026-11-15')
  })

  it('no añade fechas a preguntas abiertas', async () => {
    const plan = await planLibraryQuery(
      { chatJson: async () => ({ queries: ['roadmap'] }) },
      { ...input, question: '¿De qué hablamos con Ana sobre el roadmap?' }
    )
    expect(plan.actions).toBeNull()
    expect(plan.from).toBeNull()
    expect(plan.to).toBeNull()
  })
})
