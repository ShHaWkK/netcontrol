import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSnapshot } from '../store'
import { showToast } from '../toast'
import type { CliPreview, Port, PortConfigRequest, SfpPort, Switch } from '../types'
import { PROFILES, VLANS } from '../types'
import { minutesAgo } from '../utils'

interface Selection {
  swName: string
  n: number // numéro de port ; -1..-4 pour les SFP (index = -n - 1)
}

function cliLineClass(line: string): string | undefined {
  if (line.startsWith('!')) return 'c'
  if (['configure terminal', 'end', 'write memory'].includes(line)) return 'k'
  return undefined
}

export default function SwitchManager() {
  const snap = useSnapshot()
  const [sel, setSel] = useState<Selection | null>(null)
  const [vlan, setVlan] = useState<number>(10)
  const [desc, setDesc] = useState('')
  const [preview, setPreview] = useState<{ cli: CliPreview; req: PortConfigRequest } | null>(null)

  const sw = sel ? snap.switches.find((s) => s.name === sel.swName) : null
  const port: Port | null = sel && sw && sel.n > 0 ? sw.ports[sel.n - 1] : null
  const sfp: SfpPort | null = sel && sw && sel.n < 0 ? sw.sfp[-sel.n - 1] : null

  // resynchronise le formulaire quand on change de port
  useEffect(() => {
    if (port) {
      setVlan(port.vlan)
      setDesc(port.desc)
    }
  }, [sel?.swName, sel?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const openPreview = (action: PortConfigRequest['action']) => {
    if (!sel || !sw) return
    const req: PortConfigRequest =
      action === 'config' ? { action, vlan, desc } : { action }
    api
      .previewPort(sw.name, sel.n, req)
      .then((cli) => setPreview({ cli, req }))
      .catch((e) => showToast('Error', e.message))
  }

  const apply = () => {
    if (!sel || !sw || !preview) return
    api
      .applyPort(sw.name, sel.n, preview.req)
      .then((cli) => {
        showToast('Configuration applied', `${cli.summary} — ${sw.name}`)
        setPreview(null)
      })
      .catch((e) => showToast('Error', e.message))
  }

  // la modale se ferme à Échap, comme attendu d'un dialogue
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPreview(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [preview])

  const renderFaceplate = (s: Switch, si: number) => {
    const up = s.ports.filter((p) => p.state === 'up').length
    const poe = Math.round(s.ports.reduce((x, p) => x + p.poe, 0))
    // ordre Cisco : ports impairs rangée haute, pairs rangée basse, flux en colonnes
    const cells: JSX.Element[] = []
    for (let col = 0; col < 24; col++) {
      for (const p of [s.ports[col * 2], s.ports[col * 2 + 1]]) {
        const cls = p.protected ? 'prot' : p.state === 'up' ? 'up' : p.state === 'err' ? 'err' : ''
        const isSel = sel?.swName === s.name && sel.n === p.n
        cells.push(
          <button
            key={p.id}
            className={`port ${cls}${isSel ? ' sel' : ''}`}
            title={`${p.id}${p.desc ? ' — ' + p.desc : ''}`}
            aria-label={p.id}
            onClick={() => setSel({ swName: s.name, n: p.n })}
          >
            {p.n}
          </button>,
        )
      }
    }
    return (
      <div className="fp-inner" style={si ? { marginTop: 20 } : undefined} key={s.name}>
        <div className="fp-title">
          <b>{s.name}</b>
          <span className="sub">{s.model} · {s.ip} · {s.loc}</span>
          <span className="pill ok" style={{ marginLeft: 'auto' }}>● {up} ports up</span>
          <span className="pill mute">PoE {poe} W / 720 W</span>
        </div>
        <div className="fp-body">
          <div className="fp-ports">{cells}</div>
          <div className="fp-sfp">
            {s.sfp.map((u, ui) => {
              const cls = u.protected ? 'prot' : u.state === 'up' ? 'up' : ''
              const isSel = sel?.swName === s.name && sel.n === -(ui + 1)
              return (
                <button
                  key={u.id}
                  className={`port ${cls}${isSel ? ' sel' : ''}`}
                  title={`${u.id}${u.desc ? ' — ' + u.desc : ''}`}
                  onClick={() => setSel({ swName: s.name, n: -(ui + 1) })}
                >
                  {u.id.slice(-3)}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const applyProfile = (name: string) => {
    const p = PROFILES.find((x) => x.name === name)
    if (!p || !port) return
    setVlan(p.vlan)
    if (!desc || /^(AP|MFP|VISIO|LAN)-/.test(desc)) {
      setDesc(p.desc_prefix + String(port.n).padStart(2, '0'))
    }
  }

  return (
    <section>
      <div className="view-head">
        <h1>Switch Manager</h1>
        <p>Port provisioning without SSH — preview before applying</p>
      </div>

      <div className="sw-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card faceplate">
            {snap.switches.map((s, i) => renderFaceplate(s, i))}
          </div>
          <div className="fp-legend" style={{ padding: '0 4px' }}>
            <span><i className="up" />Up</span>
            <span><i />Down</span>
            <span><i className="err" />err-disabled</span>
            <span><i className="prot" />Protected — read-only</span>
          </div>
        </div>

        <div className="card port-panel">
          <div className="card-h">
            <b>Port details</b>
            <span className="sub">{sw?.name ?? ''}</span>
          </div>
          <div className="card-b">
            {!sel && (
              <div className="pp-empty">
                Select a port on the faceplate
                <br />
                to view its details and configure it.
              </div>
            )}

            {sfp && sw && (
              <>
                <div className="pp-id">
                  <b>{sfp.id}</b>
                  {sfp.state === 'up'
                    ? <span className="pill ok">● up</span>
                    : <span className="pill mute">— down</span>}
                </div>
                <div className="pp-stats">
                  <span className="l">Description</span>
                  <span className="v">{sfp.desc || '—'}</span>
                </div>
                <ProtectedNote />
              </>
            )}

            {port && sw && port.protected && (
              <>
                <div className="pp-id">
                  <b>{port.id}</b>
                  <StatePill state={port.state} />
                </div>
                <div className="pp-stats">
                  <span className="l">Description</span>
                  <span className="v">{port.desc || '—'}</span>
                  <span className="l">VLAN</span>
                  <span className="v">{vlanLabel(port.vlan)}</span>
                </div>
                <ProtectedNote />
              </>
            )}

            {port && sw && !port.protected && (
              <>
                <div className="pp-id">
                  <b>{port.id}</b>
                  <StatePill state={port.state} />
                </div>
                <div className="pp-stats">
                  <span className="l">PoE draw</span>
                  <span className="v">{port.poe ? `${port.poe.toFixed(1)} W` : '—'}</span>
                  <span className="l">Errors (in/out)</span>
                  <span className="v">{port.err || 0}</span>
                  <span className="l">Last change</span>
                  <span className="v">{minutesAgo(12 + port.n)}</span>
                  <span className="l">Traffic</span>
                  <span className="v">{port.state === 'up' ? `${2 + (port.n % 9)}.${port.n % 10} Mb/s` : '—'}</span>
                </div>
                <div className="field">
                  <label htmlFor="fVlan">Access VLAN</label>
                  <select id="fVlan" value={vlan} onChange={(e) => setVlan(+e.target.value)}>
                    {VLANS.map((v) => (
                      <option key={v.id} value={v.id}>{v.id} — {v.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fDesc">Description</label>
                  <input
                    type="text"
                    id="fDesc"
                    value={desc}
                    placeholder="e.g. VISIO-MR2"
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Quick profiles</label>
                  <div className="profiles">
                    {PROFILES.map((p) => (
                      <button key={p.name} onClick={() => applyProfile(p.name)}>{p.name}</button>
                    ))}
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn" onClick={() => openPreview('poe')}>↻ Restart PoE</button>
                  <button className="btn" onClick={() => openPreview(port.state === 'down' ? 'noshut' : 'shut')}>
                    {port.state === 'down' ? 'Enable' : 'Disable'}
                  </button>
                </div>
                <button className="btn primary" onClick={() => openPreview('config')}>
                  Preview commands
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div
          className="modal-bg"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setPreview(null)}
        >
          <div className="modal">
            <div className="card-h">
              <b>Command preview</b>
              <span className="sub">{preview.cli.target} · {preview.cli.ip}</span>
            </div>
            <div className="card-b">
              <pre className="cli">
                {preview.cli.lines.map((line, i) => {
                  const cls = cliLineClass(line)
                  return (
                    <span key={i}>
                      {cls ? <span className={cls}>{line}</span> : line}
                      {'\n'}
                    </span>
                  )
                })}
              </pre>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button>
              <button className="btn primary" autoFocus onClick={apply}>
                Apply{snap.mode === 'simulation' ? ' (simulation)' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function StatePill({ state }: { state: Port['state'] }) {
  if (state === 'up') return <span className="pill ok">● up</span>
  if (state === 'err') return <span className="pill crit">✕ err-disabled</span>
  return <span className="pill mute">— down</span>
}

function vlanLabel(id: number): string {
  const v = VLANS.find((x) => x.id === id)
  return v ? `${v.id} — ${v.name}` : String(id)
}

function ProtectedNote() {
  return (
    <div className="prot-note">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flex: 'none', marginTop: 1 }}>
        <rect x="3" y="6.5" width="9" height="6" rx="1.3" />
        <path d="M5 6.5V5a2.5 2.5 0 0 1 5 0v1.5" />
      </svg>
      <span>
        <b>Protected port.</b> Uplinks, WLC and the NetControl server are locked read-only —
        the tool cannot cut its own connectivity.
      </span>
    </div>
  )
}
