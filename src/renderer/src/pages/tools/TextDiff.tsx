import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, Dropdown, Spin } from 'antd'
import {
  ColumnWidthOutlined,
  ColumnHeightOutlined,
  SwapOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { DiffEditor } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { diffLines, diffWordsWithSpace, diffChars } from 'diff'
import { useTheme } from '../../theme/ThemeProvider'
import '../../components/MonacoSetup'
import { PANEL_HEADER_CLS } from '../../components/ui'

type DiffLevel = 'word' | 'char'

const LEVELS: Array<{ key: DiffLevel; labelKey: string }> = [
  { key: 'word', labelKey: 'diffWordLevel' },
  { key: 'char', labelKey: 'diffCharLevel' }
]

const LANGUAGES = [
  { value: 'plaintext', key: 'diffLangPlain' },
  { value: 'javascript', key: 'diffLangJs' },
  { value: 'typescript', key: 'diffLangTs' },
  { value: 'json', key: 'diffLangJson' },
  { value: 'css', key: 'diffLangCss' },
  { value: 'html', key: 'diffLangHtml' },
  { value: 'markdown', key: 'diffLangMarkdown' },
  { value: 'yaml', key: 'diffLangYaml' },
  { value: 'xml', key: 'diffLangXml' },
  { value: 'python', key: 'diffLangPython' },
  { value: 'go', key: 'diffLangGo' },
  { value: 'rust', key: 'diffLangRust' },
  { value: 'sql', key: 'diffLangSql' },
  { value: 'shell', key: 'diffLangShell' }
]

const FILE_ACCEPT =
  '.txt,.md,.json,.js,.ts,.jsx,.tsx,.css,.html,.htm,.yaml,.yml,.xml,.py,.go,.rs,.sql,.sh,.log,.csv'

function TextDiff(): React.JSX.Element {
  const { t } = useTranslation()
  const { resolved: themeResolved } = useTheme()

  const [original, setOriginal] = useState('')
  const [modified, setModified] = useState('')
  const [language, setLanguage] = useState('plaintext')
  const [sideBySide, setSideBySide] = useState(true)
  const [level, setLevel] = useState<DiffLevel>('word')
  const [stats, setStats] = useState({ added: 0, removed: 0 })

  const diffRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const levelRef = useRef<DiffLevel>('word')
  const origDecosRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const modDecosRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const disposablesRef = useRef<Monaco.IDisposable[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const fileTargetRef = useRef<'original' | 'modified'>('original')

  const applyWordHighlights = useCallback(() => {
    const diffEditor = diffRef.current
    const monacoApi = monacoRef.current
    if (!diffEditor || !monacoApi) return
    const originalEditor = diffEditor.getOriginalEditor()
    const modifiedEditor = diffEditor.getModifiedEditor()
    const originalModel = originalEditor.getModel()
    const modifiedModel = modifiedEditor.getModel()
    if (!originalModel || !modifiedModel) return

    const lineChanges = diffEditor.getLineChanges() ?? []

    const originalDecorations: Monaco.editor.IModelDeltaDecoration[] = []
    const modifiedDecorations: Monaco.editor.IModelDeltaDecoration[] = []

    for (const change of lineChanges) {
      const oStart = change.originalStartLineNumber
      const oEnd = change.originalEndLineNumber
      const mStart = change.modifiedStartLineNumber
      const mEnd = change.modifiedEndLineNumber
      if (oEnd === 0 || mEnd === 0) continue

      const oCount = oEnd - oStart + 1
      const mCount = mEnd - mStart + 1
      const count = Math.min(oCount, mCount)

      for (let i = 0; i < count; i++) {
        const oLine = originalModel.getLineContent(oStart + i)
        const mLine = modifiedModel.getLineContent(mStart + i)
        if (oLine === mLine) continue

        const parts =
          levelRef.current === 'char' ? diffChars(oLine, mLine) : diffWordsWithSpace(oLine, mLine)
        let oCol = 0
        let mCol = 0
        for (const part of parts) {
          const len = part.value.length
          if (part.removed) {
            originalDecorations.push({
              range: new monacoApi.Range(oStart + i, oCol + 1, oStart + i, oCol + len + 1),
              options: { inlineClassName: 'diff-word-removed' }
            })
            oCol += len
          } else if (part.added) {
            modifiedDecorations.push({
              range: new monacoApi.Range(mStart + i, mCol + 1, mStart + i, mCol + len + 1),
              options: { inlineClassName: 'diff-word-added' }
            })
            mCol += len
          } else {
            oCol += len
            mCol += len
          }
        }
      }
    }

    if (origDecosRef.current) origDecosRef.current.set(originalDecorations)
    else origDecosRef.current = originalEditor.createDecorationsCollection(originalDecorations)
    if (modDecosRef.current) modDecosRef.current.set(modifiedDecorations)
    else modDecosRef.current = modifiedEditor.createDecorationsCollection(modifiedDecorations)
  }, [])

  const updateStats = useCallback(() => {
    const diffEditor = diffRef.current
    if (!diffEditor) return
    const om = diffEditor.getOriginalEditor().getModel()
    const mm = diffEditor.getModifiedEditor().getModel()
    if (!om || !mm) return
    const parts = diffLines(om.getValue(), mm.getValue())
    let added = 0
    let removed = 0
    for (const p of parts) {
      if (p.added) added += p.count ?? 0
      if (p.removed) removed += p.count ?? 0
    }
    setStats({ added, removed })
  }, [])

  const scheduleHighlights = useCallback(() => {
    window.setTimeout(() => {
      applyWordHighlights()
      updateStats()
    }, 0)
  }, [applyWordHighlights, updateStats])

  useEffect(() => {
    levelRef.current = level
    applyWordHighlights()
  }, [level, applyWordHighlights])

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d.dispose())
      disposablesRef.current = []
      origDecosRef.current?.clear()
      modDecosRef.current?.clear()
      origDecosRef.current = null
      modDecosRef.current = null
      diffRef.current = null
      monacoRef.current = null
    }
  }, [])

  const handleSwap = useCallback(() => {
    const diffEditor = diffRef.current
    if (diffEditor) {
      const om = diffEditor.getOriginalEditor().getModel()
      const mm = diffEditor.getModifiedEditor().getModel()
      if (om && mm) {
        const oText = om.getValue()
        const mText = mm.getValue()
        setOriginal(mText)
        setModified(oText)
        return
      }
    }
    setOriginal(modified)
    setModified(original)
  }, [original, modified])

  const handleClear = useCallback(() => {
    setOriginal('')
    setModified('')
    setStats({ added: 0, removed: 0 })
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = (reader.result as string) ?? ''
      if (fileTargetRef.current === 'original') setOriginal(text)
      else setModified(text)
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  const openFileFor = (target: 'original' | 'modified'): void => {
    fileTargetRef.current = target
    fileRef.current?.click()
  }

  const importMenu: MenuProps = {
    items: [
      {
        key: 'original',
        icon: <FileTextOutlined />,
        label: t('diffImportOriginal')
      },
      {
        key: 'modified',
        icon: <FileTextOutlined />,
        label: t('diffImportModified')
      }
    ],
    onClick: ({ key }) => openFileFor(key as 'original' | 'modified')
  }

  const toggleBtn = (active: boolean): string => `
    px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 cursor-pointer border-none flex items-center gap-1.5
    ${
      active
        ? 'bg-[var(--accent)] text-white'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'
    }`

  return (
    <div className="flex flex-col p-6 flex-1 min-h-0">
      <div className="sticky top-0 z-10 bg-[var(--content-bg)] pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map((l) => ({ value: l.value, label: t(l.key) }))}
            style={{ width: 150 }}
            size="middle"
            className="text-xs"
          />

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
            <button
              onClick={() => setSideBySide(true)}
              className={toggleBtn(sideBySide)}
              title={t('diffSideBySide')}
            >
              <ColumnWidthOutlined />
              {t('diffSideBySide')}
            </button>
            <button
              onClick={() => setSideBySide(false)}
              className={toggleBtn(!sideBySide)}
              title={t('diffInline')}
            >
              <ColumnHeightOutlined />
              {t('diffInline')}
            </button>
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setLevel(l.key)}
                className={toggleBtn(level === l.key)}
              >
                {t(l.labelKey)}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[var(--border-subtle)]" />

          <button
            onClick={handleSwap}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold
              flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
              bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
              hover:bg-[var(--border-subtle)]"
          >
            <SwapOutlined />
            {t('diffSwap')}
          </button>

          <Dropdown menu={importMenu} trigger={['click']}>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold
                flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
                bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
                hover:bg-[var(--border-subtle)]"
            >
              <FolderOpenOutlined />
              {t('diffImport')}
            </button>
          </Dropdown>

          <button
            onClick={handleClear}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold
              flex items-center gap-1.5 transition-all duration-150 cursor-pointer border-none
              bg-[var(--bg-warm)] text-[var(--text-primary)] border border-[var(--border-subtle)]
              hover:bg-[var(--border-subtle)]"
          >
            <DeleteOutlined />
            {t('diffClear')}
          </button>

          <span className="ml-auto text-xs text-[var(--text-secondary)] tabular-nums">
            <span className="text-[var(--success)]">+{stats.added}</span>
            <span className="mx-1.5 opacity-40">·</span>
            <span className="text-[var(--danger)]">−{stats.removed}</span>
          </span>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={FILE_ACCEPT}
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <span className={PANEL_HEADER_CLS}>{t('diffOriginal')}</span>
          <span className={PANEL_HEADER_CLS}>{t('diffModified')}</span>
        </div>
        <div className="flex-1 min-h-0 rounded-lg overflow-hidden border border-[var(--border-subtle)]">
          <DiffEditor
            height="100%"
            original={original}
            modified={modified}
            language={language}
            theme={themeResolved === 'dark' ? 'vs-dark' : 'light'}
            loading={<Spin />}
            options={{
              renderSideBySide: sideBySide,
              originalEditable: true,
              readOnly: false,
              fontSize: 13,
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderWhitespace: 'none',
              diffWordWrap: 'on'
            }}
            onMount={(editor, monacoApi) => {
              diffRef.current = editor
              monacoRef.current = monacoApi
              const originalEditor = editor.getOriginalEditor()
              const modifiedEditor = editor.getModifiedEditor()
              disposablesRef.current = [
                editor.onDidUpdateDiff(() => {
                  applyWordHighlights()
                  updateStats()
                }),
                originalEditor.onDidChangeModelContent(() => scheduleHighlights()),
                modifiedEditor.onDidChangeModelContent(() => scheduleHighlights())
              ]
              scheduleHighlights()
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default TextDiff
