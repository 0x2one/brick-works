import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch, Radio } from 'antd'
import type { RadioChangeEvent } from 'antd'
import {
  SettingOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  SunOutlined,
  MoonOutlined
} from '@ant-design/icons'
import i18n from '../i18n'
import { useTheme, type ThemeMode } from '../theme/ThemeProvider'

function LanguageRadio(): React.JSX.Element {
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const changeLang = (e: RadioChangeEvent): void => {
    i18n.changeLanguage(e.target.value)
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
    <div style={{ padding: '8px 16px' }}>
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
    </div>
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

function Settings(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="settings-page">
      <div className="settings-groups">
        <section className="settings-group" style={{ animationDelay: '0ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon">
              <SettingOutlined />
            </span>
            <h3 className="settings-group-title">{t('preferences')}</h3>
          </div>
          <div className="settings-group-body">
            <div className="settings-row">
              <span className="settings-label">{t('autoSave')}</span>
              <Switch defaultChecked />
            </div>
            <SettingsToggle
              labelKey="openAtLogin"
              descKey="openAtLoginDesc"
              field="openAtLogin"
            />
            <SettingsToggle
              labelKey="closeToTray"
              descKey="closeToTrayDesc"
              field="closeToTray"
            />
          </div>
        </section>

        <section className="settings-group" style={{ animationDelay: '80ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon">
              <GlobalOutlined />
            </span>
            <h3 className="settings-group-title">{t('language')}</h3>
          </div>
          <div className="settings-group-body">
            <LanguageRadio />
          </div>
        </section>

        <section className="settings-group" style={{ animationDelay: '160ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon">
              <SunOutlined />
            </span>
            <h3 className="settings-group-title">{t('theme')}</h3>
          </div>
          <div className="settings-group-body">
            <ThemeRadio />
          </div>
        </section>

        <section className="settings-group" style={{ animationDelay: '240ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon">
              <InfoCircleOutlined />
            </span>
            <h3 className="settings-group-title">About</h3>
          </div>
          <div className="settings-group-body">
            <div className="settings-row">
              <span className="settings-label">BrickWorks</span>
              <span className="settings-value">v1.0.0</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default Settings
