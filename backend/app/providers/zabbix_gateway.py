"""Passerelle vers l'API Zabbix (JSON-RPC) — lecture des problèmes actifs
("alertes") et acquittement réel. Aucune écriture destructive : Zabbix reste
le socle de collecte, NetControl ne fait que lire ses problèmes et les
acquitter (event.acknowledge), jamais de suppression ni de reconfiguration.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import httpx

from ..models import Alert, LogEntry, Severity, ZabbixMetric

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
    _metrics_cache: list[ZabbixMetric] = field(default_factory=list, init=False, repr=False)
    _metrics_cache_at: float = field(default=0.0, init=False, repr=False)
    _events_cache: list[LogEntry] = field(default_factory=list, init=False, repr=False)
    _events_cache_at: float = field(default=0.0, init=False, repr=False)
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

    def get_metrics(self, hours: float = 6, max_hosts: int = 20, max_items_per_host: int = 40) -> list[ZabbixMetric]:
        """Historique réel des items numériques système (CPU, mémoire,
        température, ping...) des hôtes monitorés — pour tracer des graphes
        natifs dans NetControl plutôt que de renvoyer l'utilisateur sur l'UI
        Zabbix. Lecture seule (item.get / history.get).

        Les gabarits SNMP Cisco remontent des centaines d'items par switch
        (un "Bits received"/"Bits sent"/"Duplex status" par port) — les
        inclure tous ici noierait l'Overview. On ne garde que les items
        système (pas de préfixe "Interface ...") ; le détail par port vit
        dans Switch Manager, pas ici."""
        self._ensure_auth()
        hosts = [
            h for h in self._call("host.get", {
                "output": ["hostid", "name"],
                "filter": {"status": 0},
                "sortfield": "name",
                "limit": max_hosts,
            })
            if h["name"] != "Zabbix server"  # host interne de supervision du serveur Zabbix lui-même — pas un équipement du site
        ]
        time_from = int(time.time() - hours * 3600)
        metrics: list[ZabbixMetric] = []
        for h in hosts:
            items = self._call("item.get", {
                "hostids": [h["hostid"]],
                "output": ["itemid", "name", "units", "value_type"],
                "filter": {"status": 0},
                "sortfield": "name",
            })
            kept = 0
            for it in items:
                if kept >= max_items_per_host:
                    break
                name = re.sub(r"^#\d+:\s*", "", it["name"])  # préfixe technique Zabbix (index SNMP), sans intérêt affiché
                vtype = int(it["value_type"])
                if vtype not in (0, 3):  # seuls float/uint ont un historique numérique traçable
                    continue
                if name.startswith("Interface "):  # détail par port → Switch Manager, pas l'Overview
                    continue
                if name.endswith(" status") or name in ("ICMP ping", "SNMP walk"):
                    continue  # codes discrets (0/1/2…), pas des métriques à tracer en courbe
                if name in ("SNMP agent availability",) or name.startswith("Uptime "):
                    continue  # toujours à 1, ou déjà affiché en clair sur la carte de l'équipement — pas un graphe utile
                unit = it.get("units") or ""
                hist = self._call("history.get", {
                    "itemids": [it["itemid"]],
                    "history": vtype,
                    "time_from": time_from,
                    "output": "extend",
                    "sortfield": "clock",
                    "sortorder": "ASC",
                    "limit": 300,
                })
                if not hist:
                    continue
                values = [float(p["value"]) for p in hist]
                # Lisibilité : secondes → ms pour une latence ping (sinon "0.0026s"
                # illisible), octets → Mo pour la mémoire (sinon "584859584B").
                if unit == "s" and max(values, default=0) < 5:
                    values = [round(v * 1000, 1) for v in values]
                    unit = "ms"
                elif unit == "B":
                    values = [round(v / (1024 * 1024), 1) for v in values]
                    unit = " Mo"
                else:
                    values = [round(v, 2) for v in values]
                metrics.append(ZabbixMetric(
                    host=h["name"],
                    name=name,
                    unit=unit,
                    t=[datetime.fromtimestamp(int(p["clock"])).isoformat(timespec="seconds") for p in hist],
                    values=values,
                ))
                kept += 1
        self._metrics_cache = metrics
        self._metrics_cache_at = time.monotonic()
        return metrics

    def cached_metrics(self, max_age: float) -> list[ZabbixMetric]:
        if self._metrics_cache and (time.monotonic() - self._metrics_cache_at) < max_age:
            return self._metrics_cache
        return self.get_metrics()

    def get_interface_history(self, host_ip: str, port_id: str, hours: float = 1) -> dict[str, ZabbixMetric]:
        """Trafic réel (bits reçus/envoyés) d'UN port précis — appelé à la
        demande depuis Switch Manager quand un port est sélectionné, jamais
        inclus dans le snapshot global (des centaines d'items par switch,
        bien trop lourd à pousser en continu sur tous les ports)."""
        self._ensure_auth()
        ifaces = self._call("hostinterface.get", {"filter": {"ip": [host_ip]}, "output": ["hostid"]})
        if not ifaces:
            return {}
        hostid = ifaces[0]["hostid"]
        items = self._call("item.get", {
            "hostids": [hostid],
            "output": ["itemid", "name", "units", "value_type"],
            "search": {"name": f"Interface {port_id}("},
        })
        time_from = int(time.time() - hours * 3600)
        out: dict[str, ZabbixMetric] = {}
        for it in items:
            name = it["name"]
            if not name.startswith(f"Interface {port_id}("):
                continue  # "search" est un contains, pas un prefix — on revérifie
            if name.endswith("Bits received"):
                direction = "received"
            elif name.endswith("Bits sent"):
                direction = "sent"
            else:
                continue
            vtype = int(it["value_type"])
            if vtype not in (0, 3):
                continue
            hist = self._call("history.get", {
                "itemids": [it["itemid"]],
                "history": vtype,
                "time_from": time_from,
                "output": "extend",
                "sortfield": "clock",
                "sortorder": "ASC",
                "limit": 300,
            })
            values = [round(float(p["value"]) / 1_000_000, 2) for p in hist]  # bps → Mbps, plus lisible
            out[direction] = ZabbixMetric(
                host=port_id,
                name=name,
                unit=" Mbps",
                t=[datetime.fromtimestamp(int(p["clock"])).isoformat(timespec="seconds") for p in hist],
                values=values,
            )
        return out

    def get_event_log(self, hours: float = 48, limit: int = 100) -> list[LogEntry]:
        """Historique réel des événements Zabbix (résolus compris, pas
        seulement les alertes actives) — pour un vrai journal d'admin réseau
        dans Logs, au-delà du seul audit trail des actions NetControl."""
        self._ensure_auth()
        events = self._call("event.get", {
            "output": ["eventid", "name", "severity", "clock", "r_eventid"],
            "source": 0, "object": 0,
            "time_from": int(time.time() - hours * 3600),
            "sortfield": ["clock"],
            "sortorder": "DESC",
            "limit": limit,
        })
        out = []
        for e in events:
            resolved = e.get("r_eventid") not in (None, "0")
            out.append(LogEntry(
                id=900_000_000 + int(e["eventid"]),  # plage dédiée — jamais de collision avec l'audit NetControl
                t=datetime.fromtimestamp(int(e["clock"])).isoformat(timespec="seconds"),
                type="alerte",
                sev=SEVERITY_MAP.get(int(e["severity"]), "warning"),
                src="Zabbix",
                msg=f"{e['name']}{' (résolu)' if resolved else ''}",
            ))
        self._events_cache = out
        self._events_cache_at = time.monotonic()
        return out

    def cached_events(self, max_age: float) -> list[LogEntry]:
        if self._events_cache and (time.monotonic() - self._events_cache_at) < max_age:
            return self._events_cache
        return self.get_event_log()

    def acknowledge(self, event_id: int) -> None:
        """Acquitte réellement l'événement dans Zabbix (event.acknowledge,
        action ACK bit 0x2). N'est appelé que depuis l'action explicite
        "Acknowledge" côté utilisateur."""
        self._ensure_auth()
        self._call("event.acknowledge", {"eventids": [str(event_id)], "action": 6})
        self._cache = []  # force une relecture
