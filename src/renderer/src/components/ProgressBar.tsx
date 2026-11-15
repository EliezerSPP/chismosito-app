export function ProgressBar({
  value,
  className,
  indeterminate
}: {
  value: number
  className?: string
  indeterminate?: boolean
}): React.JSX.Element {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-surface2 ${className ?? ''}`}>
      <div
        className={`h-full rounded-full bg-accent transition-[width] duration-300 ${
          indeterminate ? 'shimmer w-1/2' : ''
        }`}
        style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}
