import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  PushpinOutlined,
  ThunderboltOutlined,
  DeploymentUnitOutlined,
  CodeOutlined,
  CloudServerOutlined,
  ToolOutlined,
  AppstoreOutlined,
  ArrowRightOutlined
} from '@ant-design/icons'
import logoUrl from '../assets/logo.svg'

const MODULES = [
  { key: 'memoSticky', route: '/memo-sticky', icon: <PushpinOutlined /> },
  { key: 'lanTransfer', route: '/lan-transfer', icon: <ThunderboltOutlined /> },
  { key: 'sshTunnel', route: '/ssh-tunnel', icon: <DeploymentUnitOutlined /> },
  { key: 'sshClient', route: '/ssh-client', icon: <CodeOutlined /> },
  { key: 'k8sManage', route: '/k8s', icon: <CloudServerOutlined /> },
  { key: 'devTools', route: '/dev-tools', icon: <ToolOutlined /> }
]

const DESC_KEYS: Record<string, string> = {
  memoSticky: 'memoStickyDesc',
  lanTransfer: 'lanDesc',
  sshTunnel: 'sshDesc',
  sshClient: 'sshClientDesc',
  k8sManage: 'k8sDesc',
  devTools: 'devToolsDesc'
}

const TECH_STACK = [
  'Electron',
  'React 19',
  'TypeScript',
  'Ant Design',
  'Tailwind CSS',
  'Vite',
  'i18next',
  'ssh2',
  'pdf-lib',
  'xterm.js'
]

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="flex items-center gap-2 mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
      {children}
    </h2>
  )
}

function About(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.api.app
      .info()
      .then(setInfo)
      .catch(() => {})
  }, [])

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-8 py-10 flex flex-col items-center text-center">
          <img src={logoUrl} alt="BrickWorks" className="w-20 h-20" />
          <h2 className="mt-5 text-2xl font-bold text-[var(--text-primary)]">{t('appName')}</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{t('aboutTagline')}</p>
          {info && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-[var(--accent)] text-white font-semibold">
                v{info.version}
              </span>
              <span className="px-2.5 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                Electron {info.electron}
              </span>
              <span className="px-2.5 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                Chromium {info.chrome}
              </span>
              <span className="px-2.5 py-1 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                Node {info.node}
              </span>
            </div>
          )}
        </section>

        <section>
          <SectionHeading>
            <AppstoreOutlined />
            {t('aboutModules')}
          </SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODULES.map((m) => (
              <div
                key={m.key}
                className="tool-card"
                onClick={() => navigate(m.route, { viewTransition: true })}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--accent)] text-white text-base shrink-0">
                    {m.icon}
                  </span>
                  <span className="font-semibold text-[15px] leading-snug text-[var(--text-primary)]">
                    {t(m.key)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)] mb-3 line-clamp-2">
                  {t(DESC_KEYS[m.key])}
                </p>
                <div className="mt-auto pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-secondary)]">
                  <span>{t('aboutOpenModule')}</span>
                  <ArrowRightOutlined />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionHeading>
            <CodeOutlined />
            {t('aboutTechStack')}
          </SectionHeading>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap gap-2">
              {TECH_STACK.map((name) => (
                <span
                  key={name}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg-warm)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <footer className="text-center text-xs text-[var(--text-secondary)] pb-4">
          {t('aboutFooter')} · © {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  )
}

export default About
