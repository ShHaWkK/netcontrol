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
      (sev === 'all' || l.sev === sev) &&
      (!q || `${l.src} ${l.msg}`.toLowerCase().includes(q)),
  )

  return (
    <section>
      <div className="view-head">
        <h1>Logs</h1>
        <p>NetControl audit trail — real actions only, no simulated syslog</p>
        <div className="tools log-filters">
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
                  {snap.logs.length === 0
                    ? 'No audit entries yet — every real config change applied via Switch Manager will appear here.'
                    : 'No entries match the current filters.'}
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
