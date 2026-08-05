import { useTranslation } from 'react-i18next'
import { Typography } from 'antd'
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
import PdfMergeSplit from './tools/PdfMergeSplit'

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
  'pdf-merge-split': PdfMergeSplit
}

function DevToolDetail({ toolId }: { toolId: string }): React.JSX.Element {
  const { t } = useTranslation()

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
    <div>
      {ToolComponent ? (
        <ToolComponent />
      ) : (
        <Typography.Text type="secondary">{t('toolNotImplemented')}</Typography.Text>
      )}
    </div>
  )
}

export default DevToolDetail
