import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from '../store'
import type { Severity } from '../types'
import { hms } from '../utils'

const SEV_PILL: Record<Severity, JSX.Element> = {
  critical: <span className="pill crit">✕ Critique</span>,
  serious: <span className="pill serious">▲ Majeur</span>,
  warning: <span className="pill warn">▲ Avertissement</span>,
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
        <p>Journal d'audit NetControl — actions réelles uniquement, pas de syslog simulé</p>
        <div className="tools log-filters">
          <select aria-label="Sévérité" value={sev} onChange={(e) => setSev(e.target.value)}>
            <option value="all">Toutes sévérités</option>
            <option value="critical">Critique</option>
            <option value="serious">Majeur</option>
            <option value="warning">Avertissement</option>
            <option value="info">Info</option>
          </select>
          <input
            type="search"
            placeholder="Filtrer (équipement, message…)"
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
                    ? 'Aucune entrée d\'audit pour le moment — chaque changement de config réel appliqué via Gestion switchs apparaîtra ici.'
                    : 'Aucune entrée ne correspond aux filtres actuels.'}
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
