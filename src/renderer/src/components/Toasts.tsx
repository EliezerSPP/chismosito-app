import { useEffect } from 'react'
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react'
import { useAppStore, type ToastItem } from '../store'
import { cn } from '../lib/cn'

export function Toasts(): React.JSX.Element {
  const toasts = useAppStore((state) => state.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: ToastItem }): React.JSX.Element {
  const dismiss = useAppStore((state) => state.dismissToast)
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 7000)
    return () => window.clearTimeout(timer)
  }, [toast.id, dismiss])

  const Icon = toast.level === 'success' ? Check : toast.level === 'error' ? AlertTriangle : Sparkles

  return (
    <div
      className={cn(
        'pointer-events-auto fade-up flex items-start gap-3 rounded-2xl border bg-surface p-4 shadow-xl',
        toast.level === 'error' ? 'border-red-200 dark:border-red-900/60' : 'border-line'
      )}
      role="status"
    >
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
          toast.level === 'success' && 'bg-[color-mix(in_srgb,var(--olive)_18%,transparent)] text-olive',
          toast.level === 'error' && 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300',
          toast.level === 'info' && 'bg-accent-soft text-accent'
        )}
      >
        <Icon className="size-4" />
      </div>
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink">{toast.message}</p>
      <button
        onClick={() => dismiss(toast.id)}
        className="rounded-full p-1 text-muted transition-colors hover:bg-surface2 hover:text-ink"
        aria-label="Cerrar notificación"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
