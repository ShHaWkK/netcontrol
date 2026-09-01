import type { Alert, Ap, CliPreview, PortConfigRequest, SwitchInventoryEntry } from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `Erreur API ${res.status}`)
  }
  return res.json()
}

export const api = {
  ackAlert: (id: number) => request<Alert>(`/api/alerts/${id}/ack`, { method: 'POST' }),
  setApPosition: (id: string, x: number, y: number) =>
    request<Ap>(`/api/aps/${encodeURIComponent(id)}/position`, {
      method: 'PUT',
      body: JSON.stringify({ x, y }),
    }),
  previewPort: (sw: string, n: number, req: PortConfigRequest) =>
    request<CliPreview>(`/api/switches/${encodeURIComponent(sw)}/ports/${n}/preview`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  applyPort: (sw: string, n: number, req: PortConfigRequest) =>
    request<CliPreview>(`/api/switches/${encodeURIComponent(sw)}/ports/${n}/apply`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  previewVlan: (sw: string, id: number, name: string) =>
    request<CliPreview>(`/api/switches/${encodeURIComponent(sw)}/vlans/preview`, {
      method: 'POST',
      body: JSON.stringify({ id, name }),
    }),
  applyVlan: (sw: string, id: number, name: string) =>
    request<CliPreview>(`/api/switches/${encodeURIComponent(sw)}/vlans/apply`, {
      method: 'POST',
      body: JSON.stringify({ id, name }),
    }),
  listSwitches: () => request<SwitchInventoryEntry[]>('/api/admin/switches'),
  addSwitch: (entry: {
    host: string
    device_type: string
    username?: string
    password?: string
    secret?: string
  }) => request<{ connected: boolean }>('/api/admin/switches', {
    method: 'POST',
    body: JSON.stringify(entry),
  }),
  removeSwitch: (host: string) =>
    request<{ removed: boolean }>(`/api/admin/switches/${encodeURIComponent(host)}`, { method: 'DELETE' }),
  zabbixStatus: () => request<{ configured: boolean; connected: boolean; url: string | null }>('/api/admin/zabbix'),
  connectZabbix: (cfg: { url: string; token?: string; username?: string; password?: string }) =>
    request<{ connected: boolean }>('/api/admin/zabbix', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  disconnectZabbix: () => request<{ removed: boolean }>('/api/admin/zabbix', { method: 'DELETE' }),
}
