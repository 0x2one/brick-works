import { useTranslation } from 'react-i18next'
import { Switch, Radio } from 'antd'
import type { RadioChangeEvent } from 'antd'
import { SettingOutlined, GlobalOutlined, InfoCircleOutlined } from '@ant-design/icons'
import i18n from '../i18n'

function LanguageRadio(): React.JSX.Element {
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const changeLang = (e: RadioChangeEvent): void => {
    i18n.changeLanguage(e.target.value)
    localStorage.setItem('lang', e.target.value)
  }
  return (
    <Radio.Group value={currentLang} onChange={changeLang} optionType="button" buttonStyle="solid" className="settings-radio">
      <Radio value="en">English</Radio>
      <Radio value="zh">中文</Radio>
    </Radio.Group>
  )
}

function Settings(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="settings-page">
      <div className="settings-groups">
        <section className="settings-group" style={{ animationDelay: '0ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon"><SettingOutlined /></span>
            <h3 className="settings-group-title">{t('preferences')}</h3>
          </div>
          <div className="settings-group-body">
            <div className="settings-row">
              <span className="settings-label">{t('autoSave')}</span>
              <Switch defaultChecked />
            </div>
          </div>
        </section>

        <section className="settings-group" style={{ animationDelay: '80ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon"><GlobalOutlined /></span>
            <h3 className="settings-group-title">{t('language')}</h3>
          </div>
          <div className="settings-group-body">
            <LanguageRadio />
          </div>
        </section>

        <section className="settings-group" style={{ animationDelay: '160ms' }}>
          <div className="settings-group-head">
            <span className="settings-group-icon"><InfoCircleOutlined /></span>
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
