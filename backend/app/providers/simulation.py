"""Provider de simulation — port fidèle du simulateur de la maquette validée.

Toutes les constantes (AP, pièces, switches, courbe de charge, PRNG seedé)
proviennent de docs/maquette-reference.html et ne doivent pas être modifiées
sans revalider le rendu de la démo.
"""

import asyncio
import json
import math
from datetime import datetime, timedelta
from typing import Awaitable, Callable, Optional

from ..config import settings
from ..models import (
    Alert,
    Ap,
    CliPreview,
    Device,
    Kpis,
    LogEntry,
    Port,
    PortConfigRequest,
    PortProfile,
    Room,
    SfpPort,
    Snapshot,
    SsidClients,
    SsidHistory,
    Switch,
    Vlan,
    WanLink,
)
from .base import DataProvider

SSIDS = {"staff": "IOC-Staff", "members": "IOC-Members", "guests": "IOC-Guests"}
SPLIT = {"staff": 0.45, "members": 0.35, "guests": 0.20}

VLANS = [
    Vlan(id=10, name="IOC-Staff"),
    Vlan(id=20, name="IOC-Members"),
    Vlan(id=30, name="IOC-Guests"),
    Vlan(id=40, name="Imprimantes"),
    Vlan(id=50, name="Visio"),
    Vlan(id=99, name="Management"),
]

PROFILES = [
    PortProfile(name="Access point", vlan=99, desc_prefix="AP-",
                extra=["switchport port-security maximum 1"]),
    PortProfile(name="Printer", vlan=40, desc_prefix="MFP-",
                extra=["switchport port-security maximum 1"]),
    PortProfile(name="Video conf", vlan=50, desc_prefix="VISIO-",
                extra=["switchport port-security maximum 2"]),
    PortProfile(name="Wired station", vlan=10, desc_prefix="LAN-", extra=[]),
]

ROOMS = [
    Room(x=20, y=20, w=190, h=250, label="President’s Office"),
    Room(x=210, y=20, w=170, h=250, label="Dir. General Office"),
    Room(x=380, y=20, w=280, h=250, label="Executive Board Room"),
    Room(x=660, y=20, w=150, h=250, label="Protocol Room"),
    Room(x=810, y=20, w=170, h=250, label="Medical"),
    Room(x=20, y=350, w=300, h=270, label="IOC Administration"),
    Room(x=320, y=350, w=240, h=270, label="IOC Logistics / Technology"),
    Room(x=560, y=350, w=180, h=270, label="Meeting Room 1"),
    Room(x=740, y=350, w=140, h=270, label="Meeting Room 2"),
    Room(x=880, y=350, w=100, h=270, label="Terrace", out=True),
]

# (id, model, x, y, load weight, room, hot, down)
AP_SEED = [
    ("AP-PRES-01", "C9-2800", 115, 140, 4, "President’s Office", False, False),
    ("AP-DG-01", "C9-2800", 295, 140, 4, "DG Office", False, False),
    ("AP-EB-01", "C9-2800", 460, 115, 18, "Executive Board", True, False),
    ("AP-EB-02", "C9-2800", 585, 205, 12, "Executive Board", False, False),
    ("AP-PROTO-01", "C9-2800", 735, 145, 6, "Protocol Room", False, False),
    ("AP-MED-01", "C9-2800", 895, 140, 3, "Medical", False, False),
    ("AP-COR-01", "C9-2800", 500, 310, 8, "Corridor", False, False),
    ("AP-ADM-01", "C9-2800", 110, 460, 14, "IOC Administration", False, False),
    ("AP-ADM-02", "C9-2800", 255, 545, 12, "IOC Administration", False, False),
    ("AP-LOG-01", "C9-2800", 440, 485, 12, "Logistics/Technology", False, False),
    ("AP-MR1-01", "C9-2800", 650, 480, 10, "Meeting Room 1", False, False),
    ("AP-MR2-01", "C9-2800", 810, 480, 0, "Meeting Room 2", False, True),
    ("AP-EXT-01", "AIR-1562", 930, 500, 5, "Terrace", False, False),
]


def js_round(x: float) -> int:
    """Math.round de JS : arrondi demi-supérieur vers +inf (≠ round() Python)."""
    return math.floor(x + 0.5)


def day_curve(h: float) -> float:
    """Charge relative selon l'heure locale (0..1) — identique à la maquette."""
    if h < 6:
        return 0.12
    if h < 8:
        return 0.25 + 0.2 * (h - 6) / 2
    if h < 12:
        return 0.55 + 0.4 * math.sin((h - 8) / 4 * math.pi * 0.9)
    if h < 14:
        return 0.62
    if h < 18:
        return 0.75 + 0.2 * math.sin((h - 14) / 4 * math.pi)
    if h < 21:
        return 0.55 - 0.3 * (h - 18) / 3
    return 0.2


class SimulationProvider(DataProvider):
    def __init__(self) -> None:
        self._seed = 42
        self._log_id = 0
        self._alert_id = 0
        self._tasks: list[asyncio.Task] = []
        self.on_change: Optional[Callable[[], Awaitable[None]]] = None

        self.aps: list[Ap] = [
            Ap(id=i, model=m, x=x, y=y, room=r, hot=hot, down=down)
            for (i, m, x, y, _w, r, hot, down) in AP_SEED
        ]
        self._weights = {i: w for (i, _m, _x, _y, w, _r, _h, _d) in AP_SEED}
        self._load_positions()

        self.switches = self._seed_switches()
        self.logs: list[LogEntry] = []
        self.alerts: list[Alert] = []
        self._seed_alerts()

        self.wan = {
            "s1": [26 + js_round(self._rnd() * 7) for _ in range(40)],
            "s2": [29 + js_round(self._rnd() * 8) for _ in range(40)],
            "sl": [37 + js_round(self._rnd() * 14) for _ in range(40)],
        }

        self.hist = SsidHistory(t=[], staff=[], members=[], guests=[])
        self._seed_history()
        self._seed_logs()
        self._tick_aps()

    # ── PRNG déterministe (LCG identique à la maquette) ──────────────
    def _rnd(self) -> float:
        self._seed = (self._seed * 1103515245 + 12345) % 2147483648
        return self._seed / 2147483648

    # ── Seed des données ─────────────────────────────────────────────
    def _seed_switches(self) -> list[Switch]:
        def mk_ports() -> list[Port]:
            return [Port(id=f"Gi1/0/{i}", n=i) for i in range(1, 49)]

        core = Switch(
            name="SW-CORE-01", model="Catalyst 3650-48P", ip="192.168.99.10",
            loc="Technical room L1", ports=mk_ports(),
            sfp=[
                SfpPort(id="Te1/1/1", desc="UPLINK-FW-CHECKPOINT", state="up"),
                SfpPort(id="Te1/1/2", desc="UPLINK-SW-EDGE-01", state="up"),
                SfpPort(id="Te1/1/3", desc="STARLINK-1", state="up"),
                SfpPort(id="Te1/1/4", protected=False),
            ],
        )
        edge = Switch(
            name="SW-EDGE-01", model="Catalyst 3650-48P", ip="192.168.99.11",
            loc="IOC offices rack", ports=mk_ports(),
            sfp=[
                SfpPort(id="Te1/1/1", desc="UPLINK-SW-CORE-01", state="up"),
                SfpPort(id="Te1/1/2", protected=False),
                SfpPort(id="Te1/1/3", protected=False),
                SfpPort(id="Te1/1/4", protected=False),
            ],
        )

        def set_port(sw: Switch, n: int, state: str, vlan: int, desc: str, poe: float = 0.0):
            p = sw.ports[n - 1]
            p.state, p.vlan, p.desc, p.poe = state, vlan, desc, poe

        set_port(core, 1, "up", 99, "WLC-3504-PORT1"); core.ports[0].protected = True
        set_port(core, 2, "up", 99, "WLC-3504-PORT2"); core.ports[1].protected = True
        set_port(core, 3, "up", 99, "SRV-NETCONTROL"); core.ports[2].protected = True
        set_port(core, 5, "up", 40, "MFP-ADM", 6.2)
        set_port(core, 6, "up", 40, "MFP-PROTO", 5.8)
        set_port(core, 9, "up", 50, "VISIO-EB", 14.1)
        set_port(core, 10, "up", 50, "VISIO-MR1", 13.6)
        for i in range(13, 21):
            set_port(core, i, "up", 10, f"LAN-ADM-{i - 12:02d}")
        set_port(core, 24, "up", 10, "LAN-PROTOCOL-01")

        for i, ap in enumerate(self.aps):
            poe = 0.0 if ap.down else (28.4 if ap.model == "AIR-1562" else 15.2 + (i % 4))
            set_port(edge, i + 1, "err" if ap.down else "up", 99, ap.id, poe)
        set_port(edge, 20, "up", 10, "LAN-LOG-01")
        set_port(edge, 21, "up", 10, "LAN-LOG-02")
        set_port(edge, 25, "up", 50, "VISIO-MR2", 13.2)
        edge.ports[11].err = 214  # Gi1/0/12 : port err-disabled de AP-MR2-01

        return [core, edge]

    def _seed_alerts(self) -> None:
        now = datetime.now()
        for sev, msg, src, ago_min in [
            ("critical", "AP-MR2-01 unreachable (err-disabled on SW-EDGE-01 Gi1/0/12)", "WLC-3504", 52),
            ("warning", "AP-EB-01: channel utilization > 70% (2.4 GHz, channel 6)", "WLC-3504", 18),
            ("warning", "MFP-ADM: black toner below 15%", "MFP-ADM", 180),
        ]:
            self._alert_id += 1
            self.alerts.append(Alert(
                id=self._alert_id, sev=sev, msg=msg, src=src,
                since=(now - timedelta(minutes=ago_min)).isoformat(timespec="seconds"),
            ))

    def _seed_history(self) -> None:
        now = datetime.now()
        for i in range(144, -1, -1):
            t = now - timedelta(minutes=10 * i)
            c = day_curve(t.hour + t.minute / 60)
            base = 310 * c * (0.92 + self._rnd() * 0.16)
            self.hist.t.append(t.isoformat(timespec="seconds"))
            self.hist.staff.append(js_round(base * SPLIT["staff"]))
            self.hist.members.append(js_round(base * SPLIT["members"]))
            self.hist.guests.append(js_round(base * SPLIT["guests"]))
        self._last_hist_point = now

    def _mac(self) -> str:
        h = "0123456789abcdef"
        s = "a4:83:e7"
        for _ in range(3):
            s += ":" + h[int(self._rnd() * 16)] + h[int(self._rnd() * 16)]
        return s

    def _syslog_pool(self) -> list[tuple[str, str, str]]:
        r = self._rnd
        ssid_names = list(SSIDS.values())
        return [
            ("info", "WLC-3504",
             f"%DOT11-6-ASSOC: Client {self._mac()} associated to {self.aps[int(r() * 12)].id} "
             f"SSID {ssid_names[int(r() * 3)]}"),
            ("info", "WLC-3504", f"%DOT11-6-DISASSOC: Client {self._mac()} disassociated (idle timeout)"),
            ("info", "SW-CORE-01",
             f"%DHCP-6-ADDRESS_ASSIGN: 10.{10 + int(r() * 3)}.20.{20 + int(r() * 200)} "
             f"assigned (VLAN {[10, 20, 30][int(r() * 3)]})"),
            ("info", "WLC-3504",
             f"%RRM-6-CHANNEL_CHANGE: {self.aps[int(r() * 11)].id} 5 GHz radio "
             f"channel {[36, 40, 44, 48, 52][int(r() * 5)]}"),
            ("warning", "WLC-3504",
             f"%RRM-4-HIGH_UTIL: AP-EB-01 channel utilization {72 + int(r() * 10)}% (2.4 GHz)"),
            ("info", "Starlink-1",
             f"Link nominal — latency {36 + int(r() * 10)} ms, obstruction 0.0%"),
            ("warning", "MFP-ADM", f"Printer-MIB: black toner level {10 + int(r() * 4)}%"),
            ("info", "SW-EDGE-01",
             f"%LINK-3-UPDOWN: Interface GigabitEthernet1/0/{20 + int(r() * 8)}, "
             f"changed state to up"),
        ]

    def _seed_logs(self) -> None:
        self.push_log("alerte", "critical", "Zabbix",
                      "PROBLEM: AP-MR2-01 unreachable (ICMP timeout ×5) — severity High")
        self.push_log("syslog", "critical", "SW-EDGE-01",
                      "%PM-4-ERR_DISABLE: link-flap error detected on Gi1/0/12, "
                      "putting Gi1/0/12 in err-disable state")
        for _ in range(14):
            pool = self._syslog_pool()
            sev, src, msg = pool[int(self._rnd() * len(pool))]
            self.push_log("syslog", sev, src, msg)
        self.push_log("alerte", "warning", "Zabbix",
                      "PROBLEM: AP-EB-01 channel utilization > 70% — severity Average")
        self.push_log("alerte", "warning", "Zabbix",
                      "PROBLEM: MFP-ADM toner level < 15% — severity Information")

    # ── Persistance des positions AP ─────────────────────────────────
    @property
    def _positions_file(self):
        return settings.data_dir / "ap_positions.json"

    def _load_positions(self) -> None:
        try:
            saved = json.loads(self._positions_file.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return
        for ap in self.aps:
            if ap.id in saved:
                ap.x, ap.y = saved[ap.id]["x"], saved[ap.id]["y"]

    def _save_positions(self) -> None:
        self._positions_file.write_text(json.dumps(
            {ap.id: {"x": ap.x, "y": ap.y} for ap in self.aps}, indent=2))

    # ── Boucle de simulation ─────────────────────────────────────────
    def _tick_aps(self) -> None:
        now = datetime.now()
        c = day_curve(now.hour + now.minute / 60)
        for ap in self.aps:
            if ap.down:
                ap.clients = SsidClients()
                ap.util = 0
                continue
            w = self._weights[ap.id]
            clients = {}
            for k, split in SPLIT.items():
                target = w * c * split * (0.85 + self._rnd() * 0.3)
                clients[k] = max(0, js_round(target))
            ap.clients = SsidClients(**clients)
            tot = ap.clients.total
            ap.util = min(96, js_round((38 if ap.hot else 16) + tot * 2.6 + self._rnd() * 8))
            ap.noise = js_round(-95 + self._rnd() * 9 + (6 if ap.hot else 0))
            ap.rssi = js_round(-52 - self._rnd() * 14 - (4 if tot > 12 else 0))

    def _tick_wan(self) -> None:
        self.wan["s1"] = self.wan["s1"][1:] + [26 + js_round(self._rnd() * 7)]
        self.wan["s2"] = self.wan["s2"][1:] + [29 + js_round(self._rnd() * 8)]
        self.wan["sl"] = self.wan["sl"][1:] + [37 + js_round(self._rnd() * 14)]

    def _tick_history(self) -> None:
        now = datetime.now()
        if (now - self._last_hist_point).total_seconds() < 600:
            return
        self._last_hist_point = now
        c = day_curve(now.hour + now.minute / 60)
        base = 310 * c * (0.92 + self._rnd() * 0.16)
        self.hist.t = self.hist.t[1:] + [now.isoformat(timespec="seconds")]
        self.hist.staff = self.hist.staff[1:] + [js_round(base * SPLIT["staff"])]
        self.hist.members = self.hist.members[1:] + [js_round(base * SPLIT["members"])]
        self.hist.guests = self.hist.guests[1:] + [js_round(base * SPLIT["guests"])]

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.tick_seconds)
            self._tick_aps()
            self._tick_wan()
            self._tick_history()
            if self.on_change:
                await self.on_change()

    async def _syslog_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.syslog_seconds)
            pool = self._syslog_pool()
            sev, src, msg = pool[int(self._rnd() * len(pool))]
            self.push_log("syslog", sev, src, msg)
            if self.on_change:
                await self.on_change()

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._tick_loop()),
            asyncio.create_task(self._syslog_loop()),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()

    # ── Lectures ─────────────────────────────────────────────────────
    def push_log(self, type_: str, sev: str, src: str, msg: str) -> None:
        self._log_id += 1
        self.logs.insert(0, LogEntry(
            id=self._log_id, t=datetime.now().isoformat(timespec="seconds"),
            type=type_, sev=sev, src=src, msg=msg))
        del self.logs[400:]

    def _total_clients(self) -> int:
        return sum(ap.clients.total for ap in self.aps)

    def _devices(self) -> list[Device]:
        r = self._rnd
        tot = self._total_clients()
        eb = next(ap for ap in self.aps if ap.id == "AP-EB-01")
        mr2 = next(ap for ap in self.aps if ap.id == "AP-MR2-01")
        others = len(self.aps) - 2  # tous sauf AP-EB-01 et AP-MR2-01, listés à part
        devices = [
            Device(grp="Network core", name="WLC-3504", kind="WiFi controller", st="ok",
                   metric=f"CPU {12 + js_round(r() * 6)}% · {tot} clients"),
            Device(grp="Network core", name="SW-CORE-01", kind="Catalyst 3650-48P", st="ok",
                   metric=f"CPU {9 + js_round(r() * 5)}% · 41°C"),
            Device(grp="Network core", name="SW-EDGE-01", kind="Catalyst 3650-48P", st="ok",
                   metric=f"CPU {11 + js_round(r() * 5)}% · 43°C"),
            Device(grp="Network core", name="FW-CHECKPOINT", kind="Reachability only", st="ok",
                   metric=f"ICMP {1 + js_round(r() * 2)} ms"),
            Device(grp="WiFi", name="AP-EB-01", kind="Aironet 2800 · Exec. Board",
                   st="warn" if eb.util >= 70 else "ok",
                   metric=f"Channel {eb.util}% · {eb.clients.total} clients"),
            Device(grp="WiFi", name="AP-MR2-01", kind="Aironet 2800 · Meeting R. 2",
                   st="crit" if mr2.down else "ok",
                   metric="Unreachable — err-disabled" if mr2.down
                   else f"Channel {mr2.util}% · {mr2.clients.total} clients"),
            Device(grp="WiFi", name=f"{others} other APs", kind="Aironet 2800 / 1562",
                   st="ok", metric=f"{tot} associated clients"),
            Device(grp="Peripherals", name="MFP-ADM", kind="Network printer", st="warn",
                   metric="Black toner 12%"),
            Device(grp="Peripherals", name="MFP-PROTO", kind="Network printer", st="ok",
                   metric="Toner 64% · trays OK"),
            Device(grp="WAN", name="Sonatel — Line 1", kind="1 Gbps fiber", st="ok",
                   metric=f"{self.wan['s1'][-1]} ms · loss 0.0%"),
            Device(grp="WAN", name="Orange — Line 2", kind="1 Gbps fiber", st="ok",
                   metric=f"{self.wan['s2'][-1]} ms · loss 0.1%"),
            Device(grp="WAN", name="Starlink-1 · Terrou-Bi", kind="Backup — standby", st="ok",
                   metric=f"{self.wan['sl'][-1]} ms · obstruction 0%"),
            Device(grp="WAN", name="Starlink-2 · Azalaï", kind="Backup — standby", st="ok",
                   metric=f"{38 + js_round(r() * 8)} ms · obstruction 0%"),
        ]
        return devices

    def _kpis(self) -> Kpis:
        tot = self._total_clients()
        active = [a for a in self.alerts if not a.acked]
        poe = sum(p.poe for sw in self.switches for p in sw.ports)
        return Kpis(
            clients_total=tot,
            clients_staff=sum(ap.clients.staff for ap in self.aps),
            clients_members=sum(ap.clients.members for ap in self.aps),
            clients_guests=sum(ap.clients.guests for ap in self.aps),
            aps_up=sum(1 for ap in self.aps if not ap.down),
            aps_total=len(self.aps),
            alerts_active=len(active),
            alerts_critical=sum(1 for a in active if a.sev == "critical"),
            poe_watts=js_round(poe),
        )

    def snapshot(self) -> Snapshot:
        return Snapshot(
            mode=settings.mode,
            site_name=settings.site_name,
            site_location=settings.site_location,
            operator=settings.operator,
            kpis=self._kpis(),
            aps=self.aps,
            rooms=ROOMS,
            devices=self._devices(),
            wan=[
                WanLink(name="Sonatel — L1", sub="1 Gbps · active",
                        latency=self.wan["s1"], jitter=round(1 + self._rnd() * 2, 1), loss="0.0%"),
                WanLink(name="Orange — L2", sub="1 Gbps · active",
                        latency=self.wan["s2"], jitter=round(1 + self._rnd() * 2, 1), loss="0.1%"),
                WanLink(name="Starlink-1", sub="backup · standby",
                        latency=self.wan["sl"], jitter=round(2 + self._rnd() * 3, 1), loss="0.0%"),
            ],
            switches=self.switches,
            alerts=self.alerts,
            logs=self.logs[:120],
            ssid_history=self.hist,
        )

    def get_aps(self) -> list[Ap]:
        return self.aps

    def set_ap_position(self, ap_id: str, x: float, y: float) -> Ap:
        ap = next((a for a in self.aps if a.id == ap_id), None)
        if ap is None:
            raise KeyError(ap_id)
        ap.x = max(15.0, min(985.0, x))
        ap.y = max(15.0, min(625.0, y))
        self._save_positions()
        self.push_log("audit", "info", "NetControl",
                      f"AUDIT {settings.operator} — {ap.id} position updated "
                      f"on floor plan “Level 1”")
        return ap

    def get_alerts(self) -> list[Alert]:
        return self.alerts

    def ack_alert(self, alert_id: int) -> Alert:
        alert = next((a for a in self.alerts if a.id == alert_id), None)
        if alert is None:
            raise KeyError(alert_id)
        alert.acked = not alert.acked
        if alert.acked:
            self.push_log("audit", "info", "NetControl",
                          f"AUDIT {settings.operator} — alert acknowledged: “{alert.msg}”")
        return alert

    def get_logs(self, type_=None, sev=None, query=None, limit=120) -> list[LogEntry]:
        out = []
        q = (query or "").lower()
        for log in self.logs:
            if type_ and type_ != "all" and log.type != type_:
                continue
            if sev and sev != "all" and log.sev != sev:
                continue
            if q and q not in f"{log.src} {log.msg}".lower():
                continue
            out.append(log)
            if len(out) >= limit:
                break
        return out

    def get_vlans(self) -> list[Vlan]:
        return VLANS

    # ── Switch Manager ───────────────────────────────────────────────
    def _find_port(self, switch_name: str, port_n: int) -> tuple[Switch, Port]:
        sw = next((s for s in self.switches if s.name == switch_name), None)
        if sw is None or not 1 <= port_n <= len(sw.ports):
            raise KeyError(f"{switch_name}/{port_n}")
        return sw, sw.ports[port_n - 1]

    def _build_cli(self, sw: Switch, port: Port, req: PortConfigRequest) -> CliPreview:
        vlan = req.vlan if req.vlan is not None else port.vlan
        desc = (req.desc if req.desc is not None else port.desc).strip()
        iface = f"interface GigabitEthernet1/0/{port.n}"
        profile = next((p for p in PROFILES if p.vlan == vlan), None)

        if req.action == "config":
            body = [
                iface,
                f" description {desc or '—'}",
                " switchport mode access",
                f" switchport access vlan {vlan}",
                *([" " + x for x in profile.extra] if profile else []),
                " spanning-tree portfast",
                " no shutdown",
            ]
            summary = f"{port.id} → VLAN {vlan}" + (f", “{desc}”" if desc else "")
        elif req.action == "poe":
            body = [iface, " power inline never", "!", "! 5 s pause", iface, " power inline auto"]
            summary = f"{port.id} — PoE restart"
        elif req.action == "shut":
            body = [iface, " shutdown"]
            summary = f"{port.id} — shutdown"
        else:  # noshut
            body = [iface, " no shutdown"]
            summary = f"{port.id} — enabled"

        lines = [
            "! NetControl — preview only. No commands sent yet.",
            f"! Target: {sw.name} ({sw.ip}) — user: {settings.operator}",
            "! running-config saved before applying (rollback available)",
            "configure terminal",
            *body,
            "end",
            "write memory",
        ]
        return CliPreview(target=sw.name, ip=sw.ip, summary=summary, lines=lines)

    def preview_port_config(self, switch_name, port_n, req) -> CliPreview:
        sw, port = self._find_port(switch_name, port_n)
        if port.protected:
            raise PermissionError(port.id)
        return self._build_cli(sw, port, req)

    def apply_port_config(self, switch_name, port_n, req) -> CliPreview:
        sw, port = self._find_port(switch_name, port_n)
        if port.protected:
            raise PermissionError(port.id)
        preview = self._build_cli(sw, port, req)

        was_err = port.state == "err"
        if req.action == "config":
            if req.vlan is not None:
                port.vlan = req.vlan
            if req.desc is not None:
                port.desc = req.desc.strip()
            if port.state in ("down", "err"):
                port.state = "up"
        elif req.action == "shut":
            port.state = "down"
        elif req.action == "noshut":
            port.state = "up"
        # req.action == "poe" : un redémarrage PoE ne sort pas un port d'err-disabled

        self.push_log("audit", "info", "NetControl",
                      f"AUDIT {settings.operator} — {preview.summary} ({sw.name})")
        self.push_log("syslog", "info", sw.name,
                      "%SYS-5-CONFIG_I: Configured from 192.168.99.20 by netcontrol (vty0)")

        # Scénario de démo : réactiver Gi1/0/12 sur SW-EDGE-01 rétablit AP-MR2-01
        if was_err and port.state == "up" and sw.name == "SW-EDGE-01" and port.n == 12:
            self._resolve_mr2_incident(sw, port)
        return preview

    def _resolve_mr2_incident(self, sw: Switch, port: Port) -> None:
        port.err = 0
        port.poe = 15.2
        ap = next(a for a in self.aps if a.id == "AP-MR2-01")
        ap.down = False
        self._weights[ap.id] = 10
        self.alerts = [a for a in self.alerts if "AP-MR2-01" not in a.msg]
        self.push_log("syslog", "info", sw.name,
                      "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/12, changed state to up")
        self.push_log("syslog", "info", "WLC-3504",
                      "%CAPWAP-5-JOIN: AP-MR2-01 (Aironet 2800) joined the controller")
        self.push_log("alerte", "info", "Zabbix",
                      "RESOLVED: AP-MR2-01 unreachable — device reachable again")
        self._tick_aps()
