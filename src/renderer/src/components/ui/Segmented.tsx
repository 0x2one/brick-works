import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label?: ReactNode
  icon?: ReactNode
  title?: string
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  stretch?: boolean
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  stretch,
  className
}: SegmentedProps<T>): React.JSX.Element {
  const base =
    'inline-flex items-center gap-0.5 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg'
  return (
    <div className={[base, stretch ? 'w-full' : '', className ?? ''].join(' ')}>
      {options.map((opt) => {
        const iconOnly = !opt.label && !!opt.icon
        const pad = iconOnly ? 'p-1.5' : size === 'md' ? 'px-4 py-1.5' : 'px-3 py-1.5'
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={[
              'inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none leading-none',
              stretch ? 'flex-1 justify-center' : '',
              pad,
              value === opt.value
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]'
            ].join(' ')}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
