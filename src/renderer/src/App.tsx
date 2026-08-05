import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import { useTranslation } from 'react-i18next'
import {
  ToolOutlined,
  PushpinOutlined,
  BuildOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ThunderboltOutlined,
  DeploymentUnitOutlined,
  CloudServerOutlined,
  CodeOutlined
} from '@ant-design/icons'
import TitleBar from './components/TitleBar'
import DevToolsArea from './pages/DevToolsArea'
import About from './pages/About'
import MemoSticky from './pages/MemoSticky'
import LanTransfer from './pages/LanTransfer'
import SshTunnel from './pages/SshTunnel'
import SshClient from './pages/SshClient'
import K8sManage from './pages/K8sManage'

const { Sider, Content } = Layout

type FadeStage = 'idle' | 'exit' | 'enter'

const NAV_ROUTE_KEYS = [
  '/memo-sticky',
  '/lan-transfer',
  '/ssh-tunnel',
  '/ssh-client',
  '/k8s',
  '/dev-tools'
] as const

function AppLayout(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('sidebar-collapsed')
    return stored === null ? true : stored === '1'
  })
  const [navShortcut, setNavShortcut] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()
  const [displayLocation, setDisplayLocation] = useState(location)
  const [fadeStage, setFadeStage] = useState<FadeStage>('idle')
  const [sshClientMounted, setSshClientMounted] = useState(
    () => location.pathname === '/ssh-client'
  )
  const [k8sMounted, setK8sMounted] = useState(() => location.pathname === '/k8s')
  const [devToolsMounted, setDevToolsMounted] = useState(() =>
    location.pathname.startsWith('/dev-tools')
  )
  const showSshClient = displayLocation.pathname === '/ssh-client'
  const showK8s = displayLocation.pathname === '/k8s'
  const showDevTools = displayLocation.pathname.startsWith('/dev-tools')

  useEffect(() => {
    window.api.lan.setLang(i18n.language === 'en' ? 'en' : 'zh')
  }, [i18n.language])

  useEffect(() => {
    let alive = true
    void window.api.settings.get().then((settings) => {
      if (alive) setNavShortcut(settings.navShortcut)
    })
    const onToggle = (e: Event): void => {
      setNavShortcut(Boolean((e as CustomEvent<boolean>).detail))
    }
    window.addEventListener('nav-shortcut-toggle', onToggle)
    return () => {
      alive = false
      window.removeEventListener('nav-shortcut-toggle', onToggle)
    }
  }, [])

  useEffect(() => {
    if (!navShortcut) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return
      const index = Number(e.key)
      if (!Number.isInteger(index) || index < 1 || index > NAV_ROUTE_KEYS.length) return
      // Don't hijack navigation while typing in form fields.
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const route = NAV_ROUTE_KEYS[index - 1]
      e.preventDefault()
      if (route !== location.pathname) navigate(route)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navShortcut, location.pathname, navigate])

  useEffect(() => {
    if (location.pathname === '/ssh-client') setSshClientMounted(true)
    if (location.pathname === '/k8s') setK8sMounted(true)
    if (location.pathname.startsWith('/dev-tools')) setDevToolsMounted(true)
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname === displayLocation.pathname || fadeStage === 'exit') return
    // Skip animation for the initial `/` → default route redirect
    if (displayLocation.pathname === '/') {
      setDisplayLocation(location)
      return
    }
    // Skip animation for navigation within the dev-tools section (tab switching)
    const internalDevTools =
      location.pathname.startsWith('/dev-tools') &&
      displayLocation.pathname.startsWith('/dev-tools')
    if (internalDevTools || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayLocation(location)
      setFadeStage('idle')
      return
    }
    setFadeStage('exit')
  }, [location, displayLocation.pathname, fadeStage])

  const menuItems = [
    {
      key: '/memo-sticky',
      icon: <PushpinOutlined />,
      label: t('memoSticky')
    },
    {
      key: '/lan-transfer',
      icon: <ThunderboltOutlined />,
      label: t('lanTransfer')
    },
    {
      key: '/ssh-tunnel',
      icon: <DeploymentUnitOutlined />,
      label: t('sshTunnel')
    },
    {
      key: '/ssh-client',
      icon: <CodeOutlined />,
      label: t('sshClient')
    },
    {
      key: '/k8s',
      icon: <CloudServerOutlined />,
      label: t('k8sManage')
    },
    {
      key: '/dev-tools',
      icon: <ToolOutlined />,
      label: t('devTools')
    }
  ]

  return (
    <Layout className="h-screen">
      <Sider
        collapsible
        collapsed={collapsed}
        collapsedWidth={48}
        onCollapse={(value) => {
          setCollapsed(value)
          localStorage.setItem('sidebar-collapsed', value ? '1' : '0')
        }}
        className="sidebar"
        trigger={
          <div className="sidebar-trigger">
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        }
      >
        <div className="sidebar-header">
          <BuildOutlined className="text-xl" style={{ color: 'var(--accent)' }} />
          {!collapsed && <span className="sidebar-title">{t('appName')}</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[
            location.pathname.startsWith('/dev-tools') ? '/dev-tools' : location.pathname
          ]}
          items={menuItems}
          className="!bg-transparent !border-e-0"
          onClick={({ key }) => {
            if (typeof key === 'string' && key.startsWith('/') && key !== location.pathname) {
              navigate(key)
            }
          }}
        />
      </Sider>
      <Layout className="layout-right flex flex-col min-h-0">
        <TitleBar />
        <Content className="overflow-auto content-area flex flex-col flex-1 min-h-0">
          <div
            className={`page-fade flex flex-col flex-1 min-h-0${
              fadeStage === 'exit'
                ? ' page-fade-exit'
                : fadeStage === 'enter'
                  ? ' page-fade-enter'
                  : ''
            }`}
            onAnimationEnd={(e) => {
              if (e.target !== e.currentTarget) return
              if (fadeStage === 'exit') {
                setDisplayLocation(location)
                setFadeStage('enter')
              } else if (fadeStage === 'enter') {
                setFadeStage('idle')
              }
            }}
          >
            {sshClientMounted && <SshClient active={showSshClient} />}
            {k8sMounted && <K8sManage active={showK8s} />}
            {devToolsMounted && <DevToolsArea active={showDevTools} />}
            {!showSshClient && !showK8s && !showDevTools && (
              <Routes location={displayLocation}>
                <Route path="/memo-sticky" element={<MemoSticky />} />
                <Route path="/lan-transfer" element={<LanTransfer />} />
                <Route path="/ssh-tunnel" element={<SshTunnel />} />
                <Route path="/about" element={<About />} />
                <Route path="/" element={<Navigate to="/dev-tools" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

function App(): React.JSX.Element {
  return <AppLayout />
}

export default App
