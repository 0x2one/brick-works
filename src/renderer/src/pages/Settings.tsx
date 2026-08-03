import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch, Radio } from 'antd'
import type { RadioChangeEvent } from 'antd'
import {
  SettingOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  SunOutlined,
  MoonOutlined
} from '@ant-design/icons'
import i18n from '../i18n'
import { useTheme, type ThemeMode } from '../theme/ThemeProvider'

type SettingsSection = 'preferences' | 'appearance' | 'about'

const NAV_ITEMS: {
  key: SettingsSection
  labelKey: string
  icon: typeof SettingOutlined
}[] = [
  { key: 'preferences', labelKey: 'preferences', icon: SettingOutlined },
  { key: 'appearance', labelKey: 'appearance', icon: SunOutlined },
  { key: 'about', labelKey: 'about', icon: InfoCircleOutlined }
]

function LanguageRadio(): React.JSX.Element {
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const changeLang = (e: RadioChangeEvent): void => {
    void i18n.changeLanguage(e.target.value)
    localStorage.setItem('lang', e.target.value)
  }
  return (
    <Radio.Group
      value={currentLang}
      onChange={changeLang}
      optionType="button"
      buttonStyle="solid"
      className="settings-radio"
    >
      <Radio value="en">English</Radio>
      <Radio value="zh">中文</Radio>
    </Radio.Group>
  )
}

function ThemeRadio(): React.JSX.Element {
  const { t } = useTranslation()
  const { mode, setMode } = useTheme()

  const changeTheme = (e: RadioChangeEvent): void => {
    setMode(e.target.value as ThemeMode)
  }

  return (
    <Radio.Group
      value={mode}
      onChange={changeTheme}
      optionType="button"
      buttonStyle="solid"
      className="settings-radio"
    >
      <Radio value="system">
        <LaptopOutlined /> {t('themeSystem')}
      </Radio>
      <Radio value="light">
        <SunOutlined /> {t('themeLight')}
      </Radio>
      <Radio value="dark">
        <MoonOutlined /> {t('themeDark')}
      </Radio>
    </Radio.Group>
  )
}

function SettingsToggle(props: {
  labelKey: string
  descKey: string
  field: 'openAtLogin' | 'closeToTray'
}): React.JSX.Element {
  const { t } = useTranslation()
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void window.api.settings.get().then((settings) => {
      if (!alive) return
      setChecked(settings[props.field])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [props.field])

  const onChange = (value: boolean): void => {
    setChecked(value)
    const req =
      props.field === 'openAtLogin'
        ? window.api.settings.setOpenAtLogin(value)
        : window.api.settings.setCloseToTray(value)
    void req.then((settings) => {
      setChecked(settings[props.field])
    })
  }

  return (
    <div className="settings-row">
      <div className="settings-label-block">
        <span className="settings-label">{t(props.labelKey)}</span>
        <span className="settings-value">{t(props.descKey)}</span>
      </div>
      <Switch checked={checked} loading={loading} onChange={onChange} />
    </div>
  )
}

function PreferencesPanel(): React.JSX.Element {
  return (
    <div className="settings-panel-card">
      <SettingsToggle labelKey="openAtLogin" descKey="openAtLoginDesc" field="openAtLogin" />
      <SettingsToggle labelKey="closeToTray" descKey="closeToTrayDesc" field="closeToTray" />
    </div>
  )
}

function AppearancePanel(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="settings-panel-stack">
      <div className="settings-panel-card">
        <div className="settings-row settings-row-stack">
          <div className="settings-label-block">
            <span className="settings-label">{t('language')}</span>
            <span className="settings-value">{t('languageDesc')}</span>
          </div>
          <LanguageRadio />
        </div>
      </div>
      <div className="settings-panel-card">
        <div className="settings-row settings-row-stack">
          <div className="settings-label-block">
            <span className="settings-label">{t('theme')}</span>
            <span className="settings-value">{t('themeDesc')}</span>
          </div>
          <ThemeRadio />
        </div>
      </div>
    </div>
  )
}

function AboutPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.app.info().then((data) => {
      if (alive) setInfo(data)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="settings-panel-card settings-about">
      <div className="settings-about-brand">
        <span className="settings-about-mark">
          <InfoCircleOutlined />
        </span>
        <div>
          <div className="settings-label">BrickWorks · {t('appName')}</div>
          <div className="settings-value">{t('aboutTagline')}</div>
        </div>
      </div>
      <div className="settings-about-meta">
        <div className="settings-row">
          <span className="settings-label">{t('version')}</span>
          <span className="settings-value">{info?.version ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Electron</span>
          <span className="settings-value">{info?.electron ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Chrome</span>
          <span className="settings-value">{info?.chrome ?? '—'}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Node</span>
          <span className="settings-value">{info?.node ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}

const SECTION_DESC: Record<SettingsSection, string> = {
  preferences: 'preferencesDesc',
  appearance: 'appearanceDesc',
  about: 'settingsAboutDesc'
}

function Settings(): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>('preferences')
  const active = NAV_ITEMS.find((item) => item.key === section) ?? NAV_ITEMS[0]

  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label={t('settings')}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = section === item.key
          return (
            <button
              key={item.key}
              type="button"
              className={`settings-nav-item${isActive ? ' is-active' : ''}`}
              onClick={() => setSection(item.key)}
            >
              <Icon className="settings-nav-icon" />
              <span>{t(item.labelKey)}</span>
            </button>
          )
        })}
      </nav>
      <div className="settings-main">
        <header className="settings-main-head">
          <h3 className="settings-main-title">{t(active.labelKey)}</h3>
          <p className="settings-main-desc">{t(SECTION_DESC[section])}</p>
        </header>
        <div className="settings-main-body">
          {section === 'preferences' && <PreferencesPanel />}
          {section === 'appearance' && <AppearancePanel />}
          {section === 'about' && <AboutPanel />}
        </div>
      </div>
    </div>
  )
}

export default Settings
