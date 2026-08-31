import { useSnapshot } from '../store'
import type { Switch } from '../types'

interface Link {
  localPort: string
  state: string
  neighbor: string
  internal: boolean
  desc: string
}

/** Déduit le voisin d'une interconnexion à partir de la description du port :
 * si elle contient le nom d'un autre switch connu, c'est un lien interne
 * (entre deux switchs NetControl) ; sinon on nettoie les préfixes usuels
 * (UPLINK-, TRUNK ...) pour afficher un nom de voisin externe lisible. */
function inferNeighbor(desc: string, others: string[]): { label: string; internal: boolean } {
  const upper = desc.toUpperCase()
  for (const name of others) {
    if (name && upper.includes(name.toUpperCase())) return { label: name, internal: true }
  }
  const label = desc.replace(/^UPLINK[-\s]*/i, '').replace(/^TRUNK[-\s]*/i, '').trim()
  return { label: label || '(unlabeled)', internal: false }
}

function linksFor(sw: Switch, others: string[]): Link[] {
  const links: Link[] = []
  for (const s of sw.sfp) {
    if (!s.desc) continue
    const { label, internal } = inferNeighbor(s.desc, others)
    links.push({ localPort: s.id, state: s.state, neighbor: label, internal, desc: s.desc })
  }
  for (const p of sw.ports) {
    if (!p.desc || !/uplink|trunk/i.test(p.desc)) continue
    const { label, internal } = inferNeighbor(p.desc, others)
    links.push({ localPort: p.id, state: p.state, neighbor: label, internal, desc: p.desc })
  }
  return links
}

function StatusDot({ state }: { state: string }) {
  const cls = state === 'up' ? 'ok' : state === 'err' ? 'crit' : 'mute'
  return <span className={`pill ${cls}`}>● {state === 'up' ? 'up' : state === 'err' ? 'err-disabled' : 'down'}</span>
}

export default function Topology() {
  const snap = useSnapshot()
  const names = snap.switches.map((s) => s.name)

  return (
    <section>
      <div className="view-head">
        <h1>Topology</h1>
        <p>Switch interconnections — inferred from real port/uplink descriptions</p>
      </div>

      <div className="topo-grid">
        {snap.switches.map((sw) => {
          const links = linksFor(sw, names.filter((n) => n !== sw.name))
          return (
            <div className="card" key={sw.name}>
              <div className="card-h">
                <b>{sw.name}</b>
                {sw.live && <span className="pill live">● LIVE</span>}
                <span className="sub">{sw.model} · {sw.ip}</span>
              </div>
              <div className="card-b">
                {links.length === 0 && (
                  <div className="pp-empty">No uplink/trunk port with a usable description.</div>
                )}
                {links.length > 0 && (
                  <div className="topo-links">
                    {links.map((l, i) => (
                      <div className="topo-link" key={i}>
                        <span className="topo-port">{l.localPort}</span>
                        <StatusDot state={l.state} />
                        <span className="topo-arrow">→</span>
                        <span className={`topo-neighbor ${l.internal ? 'internal' : 'external'}`}>
                          {l.internal ? '🔗 ' : '⇥ '}{l.neighbor}
                        </span>
                        <span className="topo-desc">{l.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="foot-note" style={{ textAlign: 'left', marginTop: 14 }}>
        🔗 = lien vers un autre switch NetControl · ⇥ = lien vers un équipement externe (déduit du libellé de port, pas encore d'inventaire réseau).
      </p>
    </section>
  )
}
