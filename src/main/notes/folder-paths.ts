export function normalizeFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) =>
      segment
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
        .replace(/^\.+|\.+$/g, '')
        .trim()
    )
    .filter(Boolean)
    .join('/')
}

export function normalizeFolderName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || /[\\/]/.test(trimmed)) return ''
  return normalizeFolder(trimmed)
}

export function folderParent(folder: string): string {
  const index = folder.lastIndexOf('/')
  return index >= 0 ? folder.slice(0, index) : ''
}

export function folderBase(folder: string): string {
  const index = folder.lastIndexOf('/')
  return index >= 0 ? folder.slice(index + 1) : folder
}

export function folderDepth(folder: string): number {
  return folder.split('/').filter(Boolean).length
}

export function isSameFolder(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function isFolderInside(folder: string, parent: string): boolean {
  if (!parent) return true
  const normalizedFolder = folder.trim().toLowerCase()
  const normalizedParent = parent.trim().toLowerCase()
  return (
    normalizedFolder === normalizedParent ||
    normalizedFolder.startsWith(`${normalizedParent}/`)
  )
}

export function joinFolder(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}
