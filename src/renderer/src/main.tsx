import './assets/main.css'
import './i18n'

import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import i18n from './i18n'
import App from './App'

const locales: Record<string, typeof enUS> = { en: enUS, zh: zhCN }

function Root(): React.JSX.Element {
  const [locale, setLocale] = useState(locales[i18n.language] ?? enUS)

  useEffect(() => {
    const onLanguageChanged = (lng: string): void => {
      setLocale(locales[lng] ?? enUS)
    }
    i18n.on('languageChanged', onLanguageChanged)
    return () => {
      i18n.off('languageChanged', onLanguageChanged)
    }
  }, [])

  return (
    <StrictMode>
      <ConfigProvider locale={locale}>
        <App />
      </ConfigProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
