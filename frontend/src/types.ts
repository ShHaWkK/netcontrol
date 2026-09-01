export type Severity = 'critical' | 'serious' | 'warning' | 'info'
export type PortState = 'up' | 'down' | 'err'
export type DeviceStatus = 'ok' | 'warn' | 'crit' | 'mute'
export type LogType = 'syslog' | 'alerte' | 'audit'
export type SsidKey = 'staff' | 'members' | 'guests'
export type MetricKey = 'clients' | 'util' | 'noise' | 'rssi'

export interface SsidClients {
  staff: number
  members: number
  guests: number
}

export interface Ap {
  id: string
  model: string
  x: number
  y: number
  room: string
  down: boolean
  hot: boolean
  clients: SsidClients
  util: number
  noise: number
  rssi: number
}

export interface Room {
  x: number
  y: number
  w: number
  h: number
  label: string
  out: boolean
}

export interface Port {
  id: string
  n: number
  state: PortState
  vlan: number
  desc: string
  poe: number
  err: number
  protected: boolean
}

export interface SfpPort {
  id: string
  desc: string
  state: PortState
  protected: boolean
}

export interface SwitchHistory {
  t: string[]
  cpu: (number | null)[]
  temp: (number | null)[]
  poe: number[]
}

export interface Switch {
  name: string
  model: string
  ip: string
  loc: string
  ports: Port[]
  sfp: SfpPort[]
  live: boolean
  vlans: Vlan[]
  history: SwitchHistory
}

export interface Alert {
  id: number
  sev: Severity
  msg: string
  src: string
  since: string
  acked: boolean
}

export interface LogEntry {
  id: number
  t: string
  type: LogType
  sev: Severity
  src: string
  msg: string
}

export interface Device {
  grp: string
  name: string
  kind: string
  st: DeviceStatus
  metric: string
}

export interface WanLink {
  name: string
  sub: string
  latency: number[]
  jitter: number
  loss: string
}

export interface Kpis {
  clients_total: number
  clients_staff: number
  clients_members: number
  clients_guests: number
  aps_up: number
  aps_total: number
  alerts_active: number
  alerts_critical: number
  poe_watts: number
  poe_budget: number
}

export interface SsidHistory {
  t: string[]
  staff: number[]
  members: number[]
  guests: number[]
}

export interface Snapshot {
  mode: string
  site_name: string
  site_location: string
  operator: string
  kpis: Kpis
  aps: Ap[]
  aps_live: boolean
  rooms: Room[]
  devices: Device[]
  wan: WanLink[]
  wan_live: boolean
  switches: Switch[]
  alerts: Alert[]
  alerts_live: boolean
  logs: LogEntry[]
  ssid_history: SsidHistory
}

export interface CliPreview {
  target: string
  ip: string
  summary: string
  lines: string[]
}

export interface SwitchInventoryEntry {
  host: string
  device_type: string
  connected: boolean
  name: string | null
  from_env: boolean
}

export interface PortConfigRequest {
  action: 'config' | 'poe' | 'shut' | 'noshut'
  vlan?: number
  desc?: string
}

export const SSID_NAMES: Record<SsidKey, string> = {
  staff: 'IOC-Staff',
  members: 'IOC-Members',
  guests: 'IOC-Guests',
}

export interface Vlan {
  id: number
  name: string
}

export const VLANS: Vlan[] = [
  { id: 10, name: 'IOC-Staff' },
  { id: 20, name: 'IOC-Members' },
  { id: 30, name: 'IOC-Guests' },
  { id: 40, name: 'Imprimantes' },
  { id: 50, name: 'Visio' },
  { id: 99, name: 'Management' },
]

export interface PortProfile {
  name: string
  vlan: number
  desc_prefix: string
  extra: string[]
}

export const PROFILES: PortProfile[] = [
  { name: 'Access point', vlan: 99, desc_prefix: 'AP-', extra: ['switchport port-security maximum 1'] },
  { name: 'Printer', vlan: 40, desc_prefix: 'MFP-', extra: ['switchport port-security maximum 1'] },
  { name: 'Video conf', vlan: 50, desc_prefix: 'VISIO-', extra: ['switchport port-security maximum 2'] },
  { name: 'Wired station', vlan: 10, desc_prefix: 'LAN-', extra: [] },
]

/** Réponse de GET /api/meta — vlans/profiles réels si un switch live existe,
 * simulés sinon (voir backend/app/providers/hybrid.py::get_vlans). */
export interface Meta {
  mode: string
  site_name: string
  site_location: string
  operator: string
  vlans: Vlan[]
  profiles: PortProfile[]
}
