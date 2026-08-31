import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { goToPort } from '../nav'
import { useSnapshot } from '../store'
import type { Ap, MetricKey, Room } from '../types'
import { SSID_NAMES } from '../types'
import { cssVar, onThemeChange } from '../utils'

const W = 1000
const H = 640

/* Refonte 2026 : palette plus saturée/moderne (émeraude → citron → ambre →
   orange → rouge), 6 paliers nets, contour resserré pour un rendu plus
   "instrument de mesure" que "tache de peinture". */
const HEAT = ['#0d9f6e', '#65a30d', '#eab308', '#f97316', '#ef4444', '#b91c1c']
const HEAT_RGB = HEAT.map((x) => [
  parseInt(x.slice(1, 3), 16),
  parseInt(x.slice(3, 5), 16),
  parseInt(x.slice(5, 7), 16),
])
const SIGMA = 30
const CUTOFF = 96

function heatColor(t: number): number[] {
  t = Math.max(0, Math.min(1, t))
  return HEAT_RGB[Math.min(HEAT.length - 1, Math.floor(t * HEAT.length))]
}

type SsidFilter = 'all' | 'staff' | 'members' | 'guests'

function apClients(ap: Ap, ssid: SsidFilter): number {
  const c = ap.clients
  return ssid === 'all' ? c.staff + c.members + c.guests : c[ssid]
}

interface PortRef {
  swName: string
  n: number
}

/** Retrouve le port switch câblé à cet AP (convention : la description du
 * port == l'id de l'AP) — permet de sauter direct au bon endroit pour agir. */
function findApPort(apId: string, switches: { name: string; ports: { n: number; desc: string }[] }[]): PortRef | null {
  for (const sw of switches) {
    const p = sw.ports.find((p) => p.desc === apId)
    if (p) return { swName: sw.name, n: p.n }
  }
  return null
}

interface MetricDef {
  label: string
  min: number
  max: number
  inv?: boolean
  val: (ap: Ap, ssid: SsidFilter) => number
  fmt: (v: number) => string
}

const METRICS: Record<MetricKey, MetricDef> = {
  clients: { label: 'Clients', min: 0, max: 22, val: apClients, fmt: (v) => String(v) },
  util: { label: 'Channel utilization', min: 0, max: 100, val: (ap) => ap.util, fmt: (v) => `${v}%` },
  noise: { label: 'Noise', min: -100, max: -70, val: (ap) => ap.noise, fmt: (v) => `${v} dBm` },
  rssi: { label: 'Avg RSSI', min: -85, max: -45, inv: true, val: (ap) => ap.rssi, fmt: (v) => `${v} dBm` },
}

function drawPlan(cv: HTMLCanvasElement, rooms: Room[]) {
  const ctx = cv.getContext('2d')!
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
    ? document.documentElement.dataset.theme !== 'light'
    : document.documentElement.dataset.theme === 'dark'
  ctx.clearRect(0, 0, W, H)

  // fond "plan d'architecte" : quadrillage fin plutôt qu'un aplat uni
  ctx.fillStyle = cssVar('--surface-2')
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = dark ? 'rgba(255,255,255,.035)' : 'rgba(11,11,11,.03)'
  ctx.lineWidth = 1
  for (let x = 0; x <= W; x += 20) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke()
  }
  for (let y = 0; y <= H; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke()
  }

  rooms.forEach((r) => {
    // léger dégradé au lieu d'un aplat plat — donne du volume sans bruit
    const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h)
    if (dark) {
      grad.addColorStop(0, 'rgba(255,255,255,.045)')
      grad.addColorStop(1, 'rgba(255,255,255,.015)')
    } else {
      grad.addColorStop(0, 'rgba(11,11,11,.035)')
      grad.addColorStop(1, 'rgba(11,11,11,.012)')
    }
    ctx.fillStyle = grad
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = cssVar('--baseline')
    ctx.lineWidth = 1.5
    ctx.setLineDash(r.out ? [6, 5] : [])
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
  })
  ctx.setLineDash([])

  // enveloppe bâtiment en double-trait (convention plan d'architecte)
  ctx.strokeStyle = cssVar('--ink-2')
  ctx.lineWidth = 2.5
  ctx.strokeRect(20.5, 20.5, 940, 600)
  ctx.lineWidth = 1
  ctx.strokeStyle = cssVar('--baseline')
  ctx.strokeRect(16.5, 16.5, 948, 608)

  ctx.fillStyle = cssVar('--muted')
  ctx.font = '700 10.5px system-ui,-apple-system,sans-serif'
  rooms.forEach((r) => {
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    ctx.translate(r.x + 9, r.y + 18)
    ctx.fillText(r.label.toUpperCase(), 0, 0)
    ctx.restore()
  })
  ctx.fillText('CORRIDOR', 468, 300)

  // échelle + repère nord — détail de plan pro, coin bas-droit
  ctx.strokeStyle = cssVar('--ink-2')
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(W - 116, H - 22); ctx.lineTo(W - 26, H - 22); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W - 116, H - 26); ctx.lineTo(W - 116, H - 18); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W - 26, H - 26); ctx.lineTo(W - 26, H - 18); ctx.stroke()
  ctx.font = '600 9.5px system-ui,-apple-system,sans-serif'
  ctx.fillText('10 m', W - 92, H - 30)
}

function drawHeat(cv: HTMLCanvasElement, aps: Ap[], metric: MetricKey, ssid: SsidFilter) {
  const ctx = cv.getContext('2d')!
  const M = METRICS[metric]
  const img = ctx.createImageData(W, H)
  const cut2 = CUTOFF * CUTOFF
  const s2 = 2 * SIGMA * SIGMA
  const live = aps.filter((a) => !a.down).map((ap) => ({ x: ap.x, y: ap.y, v: M.val(ap, ssid) }))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sw = 0
      let sv = 0
      for (let k = 0; k < live.length; k++) {
        const dx = x - live[k].x
        const dy = y - live[k].y
        const d2 = dx * dx + dy * dy
        if (d2 > cut2) continue
        const w = Math.exp(-d2 / s2)
        sw += w
        sv += w * live[k].v
      }
      const idx = (y * W + x) * 4
      if (sw < 0.03) {
        img.data[idx + 3] = 0
        continue
      }
      let t = (sv / sw - M.min) / (M.max - M.min)
      if (M.inv) t = 1 - t
      const c = heatColor(t)
      img.data[idx] = c[0]
      img.data[idx + 1] = c[1]
      img.data[idx + 2] = c[2]
      img.data[idx + 3] = Math.round(210 * Math.min(1, sw * 3.6))
    }
  }
  ctx.putImageData(img, 0, 0)
}

interface DragState {
  id: string
  x: number
  y: number
}

export default function Heatmap() {
  const snap = useSnapshot()
  const planRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [metric, setMetric] = useState<MetricKey>('clients')
  const [ssid, setSsid] = useState<SsidFilter>('all')
  const [editMode, setEditMode] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [tipAp, setTipAp] = useState<string | null>(null)
  const [themeTick, setThemeTick] = useState(0)

  useEffect(() => onThemeChange(() => setThemeTick((t) => t + 1)), [])

  // positions affichées = snapshot, surchargé par le drag en cours
  const aps = useMemo(
    () => snap.aps.map((ap) => (drag && drag.id === ap.id ? { ...ap, x: drag.x, y: drag.y } : ap)),
    [snap.aps, drag],
  )

  useEffect(() => {
    if (planRef.current) drawPlan(planRef.current, snap.rooms)
  }, [snap.rooms, themeTick])

  // la nappe est recalculée sur les positions serveur uniquement : pendant un
  // drag, seul le marqueur suit le curseur (recalcul plein cadre trop coûteux)
  useEffect(() => {
    if (overlayRef.current) drawHeat(overlayRef.current, snap.aps, metric, ssid)
  }, [snap.aps, metric, ssid])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const r = wrapRef.current!.getBoundingClientRect()
      setDrag((d) => d && {
        ...d,
        x: Math.max(15, Math.min(985, ((e.clientX - r.left) / r.width) * W)),
        y: Math.max(15, Math.min(625, ((e.clientY - r.top) / r.height) * H)),
      })
    }
    const onUp = () => {
      setDrag((d) => {
        if (d) api.setApPosition(d.id, d.x, d.y).catch(() => {})
        return null
      })
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [drag !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const M = METRICS[metric]
  const stops = M.inv ? [...HEAT].reverse() : HEAT
  const gradient =
    'linear-gradient(90deg,' +
    stops
      .map((c, i) => `${c} ${((i / stops.length) * 100).toFixed(1)}% ${(((i + 1) / stops.length) * 100).toFixed(1)}%`)
      .join(',') +
    ')'

  const sorted = [...aps].sort((a, b) => apClients(b, 'all') - apClients(a, 'all'))
  const upCount = aps.filter((a) => !a.down).length
  const totalClients = aps.reduce((s, a) => s + apClients(a, 'all'), 0)
  const tip = tipAp ? aps.find((a) => a.id === tipAp) : null
  const tipPort = tip?.down ? findApPort(tip.id, snap.switches) : null

  if (!snap.aps_live) {
    return (
      <section>
        <div className="view-head">
          <h1>WiFi Heatmap</h1>
          <p>Level 1 — IOC zone · Terrou-Bi Hotel</p>
        </div>
        <div className="card">
          <div className="card-b">
            <div className="pp-empty no-source" style={{ padding: '48px 20px' }}>
              <svg width="28" height="28" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ margin: '0 auto 10px', display: 'block', opacity: .6 }}>
                <circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
                <path d="M4.6 8a4.2 4.2 0 0 1 5.8 0" /><path d="M2.4 5.4a7.4 7.4 0 0 1 10.2 0" />
                <path d="M1.5 1.5l12 12" strokeLinecap="round" />
              </svg>
              <b>No WiFi controller connected.</b>
              <br />
              There is nothing real to show here — no simulated data is displayed instead.
              <br />
              Connect a WLC (SNMP, read-only community) to see live AP positions, client
              counts and RSSI on the floor plan.
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="view-head">
        <h1>WiFi Heatmap</h1>
        <p>Level 1 — IOC zone · Terrou-Bi Hotel</p>
        <div className="tools">
          <label className={`toggle ${editMode ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={editMode}
              onChange={(e) => setEditMode(e.target.checked)}
            />
            Edit mode — move APs
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-b" style={{ padding: '14px 16px' }}>
          <div className="hm-bar">
            <div className="seg" role="group" aria-label="Metric">
              {(Object.keys(METRICS) as MetricKey[]).map((k) => (
                <button
                  key={k}
                  className={metric === k ? 'active' : ''}
                  aria-pressed={metric === k}
                  onClick={() => setMetric(k)}
                >
                  {METRICS[k].label}
                </button>
              ))}
            </div>
            <select
              aria-label="SSID"
              value={ssid}
              disabled={metric !== 'clients'}
              onChange={(e) => setSsid(e.target.value as SsidFilter)}
            >
              <option value="all">All SSIDs</option>
              <option value="staff">IOC-Staff</option>
              <option value="members">IOC-Members</option>
              <option value="guests">IOC-Guests</option>
            </select>
            <div className="hm-legend">
              <span>{M.fmt(M.min)}</span>
              <div className="hm-grad" style={{ background: gradient }} />
              <span>{M.fmt(M.max)}</span>
              <span>{metric === 'clients' ? (ssid === 'all' ? 'clients' : SSID_NAMES[ssid]) : ''}</span>
            </div>
          </div>

          <div className={`hm-wrap ${editMode ? 'editing' : ''}`} ref={wrapRef}>
            <canvas ref={planRef} width={W} height={H} aria-label="Level 1 floor plan with WiFi heatmap" />
            <canvas ref={overlayRef} width={W} height={H} className="hm-overlay" />
            <div style={{ position: 'absolute', inset: 0 }}>
              {aps.map((ap) => (
                <button
                  key={ap.id}
                  className={`ap-marker${ap.down ? ' down' : ''}${drag?.id === ap.id ? ' dragging' : ''}`}
                  style={{ left: `${(ap.x / W) * 100}%`, top: `${(ap.y / H) * 100}%` }}
                  aria-label={ap.down ? `${ap.id} — offline, click to fix in Switch Manager` : ap.id}
                  onPointerEnter={() => setTipAp(ap.id)}
                  onPointerLeave={() => setTipAp(null)}
                  onPointerDown={(e) => {
                    if (!editMode) return
                    e.preventDefault()
                    setTipAp(null)
                    setDrag({ id: ap.id, x: ap.x, y: ap.y })
                  }}
                  onClick={() => {
                    if (editMode || !ap.down) return
                    const port = findApPort(ap.id, snap.switches)
                    if (port) goToPort(port.swName, port.n)
                  }}
                >
                  {ap.down ? '✕' : M.val(ap, ssid)}
                  <span className="ap-name">{ap.id.replace(/^AP-/, '')}</span>
                </button>
              ))}
              {tip && !drag && (
                <div
                  className="ap-tip"
                  style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}
                >
                  {tip.down ? (
                    <>
                      <b>{tip.id}</b> <span className="pill crit">✕ Offline</span>
                      <table><tbody>
                        <tr><td>{tip.room}</td></tr>
                        {tipPort && <tr><td>err-disabled — {tipPort.swName} {tipPort.n > 0 ? `Gi1/0/${tipPort.n}` : ''}</td></tr>}
                      </tbody></table>
                      {tipPort && <div className="ap-tip-hint">⚡ Click marker to fix in Switch Manager</div>}
                    </>
                  ) : (
                    <>
                      <b>{tip.id}</b>
                      <table><tbody>
                        <tr><td>{tip.room} · {tip.model}</td><td /></tr>
                        <tr><td>Clients</td><td>{apClients(tip, 'all')}</td></tr>
                        <tr><td>Channel</td><td>{tip.util}%</td></tr>
                        <tr><td>Noise</td><td>{tip.noise} dBm</td></tr>
                        <tr><td>Avg RSSI</td><td>{tip.rssi} dBm</td></tr>
                      </tbody></table>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <p style={{ margin: '10px 2px 0', fontSize: 11.5, color: 'var(--muted)' }}>
            Operational view: Gaussian IDW interpolation of live metrics reported by each AP —
            not an RF propagation model. AP positions are persisted.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <b>Access points — live</b>
          <span className="sub">
            {upCount}/{aps.length} online · {totalClients} associated clients
          </span>
        </div>
        <div className="table-scroll">
          <table className="log-table">
            <thead>
              <tr style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
                <td>AP</td><td>Room</td><td>Status</td>
                <td style={{ textAlign: 'right' }}>Clients</td>
                <td style={{ textAlign: 'right' }}>Staff / Members / Guests</td>
                <td style={{ textAlign: 'right' }}>Channel</td>
                <td style={{ textAlign: 'right' }}>Noise</td>
                <td style={{ textAlign: 'right' }}>Avg RSSI</td>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ap) => {
                const d = ap.down
                return (
                  <tr key={ap.id}>
                    <td className="lt-src">
                      {ap.id}
                      <br />
                      <small style={{ fontWeight: 400, color: 'var(--muted)' }}>{ap.model}</small>
                    </td>
                    <td style={{ color: 'var(--ink-2)' }}>{ap.room}</td>
                    <td>
                      {d ? (
                        <span className="pill crit">✕ Offline</span>
                      ) : ap.util >= 70 ? (
                        <span className="pill warn">▲ High channel load</span>
                      ) : (
                        <span className="pill ok">● Online</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {d ? '—' : apClients(ap, 'all')}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {d ? '—' : `${ap.clients.staff} / ${ap.clients.members} / ${ap.clients.guests}`}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d ? '—' : `${ap.util}%`}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d ? '—' : `${ap.noise} dBm`}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d ? '—' : `${ap.rssi} dBm`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
