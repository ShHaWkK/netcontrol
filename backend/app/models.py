from typing import Literal, Optional

from pydantic import BaseModel

Severity = Literal["critical", "serious", "warning", "info"]
PortState = Literal["up", "down", "err"]
DeviceStatus = Literal["ok", "warn", "crit", "mute"]
LogType = Literal["syslog", "alerte", "audit"]


class SsidClients(BaseModel):
    staff: int = 0
    members: int = 0
    guests: int = 0

    @property
    def total(self) -> int:
        return self.staff + self.members + self.guests


class Ap(BaseModel):
    id: str
    model: str
    x: float
    y: float
    room: str
    down: bool = False
    hot: bool = False
    clients: SsidClients = SsidClients()
    util: int = 0
    noise: int = -92
    rssi: int = -58


class Room(BaseModel):
    x: int
    y: int
    w: int
    h: int
    label: str
    out: bool = False


class Port(BaseModel):
    id: str
    n: int
    state: PortState = "down"
    vlan: int = 10
    desc: str = ""
    poe: float = 0.0
    err: int = 0
    protected: bool = False


class SfpPort(BaseModel):
    id: str
    desc: str = ""
    state: PortState = "down"
    protected: bool = True


class Vlan(BaseModel):
    id: int
    name: str


class SwitchHistory(BaseModel):
    """Séries temporelles réelles (jamais simulées) — un point par lecture
    effective du switch. Vide tant qu'il n'y a pas eu au moins 2 lectures."""
    t: list[str] = []
    cpu: list[Optional[int]] = []
    temp: list[Optional[int]] = []
    poe: list[float] = []


class Switch(BaseModel):
    name: str
    model: str
    ip: str
    loc: str
    ports: list[Port]
    sfp: list[SfpPort]
    live: bool = False  # True = données lues en direct sur le switch réel (Netmiko)
    cpu_pct: Optional[int] = None
    temp_c: Optional[int] = None
    uptime: Optional[str] = None
    vlans: list[Vlan] = []  # VLANs propres à CE switch — jamais fusionnés avec un autre
    history: SwitchHistory = SwitchHistory()


class Alert(BaseModel):
    id: int
    sev: Severity
    msg: str
    src: str
    since: str  # ISO 8601
    acked: bool = False


class LogEntry(BaseModel):
    id: int
    t: str  # ISO 8601
    type: LogType
    sev: Severity
    src: str
    msg: str


class Device(BaseModel):
    grp: str
    name: str
    kind: str
    st: DeviceStatus
    metric: str


class WanLink(BaseModel):
    name: str
    sub: str
    latency: list[int]
    jitter: float
    loss: str


class Kpis(BaseModel):
    clients_total: int
    clients_staff: int
    clients_members: int
    clients_guests: int
    aps_up: int
    aps_total: int
    alerts_active: int
    alerts_critical: int
    poe_watts: int
    poe_budget: int = 1440


class SsidHistory(BaseModel):
    t: list[str]
    staff: list[int]
    members: list[int]
    guests: list[int]


class ZabbixMetric(BaseModel):
    """Historique réel d'un item numérique Zabbix (CPU, mémoire, trafic
    interface...) — remplace le besoin d'ouvrir l'UI Zabbix pour voir un
    graphe : NetControl les affiche nativement dans son propre style."""
    host: str
    name: str
    unit: str = ""
    t: list[str] = []
    values: list[Optional[float]] = []


class Snapshot(BaseModel):
    """État complet poussé sur le WebSocket à chaque tick."""

    mode: str
    site_name: str
    site_location: str
    operator: str
    kpis: Kpis
    aps: list[Ap]
    aps_live: bool = False  # True = AP/heatmap lus en direct depuis un WLC (pas encore implémenté)
    rooms: list[Room]
    devices: list[Device]
    wan: list[WanLink]
    wan_live: bool = False  # True = latence WAN mesurée réellement (pas encore implémenté)
    switches: list[Switch]
    alerts: list[Alert]
    alerts_live: bool = False  # True = alertes lues en direct depuis Zabbix
    logs: list[LogEntry]
    ssid_history: SsidHistory
    zabbix_metrics: list[ZabbixMetric] = []


class PortProfile(BaseModel):
    name: str
    vlan: int
    desc_prefix: str
    extra: list[str]


class PortConfigRequest(BaseModel):
    action: Literal["config", "poe", "shut", "noshut"]
    vlan: Optional[int] = None
    desc: Optional[str] = None


class VlanCreateRequest(BaseModel):
    id: int
    name: str


class BulkSwitchRequest(BaseModel):
    """Une entrée par ligne : IP seule, plage ("10.1.10.30-40" ou
    "10.1.10.30-10.1.10.40"), optionnellement suffixée ":device_type"."""
    entries: str
    device_type: str = "cisco_ios"
    username: Optional[str] = None
    password: Optional[str] = None
    secret: Optional[str] = None


class CliPreview(BaseModel):
    target: str
    ip: str
    summary: str
    lines: list[str]


class PositionUpdate(BaseModel):
    x: float
    y: float
