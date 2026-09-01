import { useEffect, useState } from 'react'
import { api } from '../api'
import MetricChart from '../components/MetricChart'
import Sparkline from '../components/Sparkline'
import SsidChart from '../components/SsidChart'
import { useSnapshot } from '../store'
import type { DeviceStatus, Severity, ZabbixMetric } from '../types'
import { cssVar, fmt, onThemeChange, sinceLabel } from '../utils'

interface HostMetrics {
  host: string
  cpu?: ZabbixMetric
  mem?: ZabbixMetric
  temp?: ZabbixMetric
  latency?: ZabbixMetric
  rest: ZabbixMetric[]
}

/** Sépare les métriques d'un hôte en "vedettes" (CPU/mémoire/température/latence
 * — les 4 qu'un admin réseau regarde en premier) et le reste, relégué derrière
 * un "+ N métriques" pour ne pas noyer l'Overview sous 15 mini-graphs. */
function groupHostMetrics(host: string, metrics: ZabbixMetric[]): HostMetrics {
  const pick = (pred: (m: ZabbixMetric) => boolean) => metrics.find((m) => !m.name.startsWith('reserve ') && pred(m))
  const cpu = pick((m) => m.name === 'CPU utilization')
  const mem = pick((m) => m.name === 'Processor: Memory utilization')
  const temps = metrics.filter((m) => m.name.includes('Temperature') && !m.name.startsWith('reserve '))
  const temp = temps.reduce<ZabbixMetric | undefined>((hottest, m) => {
    const v = m.values[m.values.length - 1]
    const hv = hottest?.values[hottest.values.length - 1]
    return v !== null && v !== undefined && (hv === null || hv === undefined || v > hv) ? m : hottest
  }, undefined)
  const latency = pick((m) => m.name === 'ICMP response time')
  const featured = new Set([cpu, mem, temp, latency].filter(Boolean))
  return { host, cpu, mem, temp, latency, rest: metrics.filter((m) => !featured.has(m)) }
}

const SEV_META: Record<Severity, { cls: string; label: string; col: string; sym: string }> = {
  critical: { cls: 'crit', label: 'Critique', col: 'var(--critical)', sym: '✕' },
  serious: { cls: 'serious', label: 'Majeur', col: 'var(--serious)', sym: '▲' },
  warning: { cls: 'warn', label: 'Avertissement', col: 'var(--warning)', sym: '▲' },
  info: { cls: 'mute', label: 'Info', col: 'var(--baseline)', sym: 'ℹ' },
}

const ST_META: Record<DeviceStatus, [string, string]> = {
  ok: ['ok', '● En ligne'],
  warn: ['warn', '▲ Avertissement'],
  crit: ['crit', '✕ Hors ligne'],
  mute: ['mute', '— Veille'],
}

function NoSource({ what, need }: { what: string; need: string }) {
  return (
    <div className="pp-empty no-source">
      <b>Aucun {what} connecté.</b>
      <br />
      {need}
    </div>
  )
}

export default function Overview() {
  const snap = useSnapshot()
  const { kpis } = snap
  const [wanColors, setWanColors] = useState(['#2a78d6', '#eb6834', '#1baf7a'])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

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
        <h1>Vue d'ensemble</h1>
        <p>État du réseau — actualisé toutes les 3 s</p>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="k-label">Clients connectés</div>
          {snap.aps_live ? (
            <>
              <div className="k-value">{fmt(kpis.clients_total)}</div>
              <div className="k-sub">
                Staff {kpis.clients_staff} · Members {kpis.clients_members} · Invités {kpis.clients_guests}
              </div>
              <div className="kpi-spark">
                <Sparkline data={clientTrend} w={110} h={26} color={wanColors[0]} fill />
              </div>
            </>
          ) : (
            <>
              <div className="k-value k-value-empty">—</div>
              <div className="k-sub">Aucun contrôleur WiFi connecté</div>
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="k-label">Bornes WiFi</div>
          {snap.aps_live ? (
            <>
              <div className="k-value">
                {kpis.aps_up}
                <small> / {kpis.aps_total} en ligne</small>
              </div>
              <div className="k-sub">Aironet 2800 / 1562 · WLC 3504</div>
            </>
          ) : (
            <>
              <div className="k-value k-value-empty">—</div>
              <div className="k-sub">Aucun contrôleur WiFi connecté</div>
            </>
          )}
        </div>
        <div className={`card kpi${snap.alerts_live && kpis.alerts_critical > 0 ? ' crit' : ''}`}>
          <div className="k-label">Alertes actives</div>
          {snap.alerts_live ? (
            <>
              <div className="k-value">{kpis.alerts_active}</div>
              <div className="k-sub">
                {kpis.alerts_active
                  ? `${kpis.alerts_critical} critique${kpis.alerts_critical > 1 ? 's' : ''} · ${kpis.alerts_active - kpis.alerts_critical} avertissement${kpis.alerts_active - kpis.alerts_critical > 1 ? 's' : ''}`
                  : 'Aucune alerte active'}
              </div>
            </>
          ) : (
            <>
              <div className="k-value k-value-empty">—</div>
              <div className="k-sub">Aucun Zabbix connecté</div>
            </>
          )}
        </div>
        <div className="card kpi">
          <div className="k-label">Budget PoE utilisé {snap.switches.some((s) => s.live) && <span className="k-live">LIVE</span>}</div>
          <div className="k-value">
            {kpis.poe_watts}
            <small> W · {Math.round((kpis.poe_watts / kpis.poe_budget) * 100)}%</small>
          </div>
          <div className="k-sub">sur {fmt(kpis.poe_budget)} W (2 × Catalyst 3650)</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-h">
            <b>Clients par SSID</b>
            <span className="sub">dernières 24 heures</span>
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
              <NoSource what="contrôleur WiFi" need="Connecte un WLC (SNMP) pour voir le trafic client par SSID." />
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-h">
            <b>Alertes actives</b>
            {snap.alerts_live && <span className="pill live">● LIVE — Zabbix</span>}
            {snap.alerts_live && <span className="sub">{activeAlerts} non acquittée{activeAlerts > 1 ? 's' : ''}</span>}
          </div>
          {snap.alerts_live ? (
            <div className="alert-list">
              {snap.alerts.length === 0 && (
                <div className="pp-empty">Aucune alerte active. Tout est nominal.</div>
              )}
              {snap.alerts.map((a) => {
                const m = SEV_META[a.sev]
                return (
                  <div className={`alert ${m.cls} ${a.acked ? 'acked' : ''}`} key={a.id}>
                    <span className="stripe" style={{ background: m.col }} />
                    <div className="body">
                      <div className="msg">{a.msg}</div>
                      <div className="meta">
                        <span className={`pill ${m.cls}`}>{m.sym} {m.label}</span> · {a.src} · depuis {sinceLabel(a.since)}
                      </div>
                    </div>
                    <button className="ack" onClick={() => api.ackAlert(a.id).catch(() => {})}>
                      {a.acked ? 'Acquittée' : 'Acquitter'}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="card-b">
              <NoSource what="Zabbix" need="Connecte Zabbix (jeton API) pour voir les vraies alertes ici." />
            </div>
          )}
        </div>
      </div>

      {snap.alerts_live && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <b>Métriques en direct</b>
            <span className="pill live">● LIVE — Zabbix</span>
            <span className="sub">CPU, mémoire, trafic — historique réel, sans passer par l'UI Zabbix</span>
          </div>
          <div className="card-b">
            {snap.zabbix_metrics.length === 0 ? (
              <div className="pp-empty">
                Zabbix est connecté mais ne remonte pas encore d'historique numérique exploitable
                (aucun item avec suffisamment de points collectés).
              </div>
            ) : (
              Object.entries(
                snap.zabbix_metrics.reduce<Record<string, typeof snap.zabbix_metrics>>((acc, m) => {
                  (acc[m.host] ??= []).push(m)
                  return acc
                }, {}),
              ).map(([host, metrics]) => {
                const g = groupHostMetrics(host, metrics)
                const isOpen = !!expanded[host]
                return (
                  <div key={host} style={{ marginBottom: 18 }}>
                    <div className="nav-label" style={{ padding: '0 2px 8px' }}>{host}</div>
                    <div className="kpis" style={{ marginBottom: 0 }}>
                      {[
                        { m: g.cpu, label: 'CPU', color: wanColors[0] },
                        { m: g.mem, label: 'Mémoire', color: wanColors[1] },
                        { m: g.temp, label: 'Température max', color: wanColors[2] },
                        { m: g.latency, label: 'Latence ping', color: wanColors[0] },
                      ].filter((x) => x.m).map(({ m, label, color }) => {
                        const values = m!.values.filter((v): v is number => v !== null)
                        const last = values[values.length - 1]
                        return (
                          <div className="card kpi" key={label}>
                            <div className="k-label">{label}</div>
                            <div className="k-value">
                              {last}<small>{m!.unit}</small>
                            </div>
                            <div className="k-sub">{m!.name}</div>
                            {values.length >= 2 && (
                              <div className="kpi-spark">
                                <Sparkline data={values.slice(-30)} w={90} h={24} color={color} fill />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {g.rest.length > 0 && (
                      <>
                        <button
                          className="btn ghost"
                          style={{ marginTop: 10, padding: '3px 10px', fontSize: 11.5 }}
                          onClick={() => setExpanded((s) => ({ ...s, [host]: !s[host] }))}
                        >
                          {isOpen ? 'Réduire' : `+ ${g.rest.length} autre${g.rest.length > 1 ? 's' : ''} métrique${g.rest.length > 1 ? 's' : ''}`}
                        </button>
                        {isOpen && (
                          <div className="metric-grid">
                            {g.rest.map((m, i) => (
                              <div key={m.name}>
                                <div className="nav-label" style={{ padding: '0 0 4px' }}>{m.name}</div>
                                <MetricChart t={m.t} values={m.values} unit={m.unit} color={wanColors[i % wanColors.length]} />
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <b>Équipements</b>
            <span className="sub">{snap.devices.filter((d) => !hiddenGroups.has(d.grp)).length} hôtes supervisés</span>
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
                            : <span className="pill mute" style={{ marginLeft: 'auto' }} title="Simulé — aucune source de supervision réelle branchée pour cet équipement">SIM</span>}
                        </div>
                        <div className="metrics">
                          <span>{d.kind}</span>
                          <span>{d.metric}</span>
                          <span className={`pill ${cls}`}>{label}</span>
                        </div>
                        {cpuTrend.length >= 2 && (
                          <div className="dev-spark" title="Tendance CPU">
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
                <NoSource what="WLC" need="L'inventaire des bornes nécessite une connexion au contrôleur WiFi." />
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>WAN &amp; redondance</b>
            {snap.wan_live && <span className="sub">latence sur 15 min</span>}
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
                    {w.latency[w.latency.length - 1]} ms · gigue {w.jitter.toLocaleString('fr-FR')} ms
                  </span>
                  <Sparkline data={w.latency.slice(-30)} w={150} h={34} color={wanColors[i % 3]} fill />
                </div>
              ))}
            </div>
          ) : (
            <div className="card-b">
              <NoSource what="supervision WAN" need="Aucune sonde/gabarit Zabbix branché sur les liens WAN pour l'instant." />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
