export function EmptyState({
  title,
  description,
  action
}: {
  title: string
  description: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-line px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface2 text-2xl">
        ✳
      </div>
      <h3 className="font-serif text-xl">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action}
    </div>
  )
}
