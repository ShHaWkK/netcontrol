"""Passerelle vers l'API Zabbix (JSON-RPC) — lecture des problèmes actifs
("alertes") et acquittement réel. Aucune écriture destructive : Zabbix reste
le socle de collecte, NetControl ne fait que lire ses problèmes et les
acquitter (event.acknowledge), jamais de suppression ni de reconfiguration.
"""

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import httpx

from ..models import Alert, Severity

logger = logging.getLogger("netcontrol.zabbix")

# Zabbix "severity" (0=not classified .. 5=disaster) → notre échelle.
SEVERITY_MAP: dict[int, Severity] = {
    0: "info", 1: "info", 2: "warning", 3: "warning", 4: "serious", 5: "critical",
}


class ZabbixError(RuntimeError):
    pass


@dataclass
class ZabbixGateway:
    url: str  # base, ex: http://10.1.10.50
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None

    _client: httpx.Client = field(init=False, repr=False)
    _endpoint: str = field(init=False, repr=False)
    _auth_token: Optional[str] = field(default=None, init=False, repr=False)
    _cache: list[Alert] = field(default_factory=list, init=False, repr=False)
    _cache_at: float = field(default=0.0, init=False, repr=False)
    _id: int = field(default=0, init=False, repr=False)

    def __post_init__(self) -> None:
        # Pas de base_url + chemin relatif "" : httpx joint ça en ajoutant un
        # "/" final (.../api_jsonrpc.php/), que Zabbix/nginx renvoie en 404.
        # On poste toujours l'URL complète et exacte, sans ambiguïté.
        self._endpoint = self.url.rstrip("/") + "/api_jsonrpc.php"
        self._client = httpx.Client(timeout=8.0)

    def _call(self, method: str, params: dict) -> dict:
        self._id += 1
        headers = {"Content-Type": "application/json-rpc"}
        payload: dict = {"jsonrpc": "2.0", "method": method, "params": params, "id": self._id}
        auth = self.token or self._auth_token
        if auth and method != "apiinfo.version":
            headers["Authorization"] = f"Bearer {auth}"
        res = self._client.post(self._endpoint, json=payload, headers=headers)
        res.raise_for_status()
        body = res.json()
        if "error" in body:
            raise ZabbixError(f"{method}: {body['error'].get('data') or body['error'].get('message')}")
        return body["result"]

    def _ensure_auth(self) -> None:
        if self.token or self._auth_token:
            return
        if not (self.username and self.password):
            raise ZabbixError("Ni token, ni user/password Zabbix configurés")
        self._auth_token = self._call("user.login", {"username": self.username, "password": self.password})

    def probe(self) -> bool:
        try:
            self.get_problems()
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning("Zabbix %s injoignable, retombe en simulation: %s", self.url, e)
            return False

    def get_problems(self) -> list[Alert]:
        self._ensure_auth()
        problems = self._call("problem.get", {
            "output": ["eventid", "name", "severity", "clock", "acknowledged"],
            "recent": True,
            "sortfield": ["eventid"],
            "sortorder": "DESC",
        })
        alerts = []
        for p in problems:
            hosts = p.get("hosts") or []
            src = hosts[0]["host"] if hosts else "Zabbix"
            alerts.append(Alert(
                id=int(p["eventid"]),
                sev=SEVERITY_MAP.get(int(p["severity"]), "warning"),
                msg=p["name"],
                src=src,
                since=datetime.fromtimestamp(int(p["clock"])).isoformat(timespec="seconds"),
                acked=p.get("acknowledged") == "1",
            ))
        self._cache = alerts
        self._cache_at = time.monotonic()
        return alerts

    def cached_or_read(self, max_age: float) -> list[Alert]:
        if self._cache is not None and (time.monotonic() - self._cache_at) < max_age:
            return self._cache
        return self.get_problems()

    def acknowledge(self, event_id: int) -> None:
        """Acquitte réellement l'événement dans Zabbix (event.acknowledge,
        action ACK bit 0x2). N'est appelé que depuis l'action explicite
        "Acknowledge" côté utilisateur."""
        self._ensure_auth()
        self._call("event.acknowledge", {"eventids": [str(event_id)], "action": 6})
        self._cache = []  # force une relecture
