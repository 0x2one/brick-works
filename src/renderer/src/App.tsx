import { useState } from 'react'
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
  MenuUnfoldOutlined
} from '@ant-design/icons'
import TitleBar from './components/TitleBar'
import DevTools from './pages/DevTools'
import DevToolDetail from './pages/DevToolDetail'
import About from './pages/About'
import MemoSticky from './pages/MemoSticky'

const { Sider, Content } = Layout

function AppLayout(): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()

  const menuItems = [
    {
      key: '/memo-sticky',
      icon: <PushpinOutlined />,
      label: <NavLink to="/memo-sticky">{t('memoSticky')}</NavLink>
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
      <Layout className="layout-right">
        <TitleBar />
        <Content className="overflow-auto content-area">
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
        <Route path="/about" element={<About />} />
        <Route path="/" element={<Navigate to="/dev-tools" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
