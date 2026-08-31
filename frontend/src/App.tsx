import { useEffect, useState } from 'react'
import { onViewChange, type ViewKey } from './nav'
import { useStore } from './store'
import { ToastHost } from './toast'
import { hms, isDarkTheme, onThemeChange, toggleTheme } from './utils'
import Heatmap from './views/Heatmap'
import Logs from './views/Logs'
import Overview from './views/Overview'
import SwitchManager from './views/SwitchManager'
import Topology from './views/Topology'

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
    key: 'topology',
    label: 'Topology',
    icon: (
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="3" cy="3.5" r="1.6" /><circle cx="12" cy="3.5" r="1.6" /><circle cx="7.5" cy="11.5" r="1.6" />
        <path d="M4.4 4.6L6.3 10M10.6 4.6L8.7 10M4.6 3.5h5.8" />
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

function ThemeToggle() {
  const [dark, setDark] = useState(isDarkTheme)
  useEffect(() => onThemeChange(() => setDark(isDarkTheme())), [])
  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="7.5" cy="7.5" r="3.2" />
          <path d="M7.5 1v1.6M7.5 12.4V14M1 7.5h1.6M12.4 7.5H14M3.1 3.1l1.15 1.15M10.75 10.75l1.15 1.15M3.1 11.9l1.15-1.15M10.75 4.25l1.15-1.15" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.9 8.6A5.6 5.6 0 0 1 6.4 2.1a5.6 5.6 0 1 0 6.5 6.5Z" />
        </svg>
      )}
    </button>
  )
}

export default function App() {
  const { snap, connected } = useStore()
  const [view, setView] = useState<ViewKey>('overview')

  useEffect(() => onViewChange(setView), [])

  if (!snap) {
    return <div className="loading">Connecting to NetControl server…</div>
  }

  const alertCount = snap.alerts_live ? snap.alerts.filter((a) => !a.acked).length : 0
  const isSim = snap.mode === 'simulation'
  const isHybrid = snap.mode === 'hybrid'
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
          {isHybrid && (
            <div className="env hybrid">
              <span className="sim-dot live" />LIVE + SIMULATED
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
          {isHybrid && <span className="chip hybrid">LIVE + SIMULATED DATA</span>}
          <Clock />
          <ThemeToggle />
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
          {view === 'topology' && <Topology />}
          {view === 'logs' && <Logs />}
          <div className="foot-note">
            NetControl {isSim ? '— simulation mode · 100% simulated data ' : ''}
            {isHybrid ? '— hybrid mode · some views are live, others still simulated ' : ''}
            · © BSRQ.MEDIA 2026
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  )
}
