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
from ..models import Alert, Ap, CliPreview, Device, LogEntry, PortConfigRequest, Snapshot, SwitchHistory, Vlan
from .base import DataProvider
from .inventory import (
    SwitchEntry, WanTargetEntry, WlcConfig, ZabbixConfig,
    load_inventory, load_wan_targets, load_wlc, load_zabbix, save_wlc, save_zabbix,
)
from .inventory import clear_wlc as inventory_clear_wlc
from .inventory import clear_zabbix as inventory_clear_zabbix
from .inventory import remove as inventory_remove
from .inventory import remove_wan_target as inventory_remove_wan_target
from .inventory import upsert as inventory_upsert
from .inventory import upsert_wan_target as inventory_upsert_wan_target
from .netmiko_switch import SwitchGateway
from .simulation import PROFILES, SimulationProvider
from .wan_probe import WanProbe
from .wlc_gateway import WlcGateway
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


def build_wlc() -> Optional[WlcGateway]:
    """Même principe : la config ajoutée depuis l'admin (backend/data/wlc.json)
    prime sur backend/.env."""
    saved = load_wlc()
    if saved:
        return WlcGateway(
            host=saved.host,
            snmp_version=saved.snmp_version,
            community=saved.community,
            v3_user=saved.v3_user,
            v3_auth_password=saved.v3_auth_password,
            v3_priv_password=saved.v3_priv_password,
        )
    hosts = settings.wlc_host_list
    if not hosts:
        return None
    host = hosts[0]
    return WlcGateway(
        host=host,
        snmp_version=settings.wlc_snmp_version,
        community=settings.wlc_community,
        v3_user=settings.wlc_v3_user,
        v3_auth_password=settings.wlc_v3_auth_password,
        v3_priv_password=settings.wlc_v3_priv_password,
    )


class HybridProvider(DataProvider):
    def __init__(self) -> None:
        self._sim = SimulationProvider()
        self.on_change: Optional[Callable[[], Awaitable[None]]] = None
        self._gateways: list[SwitchGateway] = build_gateways()
        self._live: dict[str, SwitchGateway] = {}
        self._zabbix: Optional[ZabbixGateway] = build_zabbix()
        self._zabbix_live = False
        self._wlc: Optional[WlcGateway] = build_wlc()
        self._wlc_live = False
        self._wlc_aps: list = []
        self._wan: dict[str, WanProbe] = {e.name: WanProbe(name=e.name, host=e.host) for e in load_wan_targets()}
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

        if self._wlc:
            self._wlc_live = await loop.run_in_executor(None, self._wlc.probe)
            if self._wlc_live:
                logger.info("WLC connecté : %s", self._wlc.host)

        for probe in list(self._wan.values()):
            await loop.run_in_executor(None, probe.ping_once)

        if self._live or self._zabbix_live or self._wlc_live or self._wan:
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
                try:
                    # Plus coûteux (item.get + history.get par hôte) — cache interne
                    # de 4× l'intervalle de poll pour rester léger sur Zabbix.
                    await loop.run_in_executor(
                        None, self._zabbix.cached_metrics, settings.zabbix_poll_seconds * 4,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("Poll métriques Zabbix échoué: %s", e)
            for name, probe in list(self._wan.items()):
                try:
                    await loop.run_in_executor(None, probe.ping_once)
                except Exception as e:  # noqa: BLE001
                    logger.warning("Ping WAN échoué pour %s: %s", name, e)
            if self._wlc_live and self._wlc:
                try:
                    self._wlc_aps = await loop.run_in_executor(None, self._wlc.get_aps)
                except Exception as e:  # noqa: BLE001
                    logger.warning("Poll WLC échoué: %s", e)
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

    async def add_switches_bulk(self, hosts: list[str], device_type: str,
                                 username: Optional[str], password: Optional[str],
                                 secret: Optional[str]) -> list[dict]:
        """Connecte plusieurs switchs en parallèle (concurrence plafonnée) —
        pour l'ajout en masse depuis l'admin (plage d'IP ou liste collée),
        au lieu d'un switch à la fois."""
        sem = asyncio.Semaphore(5)

        async def _one(host: str) -> dict:
            async with sem:
                entry = SwitchEntry(host=host, device_type=device_type,
                                     username=username, password=password, secret=secret)
                try:
                    ok = await self.add_switch(entry)
                except Exception as e:  # noqa: BLE001
                    return {"host": host, "connected": False, "error": str(e)}
                return {"host": host, "connected": ok, "error": None if ok else "injoignable ou identifiants refusés"}

        return await asyncio.gather(*(_one(h) for h in hosts))

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

    # ── Admin — WLC (contrôleur WiFi) à chaud, sans redémarrage ───────
    # ⚠️ Lecture SNMP seule : nom + statut des AP. Pas encore branché sur
    # aps_live/le heatmap — voir wlc_gateway.py, la position des AP sur le
    # plan ne peut pas être déduite du SNMP et demande un calibrage manuel.
    def wlc_status(self) -> dict:
        return {
            "configured": self._wlc is not None,
            "connected": self._wlc_live,
            "host": self._wlc.host if self._wlc else None,
            "aps": [{"name": a.name, "operational": a.operational} for a in self._wlc_aps],
        }

    async def connect_wlc(self, cfg: WlcConfig) -> bool:
        gw = WlcGateway(
            host=cfg.host,
            snmp_version=cfg.snmp_version,
            community=cfg.community,
            v3_user=cfg.v3_user,
            v3_auth_password=cfg.v3_auth_password,
            v3_priv_password=cfg.v3_priv_password,
        )
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, gw.probe)
        if ok:
            self._wlc = gw
            self._wlc_live = True
            save_wlc(cfg)
            logger.info("WLC connecté à chaud : %s", cfg.host)
            try:
                self._wlc_aps = await loop.run_in_executor(None, gw.get_aps)
            except Exception as e:  # noqa: BLE001
                logger.warning("Lecture AP WLC échouée juste après connexion: %s", e)
            if not self._poll_task or self._poll_task.done():
                self._poll_task = asyncio.create_task(self._poll_loop())
        return ok

    def disconnect_wlc(self) -> None:
        self._wlc = None
        self._wlc_live = False
        self._wlc_aps = []
        inventory_clear_wlc()

    # ── Composition du snapshot ───────────────────────────────────────
    def snapshot(self) -> Snapshot:
        snap = self._sim.snapshot()

        # Aucune simulation affichée nulle part : les switchs (SW-CORE-01,
        # SW-EDGE-01) et les devices de la maquette Dakar sont entièrement
        # retirés — pas masqués, retirés. Seul le matériel réel apparaît ;
        # aucun switch connecté = liste vide (voir empty-state frontend),
        # jamais de faux appareil affiché à la place.
        real = [gw.cached_or_read(settings.switch_poll_seconds * 2) for gw in self._live.values()]
        for sw, gw in zip(real, self._live.values()):
            sw.history = SwitchHistory(**gw.history_series())
        snap.switches = real
        snap.kpis.poe_watts = round(sum(p.poe for sw in real for p in sw.ports))
        snap.devices = [
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
        # Logs : l'audit réel (actions appliquées via NetControl) + l'historique
        # réel des événements Zabbix quand connecté — jamais le syslog/alerte
        # "de démo" seedé au démarrage de SimulationProvider.
        audit = [l for l in snap.logs if l.type == "audit"]
        events = self._zabbix.cached_events(settings.zabbix_poll_seconds * 2) if (self._zabbix_live and self._zabbix) else []
        snap.logs = sorted(audit + events, key=lambda l: l.t, reverse=True)[:200]

        if self._zabbix_live and self._zabbix:
            alerts = self._zabbix.cached_or_read(settings.zabbix_poll_seconds * 2)
            snap.alerts = alerts
            snap.alerts_live = True
            active = [a for a in alerts if not a.acked]
            snap.kpis.alerts_active = len(active)
            snap.kpis.alerts_critical = sum(1 for a in active if a.sev == "critical")
            snap.zabbix_metrics = self._zabbix.cached_metrics(settings.zabbix_poll_seconds * 4)

        if self._wan:
            snap.wan = [p.snapshot() for p in self._wan.values()]
            snap.wan_live = True

        # "mode" pilote les badges "SIMULATED DATA" côté frontend — il doit
        # refléter la réalité : au moins une source réelle connectée = hybrid,
        # sinon on reste honnêtement en "simulation".
        snap.mode = "hybrid" if (self._live or self._zabbix_live or self._wan) else "simulation"
        return snap

    # ── Admin — liens WAN à chaud, sans redémarrage ────────────────────
    def list_wan_targets(self) -> list[dict]:
        return [{"name": p.name, "host": p.host} for p in self._wan.values()]

    async def add_wan_target(self, entry: WanTargetEntry) -> bool:
        probe = WanProbe(name=entry.name, host=entry.host)
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(None, probe.probe)
        if ok:
            self._wan[entry.name] = probe
            inventory_upsert_wan_target(entry)
            logger.info("Lien WAN ajouté à chaud : %s (%s)", entry.name, entry.host)
            if not self._poll_task or self._poll_task.done():
                self._poll_task = asyncio.create_task(self._poll_loop())
        return ok

    def remove_wan_target(self, name: str) -> bool:
        existed = name in self._wan
        self._wan.pop(name, None)
        inventory_remove_wan_target(name)
        return existed

    def get_port_traffic(self, switch_name: str, port_id: str) -> dict:
        """Trafic réel (bits reçus/envoyés) d'un port — à la demande
        seulement (voir zabbix_gateway.get_interface_history), utilisé par
        Switch Manager quand un port est sélectionné."""
        gw = self._live.get(switch_name)
        if not gw or not (self._zabbix_live and self._zabbix):
            return {}
        metrics = self._zabbix.get_interface_history(gw.host, port_id)
        return {k: v.model_dump() for k, v in metrics.items()}

    def get_vlans(self) -> list[Vlan]:
        # /api/meta est un endpoint global (pas par switch) — les VLANs réels
        # vivent maintenant sur chaque Switch.vlans (voir snapshot()), jamais
        # fusionnés entre switchs. Ceci ne sert plus que de valeur par défaut
        # avant sélection d'un switch précis dans Switch Manager.
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
        # L'audit NetControl reste toujours réel ; on y ajoute l'historique
        # réel des événements Zabbix quand connecté — jamais le syslog/alerte
        # de la maquette simulée, quel que soit le filtre demandé côté UI.
        logs = [l for l in self._sim.get_logs(type_="audit", sev=sev, query=query, limit=limit) if l.type == "audit"]
        if self._zabbix_live and self._zabbix:
            events = self._zabbix.cached_events(settings.zabbix_poll_seconds * 2)
            if sev:
                events = [e for e in events if e.sev == sev]
            if query:
                q = query.lower()
                events = [e for e in events if q in e.msg.lower() or q in e.src.lower()]
            logs = logs + events
        return sorted(logs, key=lambda l: l.t, reverse=True)[:limit]

    # ── Switch Manager — uniquement du réel, plus de repli simulé ────
    def preview_port_config(self, switch_name: str, port_n: int, req: PortConfigRequest) -> CliPreview:
        gw = self._gateway_for(switch_name)
        if gw is None:
            raise KeyError(switch_name)
        port = gw.cached_or_read(settings.switch_poll_seconds * 2).ports[port_n - 1]
        if port.protected:
            raise PermissionError(port.id)
        return gw.build_cli(port, req, PROFILES)

    def apply_port_config(self, switch_name: str, port_n: int, req: PortConfigRequest) -> CliPreview:
        gw = self._gateway_for(switch_name)
        if gw is None:
            raise KeyError(switch_name)
        if not settings.switch_write_enabled:
            raise PermissionError("Écriture désactivée (NETCONTROL_SWITCH_WRITE_ENABLED=false)")
        port = gw.cached_or_read(settings.switch_poll_seconds * 2).ports[port_n - 1]
        if port.protected:
            raise PermissionError(port.id)
        result = gw.apply(port, req, PROFILES)
        self._sim.push_log("audit", "info", "NetControl",
                            f"AUDIT {settings.operator} — {result.summary} ({gw._name}) [LIVE]")
        return result

    # ── Création de VLAN — uniquement sur un switch réel identifié ────
    def preview_vlan(self, switch_name: str, vlan_id: int, name: str) -> CliPreview:
        gw = self._gateway_for(switch_name)
        if gw is None:
            raise KeyError(switch_name)
        return gw.build_vlan_cli(vlan_id, name)

    def apply_vlan(self, switch_name: str, vlan_id: int, name: str) -> CliPreview:
        gw = self._gateway_for(switch_name)
        if gw is None:
            raise KeyError(switch_name)
        if not settings.switch_write_enabled:
            raise PermissionError("Écriture désactivée (NETCONTROL_SWITCH_WRITE_ENABLED=false)")
        result = gw.apply_vlan(vlan_id, name)
        self._sim.push_log("audit", "info", "NetControl",
                            f"AUDIT {settings.operator} — {result.summary} ({gw._name}) [LIVE]")
        return result
