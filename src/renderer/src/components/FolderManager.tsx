import { useState } from 'react'
import { Folder, FolderPlus, Loader2, Pencil, Trash2 } from 'lucide-react'
import type { NoteMeta } from '@shared/types'
import { useAppStore } from '../store'
import { Modal } from './Modal'
import { ConfirmDialog } from './ConfirmDialog'
import { errorMessage } from '../lib/errors'
import { cn } from '../lib/cn'

function folderBase(folder: string): string {
  const index = folder.lastIndexOf('/')
  return index >= 0 ? folder.slice(index + 1) : folder
}

function folderParent(folder: string): string {
  const index = folder.lastIndexOf('/')
  return index >= 0 ? folder.slice(0, index) : ''
}

function folderDepth(folder: string): number {
  return folder.split('/').filter(Boolean).length - 1
}

function countNotes(notes: NoteMeta[], folder: string): number {
  return notes.filter(
    (note) => note.folder === folder || note.folder.startsWith(`${folder}/`)
  ).length
}

function countChildFolders(folders: string[], folder: string): number {
  return folders.filter((entry) => entry.startsWith(`${folder}/`)).length
}

export function FolderManager(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const folders = useAppStore((state) => state.folders)
  const jobs = useAppStore((state) => state.jobs)
  const recording = useAppStore((state) => state.recording)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const pushToast = useAppStore((state) => state.pushToast)

  const [createOpen, setCreateOpen] = useState(false)
  const [createValue, setCreateValue] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState<'create' | 'rename' | 'delete' | null>(null)

  const activeJobs = jobs.some(
    (job) => !['done', 'failed', 'cancelled'].includes(job.stage)
  )
  const blocked = recording.phase !== 'idle' || activeJobs
  const deleteNotes = deleteTarget ? countNotes(notes, deleteTarget) : 0

  const openCreate = (): void => {
    setCreateValue('')
    setCreateError(null)
    setCreateOpen(true)
  }

  const submitCreate = async (): Promise<void> => {
    if (busy) return
    const value = createValue.trim()
    if (!value) {
      setCreateError('Escribe un nombre de carpeta')
      return
    }
    setBusy('create')
    setCreateError(null)
    try {
      await window.chismosito.folders.create(value)
      await refreshNotes()
      setCreateOpen(false)
      pushToast('success', 'Carpeta creada')
    } catch (error) {
      setCreateError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const openRename = (folder: string): void => {
    setRenameTarget(folder)
    setRenameValue(folderBase(folder))
    setRenameError(null)
  }

  const submitRename = async (): Promise<void> => {
    if (!renameTarget || busy) return
    const value = renameValue.trim()
    if (!value) {
      setRenameError('Escribe un nombre de carpeta')
      return
    }
    if (/[\\/]/.test(value)) {
      setRenameError('Editar solo cambia el nombre. No uses barras.')
      return
    }
    setBusy('rename')
    setRenameError(null)
    try {
      const result = await window.chismosito.folders.rename(renameTarget, value)
      await refreshNotes()
      setRenameTarget(null)
      pushToast(
        'success',
        `Carpeta renombrada · ${result.movedNotes} ${
          result.movedNotes === 1 ? 'nota actualizada' : 'notas actualizadas'
        }`
      )
    } catch (error) {
      setRenameError(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const submitDelete = async (): Promise<void> => {
    if (!deleteTarget || busy) return
    setBusy('delete')
    try {
      const result = await window.chismosito.folders.remove(deleteTarget)
      await refreshNotes()
      pushToast(
        'success',
        result.movedNotes > 0
          ? `Carpeta eliminada · ${result.movedNotes} ${
              result.movedNotes === 1 ? 'nota movida' : 'notas movidas'
            } a Sin clasificar`
          : 'Carpeta eliminada'
      )
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {folders.length} {folders.length === 1 ? 'carpeta' : 'carpetas'} en tu biblioteca.
        </p>
        <button
          type="button"
          onClick={openCreate}
          disabled={busy !== null}
          className="btn-secondary h-8 text-xs"
        >
          <FolderPlus className="size-3.5" />
          Nueva carpeta
        </button>
      </div>

      {blocked ? (
        <p className="rounded-xl border border-line bg-surface2/50 px-3 py-2 text-[11px] leading-relaxed text-muted">
          Detén la grabación y espera a que terminen los trabajos de procesamiento para
          renombrar o eliminar carpetas.
        </p>
      ) : null}

      {folders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm font-medium">Aún no tienes carpetas</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
            Crea una carpeta para organizar tus reuniones. Jev podrá proponerla cuando
            termine de procesar una nota.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="max-h-[360px] divide-y divide-line overflow-y-auto">
            {folders.map((folder) => {
              const total = countNotes(notes, folder)
              const children = countChildFolders(folders, folder)
              const depth = folderDepth(folder)
              return (
                <div
                  key={folder}
                  className="flex items-center gap-2 py-2 pr-2"
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                >
                  <Folder className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{folderBase(folder)}</p>
                    <p className="truncate text-[10px] text-muted">
                      {folder}
                      {total > 0
                        ? ` · ${total} ${total === 1 ? 'nota' : 'notas'}`
                        : children > 0
                          ? ' · sin notas directas'
                          : ' · vacía'}
                      {children > 0
                        ? ` · ${children} ${children === 1 ? 'subcarpeta' : 'subcarpetas'}`
                        : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openRename(folder)}
                    disabled={blocked || busy !== null}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface2 hover:text-ink',
                      (blocked || busy !== null) && 'cursor-not-allowed opacity-40'
                    )}
                    aria-label={`Renombrar ${folder}`}
                    title={blocked ? 'Espera a que terminen los trabajos en curso' : 'Renombrar carpeta'}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(folder)}
                    disabled={blocked || busy !== null}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300',
                      (blocked || busy !== null) && 'cursor-not-allowed opacity-40'
                    )}
                    aria-label={`Eliminar ${folder}`}
                    title={blocked ? 'Espera a que terminen los trabajos en curso' : 'Eliminar carpeta'}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          if (busy !== 'create') setCreateOpen(false)
        }}
        title="Nueva carpeta"
        description="Puedes usar / para crear subcarpetas, por ejemplo Producto/Q4."
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setCreateOpen(false)}
              disabled={busy === 'create'}
            >
              Cancelar
            </button>
            <button
              className="btn-primary"
              onClick={() => void submitCreate()}
              disabled={busy === 'create'}
            >
              {busy === 'create' ? <Loader2 className="size-4 animate-spin" /> : null}
              Crear carpeta
            </button>
          </>
        }
      >
        <label className="label" htmlFor="new-folder">
          Ruta de la carpeta
        </label>
        <input
          id="new-folder"
          autoFocus
          className="field"
          value={createValue}
          onChange={(event) => {
            setCreateValue(event.target.value)
            setCreateError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submitCreate()
            }
          }}
          placeholder="Producto/Q4"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Se normalizan acentos y caracteres inválidos. Solo se crea la carpeta; no se mueve
          ninguna nota.
        </p>
        {createError ? (
          <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {createError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={renameTarget !== null}
        onClose={() => {
          if (busy !== 'rename') setRenameTarget(null)
        }}
        title="Renombrar carpeta"
        description="Solo cambia el nombre; la carpeta mantiene su ubicación."
        footer={
          <>
            <button
              className="btn-secondary"
              onClick={() => setRenameTarget(null)}
              disabled={busy === 'rename'}
            >
              Cancelar
            </button>
            <button
              className="btn-primary"
              onClick={() => void submitRename()}
              disabled={busy === 'rename'}
            >
              {busy === 'rename' ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar nombre
            </button>
          </>
        }
      >
        <label className="label" htmlFor="rename-folder">
          Nuevo nombre
        </label>
        <input
          id="rename-folder"
          autoFocus
          className="field"
          value={renameValue}
          onChange={(event) => {
            setRenameValue(event.target.value)
            setRenameError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submitRename()
            }
          }}
        />
        {renameTarget ? (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Se renombrarán la carpeta y sus subcarpetas. Las notas y sus audios se mueven con
            ella. Ruta nueva: <code>{folderParent(renameTarget)
              ? `${folderParent(renameTarget)}/${renameValue.trim()}`
              : renameValue.trim()}</code>
          </p>
        ) : null}
        {renameError ? (
          <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {renameError}
          </p>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`¿Eliminar la carpeta «${deleteTarget ?? ''}»?`}
        description={
          deleteNotes > 0
            ? `Se moverán ${deleteNotes} ${
                deleteNotes === 1 ? 'nota y su audio' : 'notas y sus audios'
              } a Sin clasificar. También se eliminarán la carpeta y sus subcarpetas. Esta acción no se puede deshacer.`
            : 'La carpeta está vacía. Se eliminará junto con sus subcarpetas. Esta acción no se puede deshacer.'
        }
        confirmLabel="Eliminar carpeta"
        destructive
        onClose={() => {
          if (busy !== 'delete') setDeleteTarget(null)
        }}
        onConfirm={() => void submitDelete()}
      />
    </div>
  )
}
