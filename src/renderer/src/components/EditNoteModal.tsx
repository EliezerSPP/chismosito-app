import { useEffect, useState } from 'react'
import type { NoteDetail } from '@shared/types'
import { Modal } from './Modal'
import { errorMessage } from '../lib/errors'
import { useAppStore } from '../store'

export function EditNoteModal({
  open,
  note,
  folders,
  onClose,
  onSaved
}: {
  open: boolean
  note: NoteDetail
  folders: string[]
  onClose: () => void
  onSaved: (note: NoteDetail) => void
}): React.JSX.Element {
  const pushToast = useAppStore((state) => state.pushToast)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const [title, setTitle] = useState(note.title)
  const [tags, setTags] = useState(note.tags.join(', '))
  const [folder, setFolder] = useState(note.folder || '__root__')
  const [newFolder, setNewFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(note.title)
    setTags(note.tags.join(', '))
    setFolder(note.folder || '__root__')
    setNewFolder('')
    setError(null)
  }, [open, note])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const targetFolder = newFolder.trim()
        ? newFolder.trim()
        : folder === '__root__'
          ? ''
          : folder
      const updated = await window.chismosito.notes.update({
        path: note.path,
        title: title.trim() || note.title,
        tags: tags
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
        folder: targetFolder
      })
      await refreshNotes()
      onSaved(updated)
      onClose()
    } catch (saveError) {
      const message = errorMessage(saveError)
      setError(message)
      pushToast('error', message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar nota"
      description="Cambia el título, las etiquetas o mueve la nota (y su audio) a una carpeta."
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="note-title">
            Título
          </label>
          <input
            id="note-title"
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
          />
        </div>
        <div>
          <label className="label" htmlFor="note-tags">
            Etiquetas
          </label>
          <input
            id="note-tags"
            className="field"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="producto, q4, planning"
          />
          <p className="mt-1 text-[11px] text-muted">Sepáralas con comas.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="note-folder">
              Carpeta
            </label>
            <select
              id="note-folder"
              className="field"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            >
              <option value="__root__">Sin clasificar</option>
              {folders.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="note-new-folder">
              O crea una carpeta
            </label>
            <input
              id="note-new-folder"
              className="field"
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
              placeholder="Nombre de la carpeta"
            />
          </div>
        </div>
        <p className="rounded-xl bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          Al mover la nota también se mueve su archivo de audio. El nombre del archivo no cambia.
        </p>
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
