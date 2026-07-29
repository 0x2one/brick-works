import { useEffect, useState } from 'react'
import { MinusOutlined, CompressOutlined, BorderOutlined, CloseOutlined } from '@ant-design/icons'

function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.windowControls.isMaximized().then(setMaximized)
    const cleanup = window.api.windowControls.onMaximizeChange(setMaximized)
    return cleanup
  }, [])

  return (
    <div className="title-bar">
      <div className="title-bar-drag" />
      <div className="title-bar-controls">
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
    </div>
  )
}

export default TitleBar
