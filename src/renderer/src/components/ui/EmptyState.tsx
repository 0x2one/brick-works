import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title?: ReactNode
  hint?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, hint, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={[
        'border-2 border-dashed border-[var(--border-subtle)] rounded-lg py-10 text-center',
        'flex flex-col items-center justify-center gap-2',
        'brick-grid--faint',
        className ?? ''
      ].join(' ')}
    >
      {icon && (
        <span className="text-2xl leading-none text-[var(--text-secondary)] opacity-40">
          {icon}
        </span>
      )}
      {title && <p className="m-0 text-sm text-[var(--text-secondary)]">{title}</p>}
      {hint && <p className="m-0 text-sm text-[var(--text-secondary)] opacity-50 italic">{hint}</p>}
    </div>
  )
}
