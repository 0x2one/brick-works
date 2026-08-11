import { CheckOutlined, SnippetsOutlined } from '@ant-design/icons'

interface ResultListProps {
  items: string[]
  copiedIdx: number | null
  onCopy: (value: string, idx: number) => void
  className?: string
}

export function ResultList({
  items,
  copiedIdx,
  onCopy,
  className
}: ResultListProps): React.JSX.Element {
  return (
    <div
      className={[
        'border border-[var(--border-subtle)] rounded-lg overflow-hidden bg-[var(--surface)]',
        className ?? ''
      ].join(' ')}
    >
      {items.map((value, idx) => (
        <div
          key={idx}
          role="button"
          tabIndex={0}
          onClick={() => onCopy(value, idx)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onCopy(value, idx)
            }
          }}
          className={[
            'flex items-center gap-3 px-4 py-2.5 group cursor-pointer transition-colors duration-100',
            idx % 2 === 1 ? 'bg-[var(--row-alt)]' : '',
            'hover:bg-[var(--hover-bg)]'
          ].join(' ')}
        >
          <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums w-5 shrink-0 text-right leading-none opacity-50">
            {idx + 1}
          </span>
          <span className="flex-1 font-mono text-[15px] leading-snug text-[var(--text-primary)] break-all min-w-0 select-all pointer-events-none">
            {value}
          </span>
          <span className="shrink-0 flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] opacity-30 group-hover:opacity-100 transition-all duration-150">
            {copiedIdx === idx ? (
              <CheckOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />
            ) : (
              <SnippetsOutlined style={{ fontSize: 13 }} />
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
