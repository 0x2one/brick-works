import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import { NavLink, useLocation, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ToolOutlined,
  InfoCircleOutlined,
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

  useEffect(() => {
    window.api.lan.setLang(i18n.language === 'en' ? 'en' : 'zh')
  }, [i18n.language])

  const menuItems = [
    {
      key: '/memo-sticky',
      icon: <PushpinOutlined />,
      label: <NavLink to="/memo-sticky">{t('memoSticky')}</NavLink>
    },
    {
      key: '/lan-transfer',
      icon: <ThunderboltOutlined />,
      label: <NavLink to="/lan-transfer">{t('lanTransfer')}</NavLink>
    },
    {
      key: '/ssh-tunnel',
      icon: <DeploymentUnitOutlined />,
      label: <NavLink to="/ssh-tunnel">{t('sshTunnel')}</NavLink>
    },
    {
      key: '/ssh-client',
      icon: <CodeOutlined />,
      label: <NavLink to="/ssh-client">{t('sshClient')}</NavLink>
    },
    {
      key: '/k8s',
      icon: <CloudServerOutlined />,
      label: <NavLink to="/k8s">{t('k8sManage')}</NavLink>
    },
    {
      key: '/dev-tools',
      icon: <ToolOutlined />,
      label: <NavLink to="/dev-tools">{t('devTools')}</NavLink>
    },
    {
      key: '/about',
      icon: <InfoCircleOutlined />,
      label: <NavLink to="/about">{t('about')}</NavLink>
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
