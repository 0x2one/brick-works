import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Breadcrumb, Button, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { devTools } from '../data/devTools'
import RandomPassword from './tools/RandomPassword'

const toolComponents: Record<string, React.ComponentType> = {
  'random-password': RandomPassword,
}

function DevToolDetail(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { toolId } = useParams<{ toolId: string }>()

  const tool = devTools.find(item => item.id === toolId)

  if (!tool) {
    return (
      <div>
        <Typography.Text type="danger">{t('toolNotFound')}</Typography.Text>
      </div>
    )
  }

  const ToolComponent = toolComponents[tool.id]

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/dev-tools')}
        >
          {t('back')}
        </Button>
        <Breadcrumb
          items={[
            { title: <a onClick={() => navigate('/dev-tools')}>{t('devTools')}</a> },
            { title: t(tool.nameKey) },
          ]}
        />
      </div>

      {ToolComponent ? <ToolComponent /> : (
        <Typography.Text type="secondary">{t('toolNotImplemented')}</Typography.Text>
      )}
    </div>
  )
}

export default DevToolDetail
