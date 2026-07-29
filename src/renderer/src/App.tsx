import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import { NavLink, useLocation, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { HomeOutlined, InfoCircleOutlined, BuildOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import TitleBar from './components/TitleBar'
import Home from './pages/Home'
import About from './pages/About'

const { Sider, Content } = Layout

function AppLayout(): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()

  const menuItems = [
    { key: '/', icon: <HomeOutlined />, label: <NavLink to="/">{t('home')}</NavLink> },
    { key: '/about', icon: <InfoCircleOutlined />, label: <NavLink to="/about">{t('about')}</NavLink> },
  ]

  return (
    <Layout className="h-screen">
      <Sider
        collapsible
        collapsed={collapsed}
        collapsedWidth={48}
        onCollapse={setCollapsed}
        className="!bg-gray-50 !border-r !border-gray-200"
        trigger={
          <div className="!h-12 !flex !items-center !justify-center !bg-gray-50 !text-gray-400 hover:!text-gray-600 !border-t !border-gray-200 !cursor-pointer !w-full">
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        }
      >
        <div className="flex h-16 items-center justify-center gap-2.5 border-b border-gray-200">
          <BuildOutlined className="text-xl text-blue-600" />
          {!collapsed && <span className="font-bold text-base text-gray-800">{t('appName')}</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          className="!bg-transparent !border-e-0"
        />
      </Sider>
      <Layout className="!bg-white">
        <TitleBar />
        <Content className="p-6 overflow-auto !bg-white">
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
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
