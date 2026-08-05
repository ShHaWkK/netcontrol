import type { Alert, Ap, CliPreview, PortConfigRequest } from './types'

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
}
