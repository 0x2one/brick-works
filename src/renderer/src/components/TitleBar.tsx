import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { MinusOutlined, CompressOutlined, BorderOutlined, CloseOutlined, SettingOutlined } from '@ant-design/icons'
import Settings from '../pages/Settings'

function TitleBar(): React.JSX.Element {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.api.windowControls.isMaximized().then(setMaximized)
    const cleanup = window.api.windowControls.onMaximizeChange(setMaximized)
    return cleanup
  }, [])

  return (
    <div className="title-bar">
      <div className="title-bar-drag" />
      <div className="title-bar-controls">
        <button className="title-bar-btn" onClick={() => setSettingsOpen(true)} title={t('settings')}>
          <SettingOutlined />
        </button>
        <button className="title-bar-btn" onClick={() => window.api.windowControls.minimize()} title="Minimize">
          <MinusOutlined />
        </button>
        <button className="title-bar-btn" onClick={() => window.api.windowControls.maximize()} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <CompressOutlined /> : <BorderOutlined />}
        </button>
        <button className="title-bar-btn title-bar-close" onClick={() => window.api.windowControls.close()} title="Close">
          <CloseOutlined />
        </button>
      </div>
      <Modal
        title={t('settings')}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={480}
      >
        <Settings />
      </Modal>
    </div>
  )
}

export default TitleBar
