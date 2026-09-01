import asyncio
import contextlib
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import PortConfigRequest, PositionUpdate, VlanCreateRequest
from .providers.hybrid import HybridProvider
from .providers.inventory import SwitchEntry, ZabbixConfig
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
