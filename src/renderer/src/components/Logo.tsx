import { cn } from '../lib/cn'

export function Logo({ size = 40, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <div
      className={cn('relative flex items-center justify-center rounded-[28%] bg-accent', className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div className="flex items-end gap-[3px]">
        {[0.42, 0.66, 0.5].map((height, index) => (
          <span
            key={index}
            className="w-[3px] rounded-full bg-white"
            style={{ height: size * height * 0.55 }}
          />
        ))}
      </div>
    </div>
  )
}
