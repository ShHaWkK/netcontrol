import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from '../store'
import type { Severity } from '../types'
import { hms } from '../utils'

const SEV_PILL: Record<Severity, JSX.Element> = {
  critical: <span className="pill crit">✕ Critical</span>,
  serious: <span className="pill serious">▲ Major</span>,
  warning: <span className="pill warn">▲ Warning</span>,
  info: <span className="pill mute">ℹ Info</span>,
}

export default function Logs() {
  const snap = useSnapshot()
  const [type, setType] = useState('all')
  const [sev, setSev] = useState('all')
  const [search, setSearch] = useState('')
  const seenRef = useRef<Set<number>>(new Set())
  const [, force] = useState(0)

  // marque comme « vues » les entrées déjà affichées pour l'animation fresh
  useEffect(() => {
    const t = setTimeout(() => {
      snap.logs.forEach((l) => seenRef.current.add(l.id))
      force((x) => x + 1)
    }, 1600)
    return () => clearTimeout(t)
  }, [snap.logs])

  const q = search.toLowerCase()
  const rows = snap.logs.filter(
    (l) =>
      (type === 'all' || l.type === type) &&
      (sev === 'all' || l.sev === sev) &&
      (!q || `${l.src} ${l.msg}`.toLowerCase().includes(q)),
  )

  return (
    <section>
      <div className="view-head">
        <h1>Logs</h1>
        <p>Device syslog · alerts · NetControl audit trail</p>
        <div className="tools log-filters">
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            <option value="syslog">Syslog</option>
            <option value="alerte">Alerts</option>
            <option value="audit">Audit</option>
          </select>
          <select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="serious">Major</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <input
            type="search"
            placeholder="Filter (device, message…)"
            style={{ width: 220 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card table-scroll">
        <table className="log-table">
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>
                  No entries match the current filters.
                </td>
              </tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className={seenRef.current.has(l.id) ? '' : 'fresh'}>
                <td className="lt-time">{hms(l.t)}</td>
                <td>{SEV_PILL[l.sev]}</td>
                <td className="lt-src">{l.src}</td>
                <td className="lt-msg">{l.msg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
