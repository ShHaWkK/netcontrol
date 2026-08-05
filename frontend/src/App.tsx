import { useEffect, useState } from 'react'
import { useStore } from './store'
import { ToastHost } from './toast'
import { hms } from './utils'
import Heatmap from './views/Heatmap'
import Logs from './views/Logs'
import Overview from './views/Overview'
import SwitchManager from './views/SwitchManager'

type ViewKey = 'overview' | 'heatmap' | 'switch' | 'logs'

const NAV: { key: ViewKey; label: string; icon: JSX.Element }[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="8.5" y="1.5" width="5" height="5" rx="1" />
        <rect x="1.5" y="8.5" width="5" height="5" rx="1" /><rect x="8.5" y="8.5" width="5" height="5" rx="1" />
      </svg>
    ),
  },
  {
    key: 'heatmap',
    label: 'WiFi Heatmap',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
        <path d="M4.6 8a4.2 4.2 0 0 1 5.8 0" /><path d="M2.4 5.4a7.4 7.4 0 0 1 10.2 0" />
      </svg>
    ),
  },
  {
    key: 'switch',
    label: 'Switch Manager',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1.5" y="4.5" width="12" height="6" rx="1.2" />
        <path d="M4 7.5h.01M6.5 7.5h.01M9 7.5h.01M11.5 7.5h.01" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    key: 'logs',
    label: 'Logs',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2.5 3.5h10M2.5 7.5h10M2.5 11.5h6" />
      </svg>
    ),
  },
]

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="clock">{hms(now)}</span>
}

export default function App() {
  const { snap, connected } = useStore()
  const [view, setView] = useState<ViewKey>('overview')

  if (!snap) {
    return <div className="loading">Connecting to NetControl server…</div>
  }

  const alertCount = snap.alerts.filter((a) => !a.acked).length
  const isSim = snap.mode === 'simulation'
  const initials = snap.operator.slice(0, 2).toUpperCase()

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <span className="logo-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <path d="M4.5 8.8a5 5 0 0 1 7 0" /><path d="M2 6a8.5 8.5 0 0 1 12 0" />
              </svg>
            </span>
            <b>NetControl</b>
          </div>
          <div className="by">BSRQ.MEDIA · Dakar 2026</div>
        </div>
        <nav className="nav" aria-label="Main navigation">
          <div className="nav-label">Monitoring</div>
          {NAV.map((item) => (
            <button
              key={item.key}
              className={view === item.key ? 'active' : ''}
              aria-current={view === item.key ? 'page' : undefined}
              onClick={() => setView(item.key)}
            >
              {item.icon}
              <span className="nav-text">{item.label}</span>
              {item.key === 'logs' && alertCount > 0 && <span className="count">{alertCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {isSim && (
            <div className="env">
              <span className="sim-dot" />SIMULATION MODE
            </div>
          )}
          <span className="foot-text">
            On-site server · Terrou-Bi
            <br />
            Zabbix 7.0 LTS · offline-ready
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="site">
            <span className="pin" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 12.8S2.6 8.7 2.6 5.6a4.4 4.4 0 0 1 8.8 0C11.4 8.7 7 12.8 7 12.8Z" />
                <circle cx="7" cy="5.6" r="1.5" />
              </svg>
            </span>
            {snap.site_name} <small>· {snap.site_location}</small>
          </div>
          <div className="spacer" />
          {isSim && <span className="chip sim">SIMULATED DATA</span>}
          <Clock />
          <span className="user">
            <span className="avatar">{initials}</span>
            <span className="user-mail">{snap.operator}</span>
          </span>
        </header>

        {!connected && (
          <div className="conn-banner">
            Live connection lost — reconnecting…
          </div>
        )}

        <div className="content">
          {view === 'overview' && <Overview />}
          {view === 'heatmap' && <Heatmap />}
          {view === 'switch' && <SwitchManager />}
          {view === 'logs' && <Logs />}
          <div className="foot-note">
            NetControl {isSim ? '— simulation mode · 100% simulated data ' : ''}· © BSRQ.MEDIA 2026
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  )
}
