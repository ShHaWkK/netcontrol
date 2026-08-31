import { useEffect, useState } from 'react'
import { api } from '../api'
import { showToast } from '../toast'
import type { SwitchInventoryEntry } from '../types'

interface ZabbixStatus {
  configured: boolean
  connected: boolean
  url: string | null
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

  const [zbx, setZbx] = useState<ZabbixStatus | null>(null)
  const [zbxUrl, setZbxUrl] = useState('')
  const [zbxAuthMode, setZbxAuthMode] = useState<'token' | 'password'>('token')
  const [zbxToken, setZbxToken] = useState('')
  const [zbxUser, setZbxUser] = useState('')
  const [zbxPass, setZbxPass] = useState('')
  const [zbxConnecting, setZbxConnecting] = useState(false)

  const refresh = () => api.listSwitches().then(setSwitches).catch(() => setSwitches([]))
  const refreshZabbix = () => api.zabbixStatus().then(setZbx).catch(() => setZbx(null))

  useEffect(() => {
    refresh()
    refreshZabbix()
    const id = setInterval(() => { refresh(); refreshZabbix() }, 5000)
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
        showToast('Zabbix connected', zbxUrl, 'success')
        setZbxToken(''); setZbxUser(''); setZbxPass('')
        refreshZabbix()
      })
      .catch((e) => showToast('Zabbix connection failed', e.message, 'error'))
      .finally(() => setZbxConnecting(false))
  }

  const disconnectZabbix = () => {
    api
      .disconnectZabbix()
      .then(() => { showToast('Zabbix disconnected', '', 'success'); setZbxUrl(''); refreshZabbix() })
      .catch((e) => showToast('Failed', e.message, 'error'))
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
        showToast('Switch connected', host, 'success')
        setHost(''); setUsername(''); setPassword(''); setSecret('')
        refresh()
      })
      .catch((e) => showToast('Connection failed', e.message, 'error'))
      .finally(() => setAdding(false))
  }

  const removeSwitch = (h: string) => {
    setRemoving(h)
    api
      .removeSwitch(h)
      .then(() => {
        showToast('Switch removed', h, 'success')
        refresh()
      })
      .catch((e) => showToast('Removal failed', e.message, 'error'))
      .finally(() => setRemoving(null))
  }

  return (
    <section>
      <div className="view-head">
        <h1>Admin</h1>
        <p>Manage the real switch fleet — no restart needed</p>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-h">
            <b>Add a switch</b>
            <span className="sub">Connects immediately, saved for next restart</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label htmlFor="aHost">Management IP</label>
              <input id="aHost" type="text" placeholder="10.1.10.40" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aType">Device type</label>
              <select id="aType" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
                {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="aUser">Username <small style={{ fontWeight: 400 }}>(blank = fleet default)</small></label>
              <input id="aUser" type="text" placeholder="admin" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aPass">Password <small style={{ fontWeight: 400 }}>(blank = fleet default)</small></label>
              <input id="aPass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="aSecret">Enable secret <small style={{ fontWeight: 400 }}>(blank = same as password)</small></label>
              <input id="aSecret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
            <button className="btn primary" disabled={adding || !host.trim()} onClick={addSwitch}>
              {adding ? 'Connecting…' : 'Add & connect'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <b>Switch fleet</b>
            <span className="sub">{switches?.length ?? 0} configured</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {switches === null && <div className="pp-empty">Loading…</div>}
            {switches?.length === 0 && <div className="pp-empty">No switch configured yet.</div>}
            {switches?.map((s) => (
              <div className="topo-link" key={s.host}>
                <span className="topo-port">{s.host}</span>
                {s.connected
                  ? <span className="pill live">● LIVE</span>
                  : <span className="pill crit">✕ unreachable</span>}
                <span className="topo-neighbor external">{s.device_type}</span>
                {s.from_env && <span className="pill mute" title="Configured in backend/.env">.env</span>}
                <button
                  className="btn ghost"
                  style={{ marginLeft: 'auto', color: 'var(--critical)' }}
                  disabled={removing === s.host}
                  onClick={() => removeSwitch(s.host)}
                >
                  {removing === s.host ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-h">
            <b>Zabbix</b>
            <span className="sub">Real alerts &amp; metrics — no restart needed</span>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {zbx?.connected ? (
              <>
                <div className="pp-id">
                  <b>{zbx.url}</b>
                  <span className="pill live">● LIVE</span>
                </div>
                <button className="btn ghost" style={{ color: 'var(--critical)', alignSelf: 'flex-start' }} onClick={disconnectZabbix}>
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="zUrl">Zabbix URL</label>
                  <input
                    id="zUrl" type="text" placeholder="http://zabbix-web:8080" value={zbxUrl}
                    onChange={(e) => setZbxUrl(e.target.value)}
                  />
                  <small style={{ color: 'var(--muted)', display: 'block', marginTop: 4 }}>
                    If Zabbix runs in this same docker-compose, use the service name
                    (<code>http://zabbix-web:8080</code>), not the host IP/published port —
                    the backend reaches it on the internal Docker network.
                  </small>
                </div>
                <div className="seg" role="group" aria-label="Auth mode" style={{ alignSelf: 'flex-start' }}>
                  <button className={zbxAuthMode === 'token' ? 'active' : ''} onClick={() => setZbxAuthMode('token')}>API token</button>
                  <button className={zbxAuthMode === 'password' ? 'active' : ''} onClick={() => setZbxAuthMode('password')}>User / password</button>
                </div>
                {zbxAuthMode === 'token' ? (
                  <div className="field">
                    <label htmlFor="zTok">API token</label>
                    <input id="zTok" type="password" value={zbxToken} onChange={(e) => setZbxToken(e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="zUser">Username</label>
                      <input id="zUser" type="text" value={zbxUser} onChange={(e) => setZbxUser(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="zPass">Password</label>
                      <input id="zPass" type="password" value={zbxPass} onChange={(e) => setZbxPass(e.target.value)} />
                    </div>
                  </>
                )}
                <button className="btn primary" disabled={zbxConnecting || !zbxUrl.trim()} onClick={connectZabbix}>
                  {zbxConnecting ? 'Connecting…' : 'Connect'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
