import { useEffect, useState } from 'react'
import { api } from '../api'
import MetricChart from '../components/MetricChart'
import { consumePendingSelection } from '../nav'
import { useSnapshot, useStore } from '../store'
import { showToast } from '../toast'
import type { CliPreview, Port, PortConfigRequest, SfpPort, Switch, ZabbixMetric } from '../types'
import { PROFILES as SIM_PROFILES, VLANS as SIM_VLANS } from '../types'
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
  const { meta } = useStore()
  const [sel, setSel] = useState<Selection | null>(null)
  const [vlan, setVlan] = useState<number>(10)
  const [desc, setDesc] = useState('')
  const [preview, setPreview] = useState<{ cli: CliPreview; req: PortConfigRequest } | null>(null)
  const [applying, setApplying] = useState(false)

  // Création de VLAN — formulaire ouvert pour au plus un switch à la fois
  const [addVlanFor, setAddVlanFor] = useState<string | null>(null)
  const [newVlanId, setNewVlanId] = useState('')
  const [newVlanName, setNewVlanName] = useState('')
  const [vlanPreview, setVlanPreview] = useState<{ cli: CliPreview; swName: string; id: number; name: string } | null>(null)
  const [vlanApplying, setVlanApplying] = useState(false)

  // Trafic réel (bits reçus/envoyés) du port sélectionné — récupéré à la
  // demande depuis Zabbix, jamais poussé pour tous les ports en continu.
  const [traffic, setTraffic] = useState<Partial<Record<'received' | 'sent', ZabbixMetric>> | null>(null)

  // arrivée depuis "Fix in Switch Manager" sur la Heatmap : pré-sélectionne
  // le port concerné dès le montage, pour résoudre l'incident en un clic.
  useEffect(() => {
    const pending = consumePendingSelection()
    if (pending) setSel(pending)
  }, [])

  const sw = sel ? snap.switches.find((s) => s.name === sel.swName) : null
  const port: Port | null = sel && sw && sel.n > 0 ? sw.ports[sel.n - 1] : null
  const sfp: SfpPort | null = sel && sw && sel.n < 0 ? sw.sfp[-sel.n - 1] : null
  // Chaque switch réel porte SES PROPRES VLANs (sw.vlans, lus sur ce switch
  // précis) — jamais de liste globale partagée entre switchs, sinon les
  // VLANs d'un switch s'affichent (et s'écrasent en cas de collision d'ID)
  // sur un autre.
  const VLANS = sw?.live ? sw.vlans : SIM_VLANS
  // Les profils rapides (mapping VLAN "Access point"/"Printer"...) sont
  // propres au scénario Dakar simulé : sans objet sur un switch réel arbitraire.
  const PROFILES = sw?.live ? [] : (meta?.profiles ?? SIM_PROFILES)

  // resynchronise le formulaire quand on change de port
  useEffect(() => {
    if (port) {
      setVlan(port.vlan)
      setDesc(port.desc)
    }
  }, [sel?.swName, sel?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  // trafic réel du port — uniquement pour un port régulier d'un switch live
  useEffect(() => {
    setTraffic(null)
    if (!sel || sel.n <= 0 || !sw?.live) return
    let cancelled = false
    api.portTraffic(sw.name, sel.n).then((t) => { if (!cancelled) setTraffic(t) }).catch(() => {})
    return () => { cancelled = true }
  }, [sel?.swName, sel?.n, sw?.live]) // eslint-disable-line react-hooks/exhaustive-deps

  const openPreview = (action: PortConfigRequest['action']) => {
    if (!sel || !sw) return
    const req: PortConfigRequest =
      action === 'config' ? { action, vlan, desc } : { action }
    api
      .previewPort(sw.name, sel.n, req)
      .then((cli) => setPreview({ cli, req }))
      .catch((e) => showToast('Échec du preview', e.message, 'error'))
  }

  const apply = () => {
    if (!sel || !sw || !preview) return
    setApplying(true)
    api
      .applyPort(sw.name, sel.n, preview.req)
      .then((cli) => {
        showToast(
          sw.live ? 'Envoyé au switch réel' : 'Configuration appliquée (simulation)',
          `${cli.summary} — ${sw.name}`,
          'success',
        )
        setPreview(null)
      })
      .catch((e) =>
        showToast(
          sw.live ? 'Échec de l\'envoi au switch — rien n\'a changé' : 'Échec de l\'application',
          e.message,
          'error',
        ),
      )
      .finally(() => setApplying(false))
  }

  const previewNewVlan = (swName: string) => {
    const id = parseInt(newVlanId, 10)
    if (!id || id < 1 || id > 4094 || !newVlanName.trim()) {
      showToast('VLAN invalide', "L'ID doit être entre 1 et 4094 et le nom ne peut pas être vide", 'error')
      return
    }
    api
      .previewVlan(swName, id, newVlanName.trim())
      .then((cli) => setVlanPreview({ cli, swName, id, name: newVlanName.trim() }))
      .catch((e) => showToast('Échec du preview', e.message, 'error'))
  }

  const applyNewVlan = () => {
    if (!vlanPreview) return
    setVlanApplying(true)
    api
      .applyVlan(vlanPreview.swName, vlanPreview.id, vlanPreview.name)
      .then((cli) => {
        showToast('VLAN créé sur le switch réel', `${cli.summary} — ${vlanPreview.swName}`, 'success')
        setVlanPreview(null)
        setAddVlanFor(null)
        setNewVlanId('')
        setNewVlanName('')
      })
      .catch((e) => showToast('Échec de création du VLAN — rien n\'a changé', e.message, 'error'))
      .finally(() => setVlanApplying(false))
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
          {s.live && <span className="pill live">● LIVE</span>}
          <span className="sub">{s.model} · {s.ip} · {s.loc}</span>
          <span className="pill ok" style={{ marginLeft: 'auto' }}>● {up} ports actifs</span>
          <span className="pill mute">PoE {poe} W / 720 W</span>
          {s.live && (
            <button
              className="btn ghost"
              style={{ padding: '2px 9px', fontSize: 11.5 }}
              onClick={() => setAddVlanFor(addVlanFor === s.name ? null : s.name)}
            >
              {addVlanFor === s.name ? 'Annuler' : '+ VLAN'}
            </button>
          )}
        </div>
        {addVlanFor === s.name && (
          <div className="fp-vlan-form">
            <input
              type="number" min={1} max={4094} placeholder="ID VLAN (ex: 40)"
              style={{ width: 140 }} value={newVlanId} onChange={(e) => setNewVlanId(e.target.value)}
            />
            <input
              type="text" placeholder="Nom (ex: GUEST_WIFI)"
              style={{ width: 200 }} value={newVlanName} onChange={(e) => setNewVlanName(e.target.value)}
            />
            <button className="btn primary" onClick={() => previewNewVlan(s.name)}>Preview</button>
          </div>
        )}
        <div className="fp-scroll">
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
        {s.live && s.history.t.length >= 2 && (
          <div className="metric-grid">
            <div>
              <div className="nav-label" style={{ padding: '10px 0 4px' }}>CPU</div>
              <MetricChart t={s.history.t} values={s.history.cpu} unit="%" color="var(--s1)" min={0} max={100} />
            </div>
            <div>
              <div className="nav-label" style={{ padding: '10px 0 4px' }}>Température</div>
              <MetricChart t={s.history.t} values={s.history.temp} unit="°C" color="var(--s2)" />
            </div>
            <div>
              <div className="nav-label" style={{ padding: '10px 0 4px' }}>Consommation PoE</div>
              <MetricChart t={s.history.t} values={s.history.poe} unit=" W" color="var(--s3)" min={0} />
            </div>
          </div>
        )}
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
        <h1>Gestion switchs</h1>
        <p>Configuration des ports sans SSH — preview avant d'appliquer</p>
      </div>

      {snap.switches.length === 0 ? (
        <div className="card">
          <div className="card-b">
            <div className="pp-empty no-source" style={{ padding: '48px 20px' }}>
              <b>Aucun switch connecté.</b>
              <br />
              Ajoutes-en un depuis l'onglet <b>Admin</b> — la connexion est immédiate, pas besoin de redémarrer.
            </div>
          </div>
        </div>
      ) : (
      <div className="sw-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card faceplate">
            {snap.switches.map((s, i) => renderFaceplate(s, i))}
          </div>
          <div className="fp-legend" style={{ padding: '0 4px' }}>
            <span><i className="up" />Actif</span>
            <span><i />Inactif</span>
            <span><i className="err" />err-disabled</span>
            <span><i className="prot" />Protégé — lecture seule</span>
          </div>
        </div>

        <div className="card port-panel">
          <div className="card-h">
            <b>Détails du port</b>
            <span className="sub">{sw?.name ?? ''}</span>
          </div>
          <div className="card-b">
            {!sel && (
              <div className="pp-empty">
                Sélectionne un port sur la faceplate
                <br />
                pour voir ses détails et le configurer.
              </div>
            )}

            {sfp && sw && (
              <>
                <div className="pp-id">
                  <b>{sfp.id}</b>
                  {sfp.state === 'up'
                    ? <span className="pill ok">● actif</span>
                    : <span className="pill mute">— inactif</span>}
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
                  <span className="v">{port.vlan === 0 ? 'trunk (multi-VLAN)' : vlanLabel(VLANS, port.vlan)}</span>
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
                  <span className="l">Consommation PoE</span>
                  <span className="v">{port.poe ? `${port.poe.toFixed(1)} W` : '—'}</span>
                  <span className="l">Erreurs (in/out)</span>
                  <span className="v">{port.err || 0}</span>
                  <span className="l">Dernier changement</span>
                  <span className="v">{sw.live ? '—' : minutesAgo(12 + port.n)}</span>
                  <span className="l">Trafic</span>
                  <span className="v">
                    {sw.live ? '—' : port.state === 'up' ? `${2 + (port.n % 9)}.${port.n % 10} Mb/s` : '—'}
                  </span>
                </div>
                {sw.live && (traffic?.received || traffic?.sent) && (
                  <div className="metric-grid" style={{ marginBottom: 12 }}>
                    {traffic.received && (
                      <div>
                        <div className="nav-label" style={{ padding: '0 0 4px' }}>Trafic entrant</div>
                        <MetricChart t={traffic.received.t} values={traffic.received.values} unit={traffic.received.unit} color="var(--s1)" min={0} />
                      </div>
                    )}
                    {traffic.sent && (
                      <div>
                        <div className="nav-label" style={{ padding: '0 0 4px' }}>Trafic sortant</div>
                        <MetricChart t={traffic.sent.t} values={traffic.sent.values} unit={traffic.sent.unit} color="var(--s2)" min={0} />
                      </div>
                    )}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="fVlan">VLAN d'accès</label>
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
                    placeholder="ex: VISIO-MR2"
                    onChange={(e) => setDesc(e.target.value)}
                  />
                </div>
                {PROFILES.length > 0 && (
                <div className="field">
                  <label>Profils rapides</label>
                  <div className="profiles">
                    {PROFILES.map((p) => (
                      <button key={p.name} onClick={() => applyProfile(p.name)}>{p.name}</button>
                    ))}
                  </div>
                </div>
                )}
                <div className="btn-row">
                  <button className="btn" onClick={() => openPreview('poe')}>↻ Redémarrer PoE</button>
                  <button className="btn" onClick={() => openPreview(port.state === 'down' ? 'noshut' : 'shut')}>
                    {port.state === 'down' ? 'Activer' : 'Désactiver'}
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
      )}

      {preview && (
        <div
          className="modal-bg"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setPreview(null)}
        >
          <div className="modal">
            <div className="card-h">
              <b>Preview des commandes</b>
              <span className="sub">{preview.cli.target} · {preview.cli.ip}</span>
            </div>
            <div className="card-b">
              <div className="pp-empty" style={{ padding: '6px 2px 14px', textAlign: 'left' }}>
                Rien n'a encore été envoyé au switch. Vérifie les commandes ci-dessous, puis clique
                <b> Apply</b> pour les appliquer réellement.
              </div>
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
              <button className="btn ghost" onClick={() => setPreview(null)} disabled={applying}>Annuler</button>
              <button className={`btn primary${sw?.live ? ' live' : ''}`} autoFocus disabled={applying} onClick={apply}>
                {applying
                  ? (sw?.live ? 'Envoi au switch…' : 'Application…')
                  : `Apply${sw?.live ? ' — switch réel' : ' (simulation)'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {vlanPreview && (
        <div
          className="modal-bg"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setVlanPreview(null)}
        >
          <div className="modal">
            <div className="card-h">
              <b>Créer un VLAN — preview des commandes</b>
              <span className="sub">{vlanPreview.cli.target} · {vlanPreview.cli.ip}</span>
            </div>
            <div className="card-b">
              <div className="pp-empty" style={{ padding: '6px 2px 14px', textAlign: 'left' }}>
                Le VLAN n'existe pas encore sur le switch. Vérifie les commandes ci-dessous, puis clique
                <b> Apply — switch réel</b> pour le créer réellement.
              </div>
              <pre className="cli">
                {vlanPreview.cli.lines.map((line, i) => {
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
              <button className="btn ghost" onClick={() => setVlanPreview(null)} disabled={vlanApplying}>Annuler</button>
              <button className="btn primary live" autoFocus disabled={vlanApplying} onClick={applyNewVlan}>
                {vlanApplying ? 'Envoi au switch…' : 'Apply — switch réel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function StatePill({ state }: { state: Port['state'] }) {
  if (state === 'up') return <span className="pill ok">● actif</span>
  if (state === 'err') return <span className="pill crit">✕ err-disabled</span>
  return <span className="pill mute">— inactif</span>
}

function vlanLabel(vlans: { id: number; name: string }[], id: number): string {
  const v = vlans.find((x) => x.id === id)
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
        <b>Port protégé.</b> Les uplinks, le WLC et le serveur NetControl sont verrouillés en lecture seule —
        l'outil ne peut pas couper sa propre connectivité.
      </span>
    </div>
  )
}
