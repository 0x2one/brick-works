import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Typography } from 'antd'
import { AppstoreOutlined } from '@ant-design/icons'
import { devTools } from '../data/devTools'
import RandomPassword from './tools/RandomPassword'
import ImageToBase64 from './tools/ImageToBase64'
import JsonBeautify from './tools/JsonBeautify'
import CodecConverter from './tools/CodecConverter'
import TimestampConverter from './tools/TimestampConverter'
import UuidGenerator from './tools/UuidGenerator'
import QrCodeTool from './tools/QrCodeTool'
import SvgToImage from './tools/SvgToImage'
import PdfImageAnnotate from './tools/PdfImageAnnotate'
import PdfPreview from './tools/PdfPreview'
import PdfMergeSplit from './tools/PdfMergeSplit'
import TextDiff from './tools/TextDiff'
import ColorConverter from './tools/ColorConverter'
import RegexTester from './tools/RegexTester'

const toolComponents: Record<string, React.ComponentType> = {
  'random-password': RandomPassword,
  'image-to-base64': ImageToBase64,
  'json-beautify': JsonBeautify,
  'codec-converter': CodecConverter,
  'timestamp-converter': TimestampConverter,
  'uuid-generator': UuidGenerator,
  'qr-code': QrCodeTool,
  'svg-to-image': SvgToImage,
  'pdf-image-annotate': PdfImageAnnotate,
  'pdf-preview': PdfPreview,
  'pdf-merge-split': PdfMergeSplit,
  'text-diff': TextDiff,
  'color-converter': ColorConverter,
  'regex-tester': RegexTester
}

function DevToolDetail({ toolId }: { toolId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const tool = devTools.find((item) => item.id === toolId)

  if (!tool) {
    return (
      <div className="p-6">
        <Typography.Text type="danger">{t('toolNotFound')}</Typography.Text>
      </div>
    )
  }

  const ToolComponent = toolComponents[tool.id]

  return (
    <div className={tool.fill ? 'flex flex-col flex-1 min-h-0' : 'flex flex-col min-h-0'}>
      <nav className="shrink-0 px-6 pt-5 flex items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => navigate('/dev-tools')}
          className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer
            text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors duration-150"
        >
          <AppstoreOutlined />
          <span>{t('allTools')}</span>
        </button>
        <span className="text-[var(--text-secondary)] opacity-50 select-none">/</span>
        <span className="text-[var(--text-primary)] font-medium truncate">{t(tool.nameKey)}</span>
      </nav>
      {ToolComponent ? (
        <ToolComponent />
      ) : (
        <Typography.Text type="secondary">{t('toolNotImplemented')}</Typography.Text>
      )}
    </div>
  )
}

export default DevToolDetail
