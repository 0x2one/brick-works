import { useTranslation, Trans } from 'react-i18next'
import Versions from './components/Versions'
import logo from './assets/logo.svg'

function App(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  const toggleLang = (): void => {
    const next = i18n.language === 'en' ? 'zh' : 'en'
    i18n.changeLanguage(next)
    localStorage.setItem('lang', next)
  }

  return (
    <>
      <img alt="logo" className="logo" src={logo} />
      <div className="creator">{t('poweredBy')}</div>
      <div className="text">
        <Trans
          i18nKey="title"
          components={{ react: <span className="react" />, ts: <span className="ts" /> }}
        />
      </div>
      <p className="tip">
        <Trans i18nKey="tip" components={{ code: <code /> }} />
      </p>
      <div className="actions">
        <div className="action">
          <a href="https://electron-vite.org/" target="_blank" rel="noreferrer">
            {t('documentation')}
          </a>
        </div>
        <div className="action">
          <a target="_blank" rel="noreferrer" onClick={ipcHandle}>
            {t('sendIpc')}
          </a>
        </div>
        <div className="action">
          <a onClick={toggleLang}>{t('switchLang')}</a>
        </div>
      </div>
      <Versions></Versions>
    </>
  )
}

export default App
