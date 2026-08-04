import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch, Radio, App, Button, Tooltip, Input, Progress, Spin } from 'antd'
import type { RadioChangeEvent, InputRef } from 'antd'
import {
  SettingOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  SunOutlined,
  MoonOutlined,
  UndoOutlined,
  ThunderboltOutlined,
  EditOutlined,
  DownloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import i18n from '../i18n'
import { useTheme, type ThemeMode } from '../theme/ThemeProvider'

type SettingsSection = 'preferences' | 'shortcut' | 'appearance' | 'about'

const NAV_ITEMS: {
  key: SettingsSection
  labelKey: string
  icon: typeof SettingOutlined
}[] = [
  { key: 'preferences', labelKey: 'preferences', icon: SettingOutlined },
  { key: 'shortcut', labelKey: 'shortcutSection', icon: ThunderboltOutlined },
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
  field: 'openAtLogin' | 'closeToTray' | 'autoDownload'
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
        : props.field === 'closeToTray'
          ? window.api.settings.setCloseToTray(value)
          : window.api.settings.setAutoDownload(value)
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

const DEFAULT_SHORTCUT = 'Alt+Space'
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

const SHORTCUT_KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  CapsLock: 'Capslock',
  ',': ',',
  '.': '.',
  '/': '/',
  '\\': '\\',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '-': '-',
  '=': '=',
  '`': '`',
  '+': 'Plus'
}

function buildAccelerator(e: React.KeyboardEvent): string | null {
  const { key, ctrlKey, altKey, shiftKey, metaKey } = e
  const mods: string[] = []
  if (ctrlKey) mods.push('Ctrl')
  if (altKey) mods.push('Alt')
  if (shiftKey) mods.push('Shift')
  if (metaKey) mods.push(IS_MAC ? 'Command' : 'Super')
  let main = SHORTCUT_KEY_MAP[key]
  if (!main) {
    if (/^F\d{1,2}$/.test(key)) main = key
    else if (/^[a-zA-Z0-9]$/.test(key)) main = key.toUpperCase()
  }
  if (!main) return null
  const isFunction = /^F\d{1,2}$/.test(main)
  if (mods.length === 0 && !isFunction) return null
  if (isFunction && mods.length === 0) return main
  return [...mods, main].join('+')
}

function ShortcutSetting(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [value, setValue] = useState(DEFAULT_SHORTCUT)
  const [recording, setRecording] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const captureRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<InputRef>(null)
  const editCancelledRef = useRef(false)

  useEffect(() => {
    let alive = true
    void window.api.settings.get().then((settings) => {
      if (!alive) return
      setEnabled(Boolean(settings.showShortcut))
      if (settings.showShortcut) setValue(settings.showShortcut)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const apply = (accel: string): void => {
    void window.api.settings.setShowShortcut(accel).then((res) => {
      if (!res.ok) {
        message.error(res.error === 'CONFLICT' ? t('shortcutConflict') : t('shortcutInvalid'))
        return
      }
      if (res.shortcut) {
        setValue(res.shortcut)
        setEnabled(true)
      } else {
        setEnabled(false)
      }
      message.success(t('shortcutSaved'))
    })
  }

  const toggle = (checked: boolean): void => {
    if (checked) {
      apply(value || DEFAULT_SHORTCUT)
    } else {
      apply('')
    }
  }

  const reset = (): void => {
    void window.api.settings.resetShowShortcut().then((res) => {
      if (!res.ok) {
        message.error(res.error === 'CONFLICT' ? t('shortcutConflict') : t('shortcutInvalid'))
        return
      }
      setValue(res.shortcut || DEFAULT_SHORTCUT)
      setEnabled(Boolean(res.shortcut))
      message.success(t('shortcutSaved'))
    })
  }

  const startRecording = (): void => {
    setRecording(true)
    requestAnimationFrame(() => captureRef.current?.focus())
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(false)
      return
    }
    const accel = buildAccelerator(e)
    if (accel) {
      setRecording(false)
      apply(accel)
    }
  }

  const startEditing = (): void => {
    editCancelledRef.current = false
    setEditing(true)
    setDraft(value)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const commitEdit = (raw: string): void => {
    setEditing(false)
    if (editCancelledRef.current) {
      editCancelledRef.current = false
      return
    }
    const accel = raw.trim()
    if (!accel) return
    apply(accel)
  }

  const cancelEdit = (): void => {
    editCancelledRef.current = true
    setEditing(false)
  }

  return (
    <div className="settings-row settings-row-stack">
      <div className="shortcut-head">
        <div className="settings-label-block">
          <span className="settings-label">{t('showWindowShortcut')}</span>
          <span className="settings-value">{t('showWindowShortcutDesc')}</span>
        </div>
        <Switch checked={enabled} loading={loading} onChange={toggle} />
      </div>
      {enabled && (
        <div className="shortcut-row">
          {editing ? (
            <Input
              ref={inputRef}
              className="shortcut-input"
              size="small"
              value={draft}
              placeholder={t('shortcutEditPlaceholder')}
              onChange={(e) => setDraft(e.target.value)}
              onPressEnter={() => commitEdit(draft)}
              onBlur={() => commitEdit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          ) : (
            <div
              ref={captureRef}
              tabIndex={0}
              className={`shortcut-capture${recording ? ' is-recording' : ''}`}
              onClick={startRecording}
              onKeyDown={handleKeyDown}
              onBlur={() => setRecording(false)}
            >
              {recording ? (
                <span className="shortcut-capture-hint">{t('shortcutRecording')}</span>
              ) : (
                <span className="shortcut-key">
                  <ThunderboltOutlined />
                  <kbd>{value || t('shortcutNone')}</kbd>
                </span>
              )}
            </div>
          )}
          {!editing && (
            <>
              <Tooltip title={t('shortcutEdit')}>
                <Button size="small" icon={<EditOutlined />} onClick={startEditing} />
              </Tooltip>
              <Tooltip title={t('shortcutReset')}>
                <Button size="small" icon={<UndoOutlined />} onClick={reset} />
              </Tooltip>
            </>
          )}
        </div>
      )}
      <span className="shortcut-hint">{t('shortcutHint')}</span>
    </div>
  )
}

function PreferencesPanel(): React.JSX.Element {
  return (
    <div className="settings-panel-card">
      <SettingsToggle labelKey="openAtLogin" descKey="openAtLoginDesc" field="openAtLogin" />
      <SettingsToggle labelKey="closeToTray" descKey="closeToTrayDesc" field="closeToTray" />
      <SettingsToggle
        labelKey="updaterAutoDownload"
        descKey="updaterAutoDownloadDesc"
        field="autoDownload"
      />
    </div>
  )
}

function ShortcutPanel(): React.JSX.Element {
  return (
    <div className="settings-panel-card">
      <ShortcutSetting />
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function UpdateSection(): React.JSX.Element {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.updater.getStatus().then((s) => {
      if (alive) setStatus(s)
    })
    const unsub = window.api.updater.onStatus((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
      unsub()
    }
  }, [])

  const handleCheck = (): void => {
    setBusy(true)
    void window.api.updater
      .check()
      .then((s) => {
        setStatus(s)
        if (s.state === 'error') message.error(s.error || t('updaterError'))
      })
      .finally(() => setBusy(false))
  }

  const handleDownload = (): void => {
    void window.api.updater.download().then(setStatus)
  }

  const handleInstall = (): void => {
    void window.api.updater.install()
  }

  const state = status?.state ?? 'idle'

  return (
    <div className="settings-panel-card">
      <div className="settings-row settings-row-stack">
        <div className="settings-label-block">
          <span className="settings-label">{t('updaterTitle')}</span>
          <span className="settings-value">{t('updaterDesc')}</span>
        </div>
        {state === 'idle' && (
          <Button type="primary" icon={<SearchOutlined />} loading={busy} onClick={handleCheck}>
            {t('updaterCheck')}
          </Button>
        )}
        {state === 'checking' && (
          <div className="settings-value">
            <Spin size="small" /> {t('updaterChecking')}
          </div>
        )}
        {state === 'available' && (
          <div className="settings-row-stack">
            <div className="settings-value">
              {t('updaterAvailable', { version: status?.version ?? '' })}
            </div>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload}>
              {t('updaterDownload')}
            </Button>
          </div>
        )}
        {state === 'downloading' && (
          <div className="settings-row-stack">
            <div className="settings-value">
              {t('updaterDownloading')}
              {status?.version ? ` v${status.version}` : ''}
            </div>
            <Progress
              percent={Math.round(status?.progress?.percent ?? 0)}
              size="small"
              status="active"
            />
            <div className="settings-value">
              {t('updaterProgress', {
                percent: (status?.progress?.percent ?? 0).toFixed(0)
              })}
              {' · '}
              {t('updaterSpeed', {
                speed: formatBytes(status?.progress?.bytesPerSecond ?? 0)
              })}
            </div>
          </div>
        )}
        {state === 'downloaded' && (
          <div className="settings-row-stack">
            <div className="settings-value">
              {t('updaterDownloaded', { version: status?.version ?? '' })}
            </div>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleInstall}>
              {t('updaterInstall')}
            </Button>
          </div>
        )}
        {state === 'not-available' && (
          <div className="settings-value">{t('updaterNotAvailable')}</div>
        )}
        {state === 'error' && (
          <div className="settings-value">
            {t('updaterError')}
            <Button size="small" icon={<SearchOutlined />} loading={busy} onClick={handleCheck}>
              {t('updaterRetry')}
            </Button>
          </div>
        )}
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
    <div className="settings-panel-stack">
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
        </div>
      </div>
      <UpdateSection />
    </div>
  )
}

const SECTION_DESC: Record<SettingsSection, string> = {
  preferences: 'preferencesDesc',
  shortcut: 'shortcutDesc',
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
          {section === 'shortcut' && <ShortcutPanel />}
          {section === 'appearance' && <AppearancePanel />}
          {section === 'about' && <AboutPanel />}
        </div>
      </div>
    </div>
  )
}

export default Settings
