import type { ButtonHTMLAttributes, ReactNode } from 'react'

type BtnVariant = 'primary' | 'default' | 'ghost'
type BtnSize = 'sm' | 'md'

const VARIANT_CLS: Record<BtnVariant, string> = {
  primary:
    'bg-[var(--accent)] text-white hover:brightness-110 active:brightness-90 disabled:hover:brightness-100 disabled:active:brightness-100',
  default:
    'bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--border-subtle)] disabled:hover:bg-[var(--bg-warm)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)] disabled:hover:text-[var(--text-secondary)] disabled:hover:bg-transparent'
}

const SIZE_CLS: Record<BtnSize, string> = {
  sm: 'h-8 px-3 rounded-lg text-xs',
  md: 'h-10 px-4 rounded-lg text-sm'
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: BtnSize
  icon?: ReactNode
  block?: boolean
}

export function Btn({
  variant = 'default',
  size = 'sm',
  icon,
  block,
  className,
  children,
  ...rest
}: BtnProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center gap-1.5 font-semibold cursor-pointer transition-all duration-150',
        VARIANT_CLS[variant],
        SIZE_CLS[size],
        'disabled:opacity-40 disabled:cursor-not-allowed',
        block ? 'w-full' : '',
        className ?? ''
      ].join(' ')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
