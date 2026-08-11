import { useTranslation } from 'react-i18next'

interface ResultsHeaderProps {
  count: number
  onCopyAll: () => void
}

export function ResultsHeader({ count, onCopyAll }: ResultsHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
        {t('count')} · {count}
      </span>
      <button
        type="button"
        onClick={onCopyAll}
        className="text-[11px] font-semibold uppercase tracking-widest text-[var(--accent)] hover:brightness-110
          transition-all duration-150 cursor-pointer border-none bg-transparent"
      >
        {t('copyAll')}
      </button>
    </div>
  )
}
