import { CheckOutlined, SnippetsOutlined } from '@ant-design/icons'

interface CopyButtonProps {
  copied: boolean
  onCopy: () => void
  title?: string
}

export function CopyButton({ copied, onCopy, title }: CopyButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onCopy}
      title={title}
      aria-label={title}
      className="shrink-0 flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)]
        hover:text-[var(--text-primary)] hover:bg-[var(--border-subtle)]
        transition-all duration-150 cursor-pointer border-none bg-transparent"
    >
      {copied ? (
        <CheckOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />
      ) : (
        <SnippetsOutlined style={{ fontSize: 13 }} />
      )}
    </button>
  )
}
