import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation, Outlet } from 'react-router-dom'
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
import DevTools from './pages/DevTools'
import DevToolDetail from './pages/DevToolDetail'
import About from './pages/About'
import MemoSticky from './pages/MemoSticky'
import LanTransfer from './pages/LanTransfer'
import SshTunnel from './pages/SshTunnel'
import SshClient from './pages/SshClient'
import K8sManage from './pages/K8sManage'

const { Sider, Content } = Layout

function AppLayout(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    window.api.lan.setLang(i18n.language === 'en' ? 'en' : 'zh')
  }, [i18n.language])

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
        onCollapse={setCollapsed}
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
              navigate(key, { viewTransition: true })
            }
          }}
        />
      </Sider>
      <Layout className="layout-right flex flex-col min-h-0">
        <TitleBar />
        <Content className="overflow-auto content-area flex flex-col flex-1 min-h-0">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

function App(): React.JSX.Element {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dev-tools" element={<DevTools />} />
        <Route path="/dev-tools/:toolId" element={<DevToolDetail />} />
        <Route path="/memo-sticky" element={<MemoSticky />} />
        <Route path="/lan-transfer" element={<LanTransfer />} />
        <Route path="/ssh-tunnel" element={<SshTunnel />} />
        <Route path="/ssh-client" element={<SshClient />} />
        <Route path="/k8s" element={<K8sManage />} />
        <Route path="/about" element={<About />} />
        <Route path="/" element={<Navigate to="/dev-tools" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
