import { useTranslation } from 'react-i18next'
import { Typography } from 'antd'

function Home(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div>
      <Typography.Title level={2}>{t('homeTitle')}</Typography.Title>
      <Typography.Paragraph>{t('homeDesc')}</Typography.Paragraph>
    </div>
  )
}

export default Home
