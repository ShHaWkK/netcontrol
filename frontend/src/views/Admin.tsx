import { useEffect, useState } from 'react'
import { api } from '../api'
import { showToast } from '../toast'
import type { SwitchInventoryEntry } from '../types'

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

  const refresh = () => api.listSwitches().then(setSwitches).catch(() => setSwitches([]))

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [])

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
    </section>
  )
}
