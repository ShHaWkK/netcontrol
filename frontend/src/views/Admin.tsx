import { useEffect, useState } from 'react'
import { api } from '../api'
import { showToast } from '../toast'
import type { SwitchInventoryEntry } from '../types'

interface ZabbixStatus {
  configured: boolean
  connected: boolean
  url: string | null
}

interface WlcStatus {
  configured: boolean
  connected: boolean
  host: string | null
  aps: { name: string; operational: boolean }[]
}

interface BulkResult {
  host: string
  connected: boolean
  error: string | null
}

interface WanTarget {
  name: string
  host: string
}

const DEVICE_TYPES = [
  { value: 'cisco_ios', label: 'Cisco IOS / IOS-XE' },
  { value: 'cisco_nxos', label: 'Cisco NX-OS' },
  { value: 'cisco_xr', label: 'Cisco IOS-XR' },
  { value: 'aruba_os', label: 'Aruba OS' },
  { value: 'juniper_junos', label: 'Juniper Junos' },
]

export default function Admin() {
  const [switches, setSwitches] = useState<SwitchInventoryEntry[] | null>(null)
  const [host, setHost] = useState('')
  const [deviceType, setDeviceType] = useState('cisco_ios')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkEntries, setBulkEntries] = useState('')
  const [bulkDeviceType, setBulkDeviceType] = useState('cisco_ios')
  const [bulkUser, setBulkUser] = useState('')
  const [bulkPass, setBulkPass] = useState('')
  const [bulkSecret, setBulkSecret] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null)

  const [zbx, setZbx] = useState<ZabbixStatus | null>(null)
  const [zbxUrl, setZbxUrl] = useState('')
  const [zbxAuthMode, setZbxAuthMode] = useState<'token' | 'password'>('token')
  const [zbxToken, setZbxToken] = useState('')
  const [zbxUser, setZbxUser] = useState('')
  const [zbxPass, setZbxPass] = useState('')
  const [zbxConnecting, setZbxConnecting] = useState(false)

  const [wlc, setWlc] = useState<WlcStatus | null>(null)
  const [wlcHost, setWlcHost] = useState('')
  const [wlcVersion, setWlcVersion] = useState<'2c' | '3'>('2c')
  const [wlcCommunity, setWlcCommunity] = useState('')
  const [wlcV3User, setWlcV3User] = useState('')
  const [wlcV3Auth, setWlcV3Auth] = useState('')
  const [wlcV3Priv, setWlcV3Priv] = useState('')
  const [wlcConnecting, setWlcConnecting] = useState(false)

  const [wanTargets, setWanTargets] = useState<WanTarget[] | null>(null)
  const [wanName, setWanName] = useState('')
  const [wanHost, setWanHost] = useState('')
  const [wanConnecting, setWanConnecting] = useState(false)
  const [wanRemoving, setWanRemoving] = useState<string | null>(null)

  const refresh = () => api.listSwitches().then(setSwitches).catch(() => setSwitches([]))
  const refreshZabbix = () => api.zabbixStatus().then(setZbx).catch(() => setZbx(null))
  const refreshWlc = () => api.wlcStatus().then(setWlc).catch(() => setWlc(null))
  const refreshWan = () => api.listWanTargets().then(setWanTargets).catch(() => setWanTargets([]))

  useEffect(() => {
    refresh()
    refreshZabbix()
    refreshWlc()
    refreshWan()
    const id = setInterval(() => { refresh(); refreshZabbix(); refreshWlc(); refreshWan() }, 5000)
    return () => clearInterval(id)
  }, [])

  const connectZabbix = () => {
    if (!zbxUrl.trim()) return
    setZbxConnecting(true)
    api
      .connectZabbix({
        url: zbxUrl.trim(),
        token: zbxAuthMode === 'token' ? zbxToken || undefined : undefined,
        username: zbxAuthMode === 'password' ? zbxUser || undefined : undefined,
        password: zbxAuthMode === 'password' ? zbxPass || undefined : undefined,
      })
      .then(() => {
        showToast('Zabbix connecté', zbxUrl, 'success')
        setZbxToken(''); setZbxUser(''); setZbxPass('')
        refreshZabbix()
      })
      .catch((e) => showToast('Échec de connexion Zabbix', e.message, 'error'))
      .finally(() => setZbxConnecting(false))
  }

  const disconnectZabbix = () => {
    api
      .disconnectZabbix()
      .then(() => { showToast('Zabbix déconnecté', '', 'success'); setZbxUrl(''); refreshZabbix() })
      .catch((e) => showToast('Échec', e.message, 'error'))
  }

  const addSwitch = () => {
    if (!host.trim()) return
    setAdding(true)
    api
      .addSwitch({
        host: host.trim(),
        device_type: deviceType,
        username: username.trim() || undefined,
        password: password || undefined,
        secret: secret || undefined,
      })
      .then(() => {
        showToast('Switch connecté', host, 'success')
        setHost(''); setUsername(''); setPassword(''); setSecret('')
        refresh()
      })
      .catch((e) => showToast('Échec de connexion', e.message, 'error'))
      .finally(() => setAdding(false))
  }

  const addSwitchesBulk = () => {
    if (!bulkEntries.trim()) return
    setBulkRunning(true)
    setBulkResults(null)
    api
      .addSwitchesBulk({
        entries: bulkEntries,
        device_type: bulkDeviceType,
        username: bulkUser.trim() || undefined,
        password: bulkPass || undefined,
        secret: bulkSecret || undefined,
      })
      .then((results) => {
        setBulkResults(results)
        const ok = results.filter((r) => r.connected).length
        showToast(`${ok}/${results.length} switch${results.length > 1 ? 's' : ''} connecté${ok > 1 ? 's' : ''}`, '', ok > 0 ? 'success' : 'error')
        refresh()
      })
      .catch((e) => showToast('Échec de l\'ajout en masse', e.message, 'error'))
      .finally(() => setBulkRunning(false))
  }

  const connectWlc = () => {
    if (!wlcHost.trim()) return
    setWlcConnecting(true)
    api
      .connectWlc({
        host: wlcHost.trim(),
        snmp_version: wlcVersion,
        community: wlcVersion === '2c' ? wlcCommunity || undefined : undefined,
        v3_user: wlcVersion === '3' ? wlcV3User || undefined : undefined,
        v3_auth_password: wlcVersion === '3' ? wlcV3Auth || undefined : undefined,
        v3_priv_password: wlcVersion === '3' ? wlcV3Priv || undefined : undefined,
      })
      .then(() => {
        showToast('WLC connecté', wlcHost, 'success')
        setWlcCommunity(''); setWlcV3Auth(''); setWlcV3Priv('')
        refreshWlc()
      })
      .catch((e) => showToast('Échec de connexion WLC', e.message, 'error'))
      .finally(() => setWlcConnecting(false))
  }

  const disconnectWlc = () => {
    api
      .disconnectWlc()
      .then(() => { showToast('WLC déconnecté', '', 'success'); setWlcHost(''); refreshWlc() })
      .catch((e) => showToast('Échec', e.message, 'error'))
  }

  const addWanTarget = () => {
    if (!wanName.trim() || !wanHost.trim()) return
    setWanConnecting(true)
    api
      .addWanTarget({ name: wanName.trim(), host: wanHost.trim() })
      .then(() => {
        showToast('Lien WAN connecté', wanName, 'success')
        setWanName(''); setWanHost('')
        refreshWan()
      })
      .catch((e) => showToast('Cible injoignable', e.message, 'error'))
      .finally(() => setWanConnecting(false))
  }

  const removeWanTarget = (name: string) => {
    setWanRemoving(name)
    api
      .removeWanTarget(name)
      .then(() => { showToast('Lien WAN retiré', name, 'success'); refreshWan() })
      .catch((e) => showToast('Échec du retrait', e.message, 'error'))
      .finally(() => setWanRemoving(null))
  }

  const removeSwitch = (h: string) => {
    setRemoving(h)
    api
      .removeSwitch(h)
      .then(() => {
        showToast('Switch retiré', h, 'success')
        refresh()
      })
      .catch((e) => showToast('Échec du retrait', e.message, 'error'))
      .finally(() => setRemoving(null))
  }

  return (
    <section>
      <div className="view-head">
        <h1>Admin</h1>
        <p>Gestion du parc de switchs réels — aucun redémarrage nécessaire</p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <b>Ajouter un switch</b>
            <span className="sub">Connexion immédiate, sauvegardé pour le prochain redémarrage</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label htmlFor="aHost">IP de management</label>
              <input id="aHost" type="text" placeholder="10.1.10.40" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aType">Type d'équipement</label>
              <select id="aType" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
                {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="aUser">Identifiant <small style={{ fontWeight: 400 }}>(vide = valeur par défaut du parc)</small></label>
              <input id="aUser" type="text" placeholder="admin" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aPass">Mot de passe <small style={{ fontWeight: 400 }}>(vide = valeur par défaut du parc)</small></label>
              <input id="aPass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aSecret">Enable secret <small style={{ fontWeight: 400 }}>(vide = identique au mot de passe)</small></label>
              <input id="aSecret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
            <button className="btn primary" disabled={adding || !host.trim()} onClick={addSwitch}>
              {adding ? 'Connexion…' : 'Ajouter & connecter'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>Parc de switchs</b>
            <span className="sub">{switches?.length ?? 0} configuré{(switches?.length ?? 0) > 1 ? 's' : ''}</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {switches === null && <div className="pp-empty">Chargement…</div>}
            {switches?.length === 0 && <div className="pp-empty">Aucun switch configuré pour l'instant.</div>}
            {switches?.map((s) => (
              <div className="topo-link" key={s.host}>
                <span className="topo-port">{s.host}</span>
                {s.connected
                  ? <span className="pill live">● LIVE</span>
                  : <span className="pill crit">✕ injoignable</span>}
                <span className="topo-neighbor external">{s.device_type}</span>
                {s.from_env && <span className="pill mute" title="Configuré dans backend/.env">.env</span>}
                <button
                  className="btn ghost"
                  style={{ marginLeft: 'auto', color: 'var(--critical)' }}
                  disabled={removing === s.host}
                  onClick={() => removeSwitch(s.host)}
                >
                  {removing === s.host ? 'Retrait…' : 'Retirer'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <b>Ajout en masse</b>
          <span className="sub">Plage d'IP ou liste collée — jusqu'à {100} switchs d'un coup, même identifiants pour tous</span>
          <button
            className="btn ghost"
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11.5 }}
            onClick={() => setBulkOpen((o) => !o)}
          >
            {bulkOpen ? 'Fermer' : 'Ouvrir'}
          </button>
        </div>
        {bulkOpen && (
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label htmlFor="bEntries">Hôtes (un par ligne)</label>
              <textarea
                id="bEntries"
                rows={5}
                placeholder={'10.1.10.30-10.1.10.60\n10.1.20.5\n10.1.20.10-40'}
                style={{ width: '100%', fontFamily: 'ui-monospace,monospace', fontSize: 12.5, resize: 'vertical' }}
                value={bulkEntries}
                onChange={(e) => setBulkEntries(e.target.value)}
              />
              <small style={{ color: 'var(--muted)', display: 'block', marginTop: 4 }}>
                Une IP par ligne, ou une plage (<code>10.1.10.30-60</code> ou <code>10.1.10.30-10.1.10.60</code>).
              </small>
            </div>
            <div className="field">
              <label htmlFor="bType">Type d'équipement</label>
              <select id="bType" value={bulkDeviceType} onChange={(e) => setBulkDeviceType(e.target.value)}>
                {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="bUser">Identifiant <small style={{ fontWeight: 400 }}>(vide = défaut du parc)</small></label>
                <input id="bUser" type="text" placeholder="admin" value={bulkUser} onChange={(e) => setBulkUser(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="bPass">Mot de passe <small style={{ fontWeight: 400 }}>(vide = défaut du parc)</small></label>
                <input id="bPass" type="password" value={bulkPass} onChange={(e) => setBulkPass(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="bSecret">Enable secret <small style={{ fontWeight: 400 }}>(vide = mot de passe)</small></label>
                <input id="bSecret" type="password" value={bulkSecret} onChange={(e) => setBulkSecret(e.target.value)} />
              </div>
            </div>
            <button className="btn primary" disabled={bulkRunning || !bulkEntries.trim()} onClick={addSwitchesBulk} style={{ alignSelf: 'flex-start' }}>
              {bulkRunning ? 'Connexion en cours…' : 'Connecter tout'}
            </button>
            {bulkResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {bulkResults.map((r) => (
                  <div className="topo-link" key={r.host}>
                    <span className="topo-port">{r.host}</span>
                    {r.connected
                      ? <span className="pill live">● connecté</span>
                      : <span className="pill crit" title={r.error ?? ''}>✕ échec</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <b>Zabbix</b>
            <span className="sub">Alertes &amp; métriques réelles — aucun redémarrage nécessaire</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {zbx?.connected ? (
              <>
                <div className="pp-id">
                  <b>{zbx.url}</b>
                  <span className="pill live">● LIVE</span>
                </div>
                <button className="btn ghost" style={{ color: 'var(--critical)', alignSelf: 'flex-start' }} onClick={disconnectZabbix}>
                  Déconnecter
                </button>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="zUrl">URL Zabbix</label>
                  <input
                    id="zUrl" type="text" placeholder="http://zabbix-web:8080" value={zbxUrl}
                    onChange={(e) => setZbxUrl(e.target.value)}
                  />
                  <small style={{ color: 'var(--muted)', display: 'block', marginTop: 4 }}>
                    Si Zabbix tourne dans ce même docker-compose, utilise le nom du service
                    (<code>http://zabbix-web:8080</code>), pas l'IP/port publié de l'hôte —
                    le backend l'atteint sur le réseau Docker interne.
                  </small>
                </div>
                <div className="seg" role="group" aria-label="Mode d'authentification" style={{ alignSelf: 'flex-start' }}>
                  <button className={zbxAuthMode === 'token' ? 'active' : ''} onClick={() => setZbxAuthMode('token')}>Jeton API</button>
                  <button className={zbxAuthMode === 'password' ? 'active' : ''} onClick={() => setZbxAuthMode('password')}>Identifiant / mot de passe</button>
                </div>
                {zbxAuthMode === 'token' ? (
                  <div className="field">
                    <label htmlFor="zTok">Jeton API</label>
                    <input id="zTok" type="password" value={zbxToken} onChange={(e) => setZbxToken(e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="zUser">Identifiant</label>
                      <input id="zUser" type="text" value={zbxUser} onChange={(e) => setZbxUser(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="zPass">Mot de passe</label>
                      <input id="zPass" type="password" value={zbxPass} onChange={(e) => setZbxPass(e.target.value)} />
                    </div>
                  </>
                )}
                <button className="btn primary" disabled={zbxConnecting || !zbxUrl.trim()} onClick={connectZabbix}>
                  {zbxConnecting ? 'Connexion…' : 'Connecter'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>Contrôleur WiFi (SNMP)</b>
            <span className="sub">Nom &amp; statut des bornes — aucun redémarrage nécessaire</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {wlc?.connected ? (
              <>
                <div className="pp-id">
                  <b>{wlc.host}</b>
                  <span className="pill live">● LIVE</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {wlc.aps.length === 0 && <div className="pp-empty">Aucune borne signalée par le contrôleur pour l'instant.</div>}
                  {wlc.aps.map((a) => (
                    <div className="topo-link" key={a.name}>
                      <span className="topo-port">{a.name}</span>
                      {a.operational
                        ? <span className="pill live">● associée</span>
                        : <span className="pill crit">✕ down</span>}
                    </div>
                  ))}
                </div>
                <button className="btn ghost" style={{ color: 'var(--critical)', alignSelf: 'flex-start' }} onClick={disconnectWlc}>
                  Déconnecter
                </button>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="wHost">IP du contrôleur</label>
                  <input
                    id="wHost" type="text" placeholder="10.1.10.60" value={wlcHost}
                    onChange={(e) => setWlcHost(e.target.value)}
                  />
                  <small style={{ color: 'var(--muted)', display: 'block', marginTop: 4 }}>
                    Doit être joignable depuis l'hôte Debian et avoir SNMP activé.
                  </small>
                </div>
                <div className="seg" role="group" aria-label="Version SNMP" style={{ alignSelf: 'flex-start' }}>
                  <button className={wlcVersion === '2c' ? 'active' : ''} onClick={() => setWlcVersion('2c')}>SNMPv2c</button>
                  <button className={wlcVersion === '3' ? 'active' : ''} onClick={() => setWlcVersion('3')}>SNMPv3</button>
                </div>
                {wlcVersion === '2c' ? (
                  <div className="field">
                    <label htmlFor="wCommunity">Communauté</label>
                    <input id="wCommunity" type="password" value={wlcCommunity} onChange={(e) => setWlcCommunity(e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="wV3User">Identifiant</label>
                      <input id="wV3User" type="text" value={wlcV3User} onChange={(e) => setWlcV3User(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="wV3Auth">Mot de passe auth</label>
                      <input id="wV3Auth" type="password" value={wlcV3Auth} onChange={(e) => setWlcV3Auth(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="wV3Priv">Mot de passe priv</label>
                      <input id="wV3Priv" type="password" value={wlcV3Priv} onChange={(e) => setWlcV3Priv(e.target.value)} />
                    </div>
                  </>
                )}
                <button className="btn primary" disabled={wlcConnecting || !wlcHost.trim()} onClick={connectWlc}>
                  {wlcConnecting ? 'Connexion…' : 'Connecter'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <b>Liens WAN</b>
          <span className="sub">Latence &amp; perte réelles (ping ICMP) — aucun redémarrage nécessaire</span>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {wanTargets === null && <div className="pp-empty">Chargement…</div>}
            {wanTargets?.length === 0 && <div className="pp-empty">Aucun lien WAN configuré pour l'instant.</div>}
            {wanTargets?.map((w) => (
              <div className="topo-link" key={w.name}>
                <span className="topo-port">{w.name}</span>
                <span className="topo-neighbor external">{w.host}</span>
                <button
                  className="btn ghost"
                  style={{ marginLeft: 'auto', color: 'var(--critical)' }}
                  disabled={wanRemoving === w.name}
                  onClick={() => removeWanTarget(w.name)}
                >
                  {wanRemoving === w.name ? 'Retrait…' : 'Retirer'}
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="wanName">Nom</label>
              <input id="wanName" type="text" placeholder="Sonatel — L1" value={wanName} onChange={(e) => setWanName(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="wanHost">Cible (IP ou nom d'hôte)</label>
              <input id="wanHost" type="text" placeholder="8.8.8.8" value={wanHost} onChange={(e) => setWanHost(e.target.value)} />
            </div>
            <button className="btn primary" disabled={wanConnecting || !wanName.trim() || !wanHost.trim()} onClick={addWanTarget}>
              {wanConnecting ? 'Connexion…' : 'Ajouter & connecter'}
            </button>
          </div>
          <small style={{ color: 'var(--muted)' }}>
            Ping la passerelle opérateur ou une IP publique fiable derrière chaque lien (ex : la passerelle WAN elle-même,
            ou 1.1.1.1 / 8.8.8.8 pour vérifier la sortie Internet).
          </small>
        </div>
      </div>
    </section>
  )
}
