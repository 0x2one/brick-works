import { useTranslation } from 'react-i18next'
import { Typography } from 'antd'

function About(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div>
      <Typography.Title level={2}>{t('aboutTitle')}</Typography.Title>
      <Typography.Paragraph>{t('aboutDesc')}</Typography.Paragraph>
    </div>
  )
}

export default About
