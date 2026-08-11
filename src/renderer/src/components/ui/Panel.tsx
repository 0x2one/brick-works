import type { ReactNode } from 'react'
import { PANEL_HEADER_CLS } from './cls'

interface PanelProps {
  title?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}

export function Panel({ title, actions, className, children }: PanelProps): React.JSX.Element {
  return (
    <section
      className={[
        'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]',
        className ?? ''
      ].join(' ')}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 p-4 pb-0">
          {title && <div className={PANEL_HEADER_CLS}>{title}</div>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}
