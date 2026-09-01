import asyncio
import contextlib
import ipaddress
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import BulkSwitchRequest, PortConfigRequest, PositionUpdate, VlanCreateRequest
from .providers.hybrid import HybridProvider
from .providers.inventory import SwitchEntry, WanTargetEntry, WlcConfig, ZabbixConfig
from .providers.simulation import PROFILES

# HybridProvider bascule automatiquement : switch(s) réel(s) via Netmiko
# si backend/.env en configure au moins un et qu'il répond au démarrage,
# sinon comportement 100% simulé inchangé (aucune config = rien ne change).
provider = HybridProvider()

app = FastAPI(
    title="NetControl API",
    description="Supervision réseau — Olympic Family Hotel, JOJ Dakar 2026 (BSRQ.MEDIA)",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self.active.append(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self.active:
                self.active.remove(ws)

    async def broadcast_snapshot(self) -> None:
        payload = {"type": "snapshot", "data": provider.snapshot().model_dump()}
        async with self._lock:
            targets = list(self.active)
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                await self.disconnect(ws)


manager = ConnectionManager()
provider.on_change = manager.broadcast_snapshot


@app.on_event("startup")
async def _startup() -> None:
    await provider.start()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await provider.stop()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        await ws.send_json({"type": "snapshot", "data": provider.snapshot().model_dump()})
        while True:
            await ws.receive_text()  # keepalive côté client, contenu ignoré
    except WebSocketDisconnect:
        await manager.disconnect(ws)


@app.get("/api/state")
def get_state():
    return provider.snapshot()


@app.get("/api/meta")
def get_meta():
    return {
        "mode": settings.mode,
        "site_name": settings.site_name,
        "site_location": settings.site_location,
        "operator": settings.operator,
        "vlans": provider.get_vlans(),
        # Les profils rapides ("Access point", "Printer"...) restent ceux de
        # la démo simulée : leur mapping VLAN est propre au scénario Dakar et
        # n'a pas de sens sur un switch réel arbitraire — le frontend les
        # masque quand le switch sélectionné est live.
        "profiles": PROFILES,
    }


@app.put("/api/aps/{ap_id}/position")
async def set_ap_position(ap_id: str, pos: PositionUpdate):
    try:
        ap = provider.set_ap_position(ap_id, pos.x, pos.y)
    except KeyError:
        raise HTTPException(404, f"Unknown AP: {ap_id}")
    await manager.broadcast_snapshot()
    return ap


@app.post("/api/alerts/{alert_id}/ack")
async def ack_alert(alert_id: int):
    try:
        alert = provider.ack_alert(alert_id)
    except KeyError:
        raise HTTPException(404, f"Unknown alert: {alert_id}")
    await manager.broadcast_snapshot()
    return alert


@app.get("/api/logs")
def get_logs(type: Optional[str] = None, sev: Optional[str] = None,
             q: Optional[str] = None, limit: int = 120):
    return provider.get_logs(type_=type, sev=sev, query=q, limit=limit)


@app.post("/api/switches/{switch_name}/ports/{port_n}/preview")
def preview_port(switch_name: str, port_n: int, req: PortConfigRequest):
    try:
        return provider.preview_port_config(switch_name, port_n, req)
    except KeyError:
        raise HTTPException(404, f"Unknown port: {switch_name} #{port_n}")
    except PermissionError as e:
        raise HTTPException(403, f"Port is protected (read-only): {e}")
    except Exception as e:  # noqa: BLE001 — ex. switch réel injoignable pour la preview
        raise HTTPException(502, f"Switch error: {e}")


@app.post("/api/switches/{switch_name}/ports/{port_n}/apply")
async def apply_port(switch_name: str, port_n: int, req: PortConfigRequest):
    try:
        # apply_port_config peut faire une vraie session SSH bloquante
        # (Netmiko) — on la sort du event loop pour ne pas geler le serveur
        # (WebSocket, autres requêtes) pendant les quelques secondes que ça prend.
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None, provider.apply_port_config, switch_name, port_n, req
        )
    except KeyError:
        raise HTTPException(404, f"Unknown port: {switch_name} #{port_n}")
    except PermissionError as e:
        raise HTTPException(403, f"Port is protected (read-only): {e}")
    except Exception as e:  # noqa: BLE001 — ex. timeout SSH, auth refusée, config rejetée
        raise HTTPException(502, f"Push to switch failed, nothing applied: {e}")
    await manager.broadcast_snapshot()
    return result


@app.post("/api/switches/{switch_name}/vlans/preview")
def preview_vlan(switch_name: str, req: VlanCreateRequest):
    try:
        return provider.preview_vlan(switch_name, req.id, req.name)
    except KeyError:
        raise HTTPException(404, f"Unknown or non-live switch: {switch_name}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Switch error: {e}")


@app.post("/api/switches/{switch_name}/vlans/apply")
async def apply_vlan(switch_name: str, req: VlanCreateRequest):
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, provider.apply_vlan, switch_name, req.id, req.name)
    except KeyError:
        raise HTTPException(404, f"Unknown or non-live switch: {switch_name}")
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Push to switch failed, nothing applied: {e}")
    await manager.broadcast_snapshot()
    return result


@app.get("/api/switches/{switch_name}/ports/{n}/traffic")
def port_traffic(switch_name: str, n: int):
    port_id = f"Gi1/0/{n}" if n > 0 else f"Te1/1/{-n}"
    return provider.get_port_traffic(switch_name, port_id)


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": settings.mode}


# ── Admin — inventaire des switchs, à chaud, sans redémarrage ─────────────
# ⚠️ Pas d'authentification sur cette API (comme le reste de NetControl) :
# quiconque atteint ce backend sur le réseau peut lister/ajouter/retirer des
# switchs, identifiants compris. Acceptable pour un outil d'exploitation
# on-site à accès réseau restreint ; à revoir si le backend devient joignable
# plus largement.
@app.get("/api/admin/switches")
def list_switches():
    return provider.list_switch_inventory()


@app.post("/api/admin/switches")
async def add_switch(entry: SwitchEntry):
    ok = await provider.add_switch(entry)
    if not ok:
        raise HTTPException(422, "Connexion échouée — vérifier IP, joignabilité réseau et identifiants")
    await manager.broadcast_snapshot()
    return {"connected": True}


@app.delete("/api/admin/switches/{host}")
async def remove_switch(host: str):
    removed = provider.remove_switch(host)
    await manager.broadcast_snapshot()
    return {"removed": removed}


_MAX_BULK_HOSTS = 100


def _parse_bulk_hosts(entries: str) -> list[str]:
    """Une entrée par ligne : IP seule, ou plage "10.1.10.30-40" /
    "10.1.10.30-10.1.10.40" (bornes incluses). Lignes vides/commentées ('#')
    ignorées."""
    hosts: list[str] = []
    for raw in entries.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "-" in line:
            start, _, end = line.partition("-")
            start, end = start.strip(), end.strip()
            try:
                if "." in end:
                    start_ip, end_ip = int(ipaddress.IPv4Address(start)), int(ipaddress.IPv4Address(end))
                else:
                    prefix, _, _ = start.rpartition(".")
                    start_ip = int(ipaddress.IPv4Address(start))
                    end_ip = int(ipaddress.IPv4Address(f"{prefix}.{end}"))
            except ValueError:
                raise HTTPException(422, f"Plage invalide : {line!r}")
            if end_ip < start_ip:
                raise HTTPException(422, f"Plage invalide (fin avant début) : {line!r}")
            hosts.extend(str(ipaddress.IPv4Address(i)) for i in range(start_ip, end_ip + 1))
        else:
            hosts.append(line)
    if len(hosts) > _MAX_BULK_HOSTS:
        raise HTTPException(422, f"Trop d'hôtes ({len(hosts)}) — {_MAX_BULK_HOSTS} maximum par ajout en masse")
    return hosts


@app.post("/api/admin/switches/bulk")
async def add_switches_bulk(req: BulkSwitchRequest):
    hosts = _parse_bulk_hosts(req.entries)
    if not hosts:
        raise HTTPException(422, "Aucun hôte trouvé dans la liste fournie")
    results = await provider.add_switches_bulk(hosts, req.device_type, req.username, req.password, req.secret)
    await manager.broadcast_snapshot()
    return results


@app.get("/api/admin/zabbix")
def zabbix_status():
    return provider.zabbix_status()


@app.post("/api/admin/zabbix")
async def connect_zabbix(cfg: ZabbixConfig):
    ok = await provider.connect_zabbix(cfg)
    if not ok:
        raise HTTPException(422, "Connexion échouée — vérifier l'URL (utiliser le nom du service Docker, "
                                  "ex: http://zabbix-web:8080, pas l'IP publiée) et le token/identifiants")
    await manager.broadcast_snapshot()
    return {"connected": True}


@app.delete("/api/admin/zabbix")
async def remove_zabbix():
    provider.disconnect_zabbix()
    await manager.broadcast_snapshot()
    return {"removed": True}


# ── Admin — WLC (contrôleur WiFi), à chaud ─────────────────────────────────
# Lecture SNMP seule (nom + statut des AP) — pas encore relié au heatmap, voir
# hybrid.py::wlc_status.
@app.get("/api/admin/wlc")
def wlc_status():
    return provider.wlc_status()


@app.post("/api/admin/wlc")
async def connect_wlc(cfg: WlcConfig):
    ok = await provider.connect_wlc(cfg)
    if not ok:
        raise HTTPException(422, "Connexion échouée — vérifier l'IP, la joignabilité réseau depuis le Debian "
                                  "et la communauté SNMP (ou les identifiants v3)")
    await manager.broadcast_snapshot()
    return {"connected": True}


@app.delete("/api/admin/wlc")
async def remove_wlc():
    provider.disconnect_wlc()
    await manager.broadcast_snapshot()
    return {"removed": True}


# ── Admin — liens WAN (latence/perte réelles via ping), à chaud ───────────
@app.get("/api/admin/wan")
def list_wan_targets():
    return provider.list_wan_targets()


@app.post("/api/admin/wan")
async def add_wan_target(entry: WanTargetEntry):
    ok = await provider.add_wan_target(entry)
    if not ok:
        raise HTTPException(422, "Cible injoignable — vérifier l'IP/le nom d'hôte et la joignabilité réseau")
    await manager.broadcast_snapshot()
    return {"connected": True}


@app.delete("/api/admin/wan/{name}")
async def remove_wan_target(name: str):
    removed = provider.remove_wan_target(name)
    await manager.broadcast_snapshot()
    return {"removed": removed}
