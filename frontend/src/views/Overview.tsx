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

function NoSource({ what, need }: { what: string; need: string }) {
  return (
    <div className="pp-empty no-source">
      <b>No {what} connected.</b>
      <br />
      {need}
    </div>
  )
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

  // aucune fausse donnée affichée : seuls les groupes de devices adossés à
  // une source réelle (ou pas encore de source du tout, ex. Peripherals/
  // Network core simulés mais pas WiFi/WAN qui ont un indicateur *_live) sont
  // montrés — WiFi et WAN affichent un état vide explicite à la place.
  const hiddenGroups = new Set<string>([
    ...(snap.aps_live ? [] : ['WiFi']),
    ...(snap.wan_live ? [] : ['WAN']),
  ])
  const groups = [...new Set(snap.devices.map((d) => d.grp))].filter((g) => !hiddenGroups.has(g))
  const activeAlerts = snap.alerts.filter((a) => !a.acked).length
  const { staff, members, guests } = snap.ssid_history
  const membersTail = members.slice(-24)
  const guestsTail = guests.slice(-24)
  const clientTrend = staff.slice(-24).map((v, i) => v + membersTail[i] + guestsTail[i])

  return (
    <section>
      <div className="view-head">
        <h1>Overview</h1>
        <p>Network health — refreshes every 3 s</p>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="k-label">Connected clients</div>
          {snap.aps_live ? (
            <>
              <div className="k-value">{fmt(kpis.clients_total)}</div>
              <div className="k-sub">
                Staff {kpis.clients_staff} · Members {kpis.clients_members} · Guests {kpis.clients_guests}
              </div>
              <div className="kpi-spark">
                <Sparkline data={clientTrend} w={110} h={26} color={wanColors[0]} fill />
              </div>
            </>
          ) : (
            <>
              <div className="k-value k-value-empty">—</div>
              <div className="k-sub">No WLC connected</div>
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="k-label">Access points</div>
          {snap.aps_live ? (
            <>
              <div className="k-value">
                {kpis.aps_up}
                <small> / {kpis.aps_total} online</small>
              </div>
              <div className="k-sub">Aironet 2800 / 1562 · WLC 3504</div>
            </>
          ) : (
            <>
              <div className="k-value k-value-empty">—</div>
              <div className="k-sub">No WLC connected</div>
            </>
          )}
        </div>
        <div className={`card kpi${snap.alerts_live && kpis.alerts_critical > 0 ? ' crit' : ''}`}>
          <div className="k-label">Active alerts</div>
          {snap.alerts_live ? (
            <>
              <div className="k-value">{kpis.alerts_active}</div>
              <div className="k-sub">
                {kpis.alerts_active
                  ? `${kpis.alerts_critical} critical · ${kpis.alerts_active - kpis.alerts_critical} warning${kpis.alerts_active - kpis.alerts_critical > 1 ? 's' : ''}`
                  : 'No active alerts'}
              </div>
            </>
          ) : (
            <>
              <div className="k-value k-value-empty">—</div>
              <div className="k-sub">No Zabbix connected</div>
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="k-label">PoE budget used {snap.switches.some((s) => s.live) && <span className="k-live">LIVE</span>}</div>
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
            {snap.aps_live && (
              <div className="legend">
                <span><i className="swatch" style={{ background: wanColors[0] }} />IOC-Staff</span>
                <span><i className="swatch" style={{ background: wanColors[1] }} />IOC-Members</span>
                <span><i className="swatch" style={{ background: wanColors[2] }} />IOC-Guests</span>
              </div>
            )}
          </div>
          {snap.aps_live ? (
            <div className="card-b" style={{ padding: '10px 8px 6px' }}>
              <SsidChart hist={snap.ssid_history} />
            </div>
          ) : (
            <div className="card-b">
              <NoSource what="WiFi controller" need="Connect a WLC (SNMP) to see client traffic by SSID." />
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-h">
            <b>Active alerts</b>
            {snap.alerts_live && <span className="pill live">● LIVE — Zabbix</span>}
            {snap.alerts_live && <span className="sub">{activeAlerts} unacknowledged</span>}
          </div>
          {snap.alerts_live ? (
            <div className="alert-list">
              {snap.alerts.length === 0 && (
                <div className="pp-empty">No active alerts. All systems nominal.</div>
              )}
              {snap.alerts.map((a) => {
                const m = SEV_META[a.sev]
                return (
                  <div className={`alert ${m.cls} ${a.acked ? 'acked' : ''}`} key={a.id}>
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
          ) : (
            <div className="card-b">
              <NoSource what="Zabbix" need="Connect Zabbix (API token) to see real alerts here." />
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <b>Devices</b>
            <span className="sub">{snap.devices.filter((d) => !hiddenGroups.has(d.grp)).length} monitored hosts</span>
          </div>
          <div className="card-b dev-groups">
            {groups.map((g) => (
              <div key={g}>
                <div className="nav-label" style={{ padding: '0 2px 7px' }}>{g}</div>
                <div className="dev-grid">
                  {snap.devices.filter((d) => d.grp === g).map((d) => {
                    const [cls, label] = ST_META[d.st]
                    const liveSwitch = snap.switches.find((s) => s.name === d.name && s.live)
                    const cpuTrend = liveSwitch?.history.cpu.filter((v): v is number => v !== null) ?? []
                    return (
                      <div className={`dev ${d.st}`} key={d.name} style={{ position: 'relative' }}>
                        <div className="top">
                          <b>{d.name}</b>
                          {liveSwitch
                            ? <span className="pill live" style={{ marginLeft: 'auto' }}>● LIVE</span>
                            : <span className="pill mute" style={{ marginLeft: 'auto' }} title="Simulated — no real monitoring source wired for this device yet">SIM</span>}
                        </div>
                        <div className="metrics">
                          <span>{d.kind}</span>
                          <span>{d.metric}</span>
                          <span className={`pill ${cls}`}>{label}</span>
                        </div>
                        {cpuTrend.length >= 2 && (
                          <div className="dev-spark" title="CPU trend">
                            <Sparkline data={cpuTrend.slice(-30)} w={64} h={20} color={wanColors[0]} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {!snap.aps_live && (
              <div>
                <div className="nav-label" style={{ padding: '0 2px 7px' }}>WiFi</div>
                <NoSource what="WLC" need="AP inventory needs a WiFi controller connection." />
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>WAN &amp; redundancy</b>
            {snap.wan_live && <span className="sub">15-min latency</span>}
          </div>
          {snap.wan_live ? (
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
          ) : (
            <div className="card-b">
              <NoSource what="WAN monitoring" need="No probe/Zabbix template wired to the WAN links yet." />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
