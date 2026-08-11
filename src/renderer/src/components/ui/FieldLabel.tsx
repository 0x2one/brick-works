import type { ReactNode } from 'react'
import { LABEL_CLS, INPUT_LABEL_CLS } from './cls'

interface FieldLabelProps {
  children: ReactNode
  variant?: 'section' | 'input'
  className?: string
}

export function FieldLabel({
  children,
  variant = 'input',
  className
}: FieldLabelProps): React.JSX.Element {
  return (
    <label
      className={[variant === 'section' ? LABEL_CLS : INPUT_LABEL_CLS, className ?? ''].join(' ')}
    >
      {children}
    </label>
  )
}
