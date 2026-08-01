import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Breadcrumb, Button, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { devTools } from '../data/devTools'
import RandomPassword from './tools/RandomPassword'
import ImageToBase64 from './tools/ImageToBase64'
import JsonBeautify from './tools/JsonBeautify'
import CodecConverter from './tools/CodecConverter'
import TimestampConverter from './tools/TimestampConverter'
import PdfImageAnnotate from './tools/PdfImageAnnotate'

interface ToolProps {
  breadcrumb?: React.ReactNode
}

const toolComponents: Record<string, React.ComponentType<ToolProps>> = {
  'random-password': RandomPassword,
  'image-to-base64': ImageToBase64,
  'json-beautify': JsonBeautify,
  'codec-converter': CodecConverter,
  'timestamp-converter': TimestampConverter,
  'pdf-image-annotate': PdfImageAnnotate
}

function DevToolDetail(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { toolId } = useParams<{ toolId: string }>()

  const tool = devTools.find((item) => item.id === toolId)

  if (!tool) {
    return (
      <div className="p-6">
        <Typography.Text type="danger">{t('toolNotFound')}</Typography.Text>
      </div>
    )
  }

  const ToolComponent = toolComponents[tool.id]

  const breadcrumb = (
    <div className="flex items-center gap-2 mb-3">
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/dev-tools')}>
        {t('back')}
      </Button>
      <Breadcrumb
        items={[
          { title: <a onClick={() => navigate('/dev-tools')}>{t('devTools')}</a> },
          { title: t(tool.nameKey) }
        ]}
      />
    </div>
  )

  return (
    <div>
      {ToolComponent ? (
        <ToolComponent breadcrumb={breadcrumb as React.ReactNode} />
      ) : (
        <Typography.Text type="secondary">{t('toolNotImplemented')}</Typography.Text>
      )}
    </div>
  )
}

export default DevToolDetail
