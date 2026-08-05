import { useEffect, useState } from 'react'
import { api } from '../api'
import Sparkline from '../components/Sparkline'
import SsidChart from '../components/SsidChart'
import { useSnapshot } from '../store'
import type { DeviceStatus, Severity } from '../types'
import { cssVar, fmt, onThemeChange, sinceLabel } from '../utils'

const SEV_META: Record<Severity, { cls: string; label: string; col: string; sym: string }> = {
  critical: { cls: 'crit', label: 'Critical', col: 'var(--critical)', sym: '✕' },
  serious: { cls: 'serious', label: 'Major', col: 'var(--serious)', sym: '▲' },
  warning: { cls: 'warn', label: 'Warning', col: 'var(--warning)', sym: '▲' },
  info: { cls: 'mute', label: 'Info', col: 'var(--baseline)', sym: 'ℹ' },
}

const ST_META: Record<DeviceStatus, [string, string]> = {
  ok: ['ok', '● Online'],
  warn: ['warn', '▲ Warning'],
  crit: ['crit', '✕ Offline'],
  mute: ['mute', '— Standby'],
}

export default function Overview() {
  const snap = useSnapshot()
  const { kpis } = snap
  const [wanColors, setWanColors] = useState(['#2a78d6', '#eb6834', '#1baf7a'])

  useEffect(() => {
    const read = () => setWanColors([cssVar('--s1'), cssVar('--s2'), cssVar('--s3')])
    read()
    return onThemeChange(read)
  }, [])

  const groups = [...new Set(snap.devices.map((d) => d.grp))]
  const activeAlerts = snap.alerts.filter((a) => !a.acked).length

  return (
    <section>
      <div className="view-head">
        <h1>Overview</h1>
        <p>Network health — refreshes every 3 s</p>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="k-label">Connected clients</div>
          <div className="k-value">{fmt(kpis.clients_total)}</div>
          <div className="k-sub">
            Staff {kpis.clients_staff} · Members {kpis.clients_members} · Guests {kpis.clients_guests}
          </div>
        </div>
        <div className="card kpi">
          <div className="k-label">Access points</div>
          <div className="k-value">
            {kpis.aps_up}
            <small> / {kpis.aps_total} online</small>
          </div>
          <div className="k-sub">Aironet 2800 / 1562 · WLC 3504</div>
        </div>
        <div className="card kpi">
          <div className="k-label">Active alerts</div>
          <div className="k-value">{kpis.alerts_active}</div>
          <div className="k-sub">
            {kpis.alerts_active
              ? `${kpis.alerts_critical} critical · ${kpis.alerts_active - kpis.alerts_critical} warning${kpis.alerts_active - kpis.alerts_critical > 1 ? 's' : ''}`
              : 'No active alerts'}
          </div>
        </div>
        <div className="card kpi">
          <div className="k-label">PoE budget used</div>
          <div className="k-value">
            {kpis.poe_watts}
            <small> W · {Math.round((kpis.poe_watts / kpis.poe_budget) * 100)}%</small>
          </div>
          <div className="k-sub">of {fmt(kpis.poe_budget)} W (2 × Catalyst 3650)</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-h">
            <b>Clients by SSID</b>
            <span className="sub">last 24 hours</span>
            <div className="legend">
              <span><i className="swatch" style={{ background: wanColors[0] }} />IOC-Staff</span>
              <span><i className="swatch" style={{ background: wanColors[1] }} />IOC-Members</span>
              <span><i className="swatch" style={{ background: wanColors[2] }} />IOC-Guests</span>
            </div>
          </div>
          <div className="card-b" style={{ padding: '10px 8px 6px' }}>
            <SsidChart hist={snap.ssid_history} />
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>Active alerts</b>
            <span className="sub">{activeAlerts} unacknowledged</span>
          </div>
          <div className="alert-list">
            {snap.alerts.length === 0 && (
              <div className="pp-empty">No active alerts. All systems nominal.</div>
            )}
            {snap.alerts.map((a) => {
              const m = SEV_META[a.sev]
              return (
                <div className={`alert ${a.acked ? 'acked' : ''}`} key={a.id}>
                  <span className="stripe" style={{ background: m.col }} />
                  <div className="body">
                    <div className="msg">{a.msg}</div>
                    <div className="meta">
                      <span className={`pill ${m.cls}`}>{m.sym} {m.label}</span> · {a.src} · for {sinceLabel(a.since)}
                    </div>
                  </div>
                  <button className="ack" onClick={() => api.ackAlert(a.id).catch(() => {})}>
                    {a.acked ? 'Acknowledged' : 'Acknowledge'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <b>Devices</b>
            <span className="sub">{snap.devices.length} monitored hosts</span>
          </div>
          <div className="card-b dev-groups">
            {groups.map((g) => (
              <div key={g}>
                <div className="nav-label" style={{ padding: '0 2px 7px' }}>{g}</div>
                <div className="dev-grid">
                  {snap.devices.filter((d) => d.grp === g).map((d) => {
                    const [cls, label] = ST_META[d.st]
                    return (
                      <div className={`dev ${d.st}`} key={d.name}>
                        <div className="top">
                          <b>{d.name}</b>
                          <span className={`pill ${cls}`}>{label}</span>
                        </div>
                        <div className="metrics">
                          <span>{d.kind}</span>
                          <span>{d.metric}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>WAN &amp; redundancy</b>
            <span className="sub">15-min latency</span>
          </div>
          <div>
            {snap.wan.map((w, i) => (
              <div className="wan-row" key={w.name}>
                <b>
                  {w.name}
                  <br />
                  <small style={{ fontWeight: 400, color: 'var(--muted)' }}>{w.sub}</small>
                </b>
                <span className="lat">
                  {w.latency[w.latency.length - 1]} ms · jitter {w.jitter.toLocaleString('en-US')} ms
                </span>
                <Sparkline data={w.latency.slice(-30)} w={150} h={34} color={wanColors[i % 3]} fill />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
