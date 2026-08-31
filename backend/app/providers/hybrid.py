"""Provider hybride : switch(s) réel(s) via Netmiko et alertes réelles via
Zabbix quand disponibles, simulation pour tout le reste (WLC/AP WiFi, WAN —
pas de matériel réel pour l'instant). C'est ce qui rend le mode "dynamique" :
chaque source est indépendante, une source indisponible retombe
silencieusement sur la simulation sans jamais faire planter l'application.
"""

import asyncio
import logging
from typing import Awaitable, Callable, Optional

from ..config import settings
from ..models import Alert, Ap, CliPreview, Device, LogEntry, PortConfigRequest, Snapshot, Vlan
from .base import DataProvider
from .inventory import SwitchEntry, ZabbixConfig, load_inventory, load_zabbix, save_zabbix
from .inventory import clear_zabbix as inventory_clear_zabbix
from .inventory import remove as inventory_remove
from .inventory import upsert as inventory_upsert
from .netmiko_switch import SwitchGateway
from .simulation import PROFILES, SimulationProvider
from .zabbix_gateway import ZabbixGateway

logger = logging.getLogger("netcontrol.hybrid")


def _gateway_from_entry(entry: SwitchEntry) -> SwitchGateway:
    extra = frozenset(settings.switch_protected_port_list)
    return SwitchGateway(
        host=entry.host,
        username=entry.username or settings.switch_user or "",
        password=entry.password or settings.switch_password or "",
        secret=entry.secret or settings.switch_secret or "",
        device_type=entry.device_type,
        extra_protected=extra,
    )


def build_gateways() -> list[SwitchGateway]:
    """Switchs fixés dans backend/.env au démarrage + ceux ajoutés depuis
    l'admin et persistés dans backend/data/switches.json (l'inventaire prend
    le dessus en cas de doublon d'hôte)."""
    env_entries = [
        SwitchEntry(host=host, device_type=device_type)
        for host, device_type in settings.switch_targets
    ]
    by_host: dict[str, SwitchEntry] = {e.host: e for e in env_entries}
    for e in load_inventory():
        by_host[e.host] = e
    return [_gateway_from_entry(e) for e in by_host.values() if e.username or settings.switch_user]


def build_zabbix() -> Optional[ZabbixGateway]:
    """Priorité à la config ajoutée depuis l'admin (backend/data/zabbix.json)
    si elle existe, sinon celle de backend/.env — même principe que les
    switchs : ce qui est ajouté à chaud prime sur le démarrage figé."""
    saved = load_zabbix()
    if saved:
        return ZabbixGateway(url=saved.url, token=saved.token, username=saved.username, password=saved.password)
    if not settings.zabbix_url:
        return None
    if not settings.zabbix_token and not (settings.zabbix_user and settings.zabbix_password):
        return None
    return ZabbixGateway(
        url=settings.zabbix_url,
        token=settings.zabbix_token,
        username=settings.zabbix_user,
        password=settings.zabbix_password,
    )


class HybridProvider(DataProvider):
    def __init__(self) -> None:
        self._sim = SimulationProvider()
        self.on_change: Optional[Callable[[], Awaitable[None]]] = None
        self._gateways: list[SwitchGateway] = build_gateways()
        self._live: dict[str, SwitchGateway] = {}
        self._zabbix: Optional[ZabbixGateway] = build_zabbix()
        self._zabbix_live = False
        self._poll_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        await self._sim.start()
        self._sim.on_change = self.on_change

        loop = asyncio.get_running_loop()
        for gw in self._gateways:
            ok = await loop.run_in_executor(None, gw.probe)
            if ok and gw._name:
                self._live[gw._name] = gw
                logger.info("Switch réel connecté : %s (%s)", gw._name, gw.host)

        if self._zabbix:
            self._zabbix_live = await loop.run_in_executor(None, self._zabbix.probe)
            if self._zabbix_live:
                logger.info("Zabbix connecté : %s", settings.zabbix_url)

        if self._live or self._zabbix_live:
            self._poll_task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        await self._sim.stop()
        if self._poll_task:
            self._poll_task.cancel()

    async def _poll_loop(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(min(settings.switch_poll_seconds, settings.zabbix_poll_seconds))
            for name, gw in list(self._live.items()):
                try:
                    await loop.run_in_executor(None, gw.read_switch)
                except Exception as e:  # noqa: BLE001
                    logger.warning("Poll échoué pour %s: %s", name, e)
            if self._zabbix_live and self._zabbix:
                try:
                    await loop.run_in_executor(None, self._zabbix.get_problems)
                except Exception as e:  # noqa: BLE001
                    logger.warning("Poll Zabbix échoué: %s", e)
            if self.on_change:
                await self.on_change()

    def _gateway_for(self, switch_name: str) -> Optional[SwitchGateway]:
        return self._live.get(switch_name)

    # ── Admin — ajout/retrait de switchs à chaud, sans redémarrage ────
    def list_switch_inventory(self) -> list[dict]:
        env_hosts = {h for h, _ in settings.switch_targets}
        by_host: dict[str, SwitchEntry] = {
            h: SwitchEntry(host=h, device_type=dt) for h, dt in settings.switch_targets
        }
        for e in load_inventory():
            by_host[e.host] = e
        out = []
        for host, entry in by_host.items():
            name = next((n for n, gw in self._live.items() if gw.host == host), None)
            out.append({
                "host": host,
                "device_type": entry.device_type,
                "connected": name is not None,
                "name": name,
                "from_env": host in env_hosts,
            })
        return out

    async def add_switch(self, entry: SwitchEntry) -> bool:
        gw = _gateway_from_entry(entry)
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, gw.probe)
        if ok and gw._name:
            self._live[gw._name] = gw
            inventory_upsert(entry)
            logger.info("Switch ajouté à chaud : %s (%s)", gw._name, gw.host)
            if not self._poll_task or self._poll_task.done():
                self._poll_task = asyncio.create_task(self._poll_loop())
        return ok

    def remove_switch(self, host: str) -> bool:
        name = next((n for n, gw in self._live.items() if gw.host == host), None)
        if name:
            del self._live[name]
        inventory_remove(host)
        return name is not None

    # ── Admin — Zabbix à chaud, sans redémarrage ──────────────────────
    def zabbix_status(self) -> dict:
        return {
            "configured": self._zabbix is not None,
            "connected": self._zabbix_live,
            "url": self._zabbix.url if self._zabbix else None,
        }

    async def connect_zabbix(self, cfg: ZabbixConfig) -> bool:
        gw = ZabbixGateway(url=cfg.url, token=cfg.token, username=cfg.username, password=cfg.password)
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, gw.probe)
        if ok:
            self._zabbix = gw
            self._zabbix_live = True
            save_zabbix(cfg)
            logger.info("Zabbix connecté à chaud : %s", cfg.url)
            if not self._poll_task or self._poll_task.done():
                self._poll_task = asyncio.create_task(self._poll_loop())
        return ok

    def disconnect_zabbix(self) -> None:
        self._zabbix = None
        self._zabbix_live = False
        inventory_clear_zabbix()

    # ── Composition du snapshot ───────────────────────────────────────
    def snapshot(self) -> Snapshot:
        snap = self._sim.snapshot()
        if self._live:
            # union, pas remplacement : les switchs simulés restants (ex.
            # SW-EDGE-01, qui porte le scénario de démo AP-MR2-01) doivent
            # rester visibles — sinon des fonctionnalités qui en dépendent
            # (raccourci "Fix" sur la heatmap) se cassent silencieusement
            # dès qu'un vrai switch est connecté. Chaque switch garde son
            # indicateur live/simulé, donc rien n'est présenté comme faux.
            real = [gw.cached_or_read(settings.switch_poll_seconds * 2) for gw in self._live.values()]
            real_names = {s.name for s in real}
            snap.switches = real + [s for s in snap.switches if s.name not in real_names]

            # PoE et carte "Devices" recalculés sur le vrai matériel : sinon
            # ces widgets de l'Overview restent invisiblement faux alors que
            # le switch est connecté pour de vrai.
            snap.kpis.poe_watts = round(sum(p.poe for sw in snap.switches for p in sw.ports))
            snap.devices = [d for d in snap.devices if d.name not in real_names] + [
                Device(
                    grp="Network core", name=sw.name,
                    kind=f"{sw.model} · live",
                    st="warn" if (sw.cpu_pct or 0) >= 80 or (sw.temp_c or 0) >= 70 else "ok",
                    metric=(
                        f"CPU {sw.cpu_pct}%" if sw.cpu_pct is not None else "CPU n/a"
                    ) + " · " + (
                        f"{sw.temp_c}°C" if sw.temp_c is not None else "temp n/a"
                    ) + (f" · up {sw.uptime}" if sw.uptime else ""),
                )
                for sw in real
            ]
        if self._zabbix_live and self._zabbix:
            alerts = self._zabbix.cached_or_read(settings.zabbix_poll_seconds * 2)
            snap.alerts = alerts
            snap.alerts_live = True
            active = [a for a in alerts if not a.acked]
            snap.kpis.alerts_active = len(active)
            snap.kpis.alerts_critical = sum(1 for a in active if a.sev == "critical")
        # "mode" pilote les badges "SIMULATED DATA" côté frontend — il doit
        # refléter la réalité : au moins une source réelle connectée = hybrid,
        # sinon on reste honnêtement en "simulation".
        snap.mode = "hybrid" if (self._live or self._zabbix_live) else "simulation"
        return snap

    def get_vlans(self) -> list[Vlan]:
        if self._live:
            merged: dict[int, Vlan] = {}
            for gw in self._live.values():
                for v in gw._vlans:
                    merged[v.id] = v
            if merged:
                return sorted(merged.values(), key=lambda v: v.id)
        return self._sim.get_vlans()

    # ── Tout ce qui n'a pas de source réelle → simulation ─────────────
    def get_aps(self) -> list[Ap]:
        return self._sim.get_aps()

    def set_ap_position(self, ap_id: str, x: float, y: float) -> Ap:
        return self._sim.set_ap_position(ap_id, x, y)

    def get_alerts(self) -> list[Alert]:
        if self._zabbix_live and self._zabbix:
            return self._zabbix.cached_or_read(settings.zabbix_poll_seconds * 2)
        return self._sim.get_alerts()

    def ack_alert(self, alert_id: int) -> Alert:
        if self._zabbix_live and self._zabbix:
            self._zabbix.acknowledge(alert_id)
            alerts = self._zabbix.get_problems()
            alert = next((a for a in alerts if a.id == alert_id), None)
            if alert is None:
                raise KeyError(alert_id)
            self._sim.push_log("audit", "info", "NetControl",
                                f"AUDIT {settings.operator} — alert acknowledged in Zabbix: “{alert.msg}”")
            return alert
        return self._sim.ack_alert(alert_id)

    def get_logs(self, type_=None, sev=None, query=None, limit=120) -> list[LogEntry]:
        return self._sim.get_logs(type_=type_, sev=sev, query=query, limit=limit)

    # ── Switch Manager — routé vers le réel si le switch est live ────
    def preview_port_config(self, switch_name: str, port_n: int, req: PortConfigRequest) -> CliPreview:
        gw = self._gateway_for(switch_name)
        if gw is None:
            return self._sim.preview_port_config(switch_name, port_n, req)
        port = gw.cached_or_read(settings.switch_poll_seconds * 2).ports[port_n - 1]
        if port.protected:
            raise PermissionError(port.id)
        return gw.build_cli(port, req, PROFILES)

    def apply_port_config(self, switch_name: str, port_n: int, req: PortConfigRequest) -> CliPreview:
        gw = self._gateway_for(switch_name)
        if gw is None:
            return self._sim.apply_port_config(switch_name, port_n, req)
        if not settings.switch_write_enabled:
            raise PermissionError("Écriture désactivée (NETCONTROL_SWITCH_WRITE_ENABLED=false)")
        port = gw.cached_or_read(settings.switch_poll_seconds * 2).ports[port_n - 1]
        if port.protected:
            raise PermissionError(port.id)
        result = gw.apply(port, req, PROFILES)
        self._sim.push_log("audit", "info", "NetControl",
                            f"AUDIT {settings.operator} — {result.summary} ({gw._name}) [LIVE]")
        return result
