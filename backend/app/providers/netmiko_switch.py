"""Passerelle Netmiko vers un switch Cisco IOS réel.

Lecture : `show interfaces status`, `show interfaces status err-disabled`,
`show vlan brief`. Écriture : `apply_port_config` pousse une vraie
configuration (`configure terminal` / `write memory`) — jamais appelée
automatiquement, seulement depuis l'action explicite "Apply" du Switch
Manager côté utilisateur.

Modélisation : on ne garde que GigabitEthernet1/0/1-48 (faceplate 48 ports,
comme le modèle Switch existant) et TenGigabitEthernet1/1/1-4 (4 slots SFP+,
même forme que le SFP simulé). Les autres interfaces (stack membre 2, etc.)
sont ignorées pour l'instant — hors périmètre de la maquette validée.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

from ..models import CliPreview, Port, PortConfigRequest, PortProfile, SfpPort, Switch, Vlan

logger = logging.getLogger("netcontrol.netmiko")

GI_RE = re.compile(r"^(?:Gi|GigabitEthernet)1/0/(\d+)$")
TE_RE = re.compile(r"^(?:Te|TenGigabitEthernet)1/1/(\d+)$")


def _column_slices(header: str, names: list[str]) -> list[tuple[str, int, Optional[int]]]:
    """Détermine les bornes de colonnes d'un tableau Cisco à largeur fixe à
    partir de la position de chaque nom de colonne dans la ligne d'en-tête."""
    starts = []
    for name in names:
        idx = header.find(name)
        if idx == -1:
            raise ValueError(f"colonne introuvable dans l'en-tête: {name!r}")
        starts.append(idx)
    slices = []
    for i, name in enumerate(names):
        end = starts[i + 1] if i + 1 < len(names) else None
        slices.append((name, starts[i], end))
    return slices


def _parse_table(text: str, header_startswith: str, names: list[str]) -> list[dict]:
    lines = [l for l in text.splitlines() if l.strip()]
    header = next((l for l in lines if l.strip().startswith(header_startswith)), None)
    if header is None:
        return []
    slices = _column_slices(header, names)
    rows = []
    for line in lines:
        if line is header or set(line.strip()) <= {"-"}:
            continue
        if line.strip().startswith(header_startswith):
            continue
        row = {name: line[start:end].strip() for name, start, end in slices}
        if row.get(names[0]):  # ignore les lignes de continuation (VLAN multi-lignes)
            rows.append(row)
    return rows


def _state_from_status(status: str) -> str:
    s = status.lower()
    if "err" in s:
        return "err"
    if s.startswith("connected"):
        return "up"
    return "down"


@dataclass
class SwitchGateway:
    host: str
    username: str
    password: str
    secret: str
    device_type: str = "cisco_ios"
    extra_protected: frozenset[str] = field(default_factory=frozenset)

    _cache: Optional[Switch] = field(default=None, init=False, repr=False)
    _cache_at: float = field(default=0.0, init=False, repr=False)
    _name: Optional[str] = field(default=None, init=False, repr=False)
    _vlans: list[Vlan] = field(default_factory=list, init=False, repr=False)

    def _device(self) -> dict:
        return {
            "device_type": self.device_type,
            "host": self.host,
            "username": self.username,
            "password": self.password,
            "secret": self.secret or self.password,
            "fast_cli": False,
        }

    def probe(self) -> bool:
        """Test de connectivité non bloquant pour le démarrage — ne lève jamais."""
        try:
            self.read_switch()
            return True
        except Exception as e:  # noqa: BLE001 — on ne veut jamais planter le démarrage
            logger.warning("Switch %s injoignable, retombe en simulation: %s", self.host, e)
            return False

    def read_switch(self) -> Switch:
        from netmiko import ConnectHandler  # import différé : dépendance optionnelle

        with ConnectHandler(**self._device()) as conn:
            prompt = conn.find_prompt().strip().rstrip("#>")
            self._name = prompt or self.host

            status_out = conn.send_command("show interfaces status")
            err_out = conn.send_command("show interfaces status err-disabled")
            vlan_out = conn.send_command("show vlan brief")
            version_out = conn.send_command("show version")
            power_out = _safe_command(conn, "show power inline")
            cpu_out = _safe_command(conn, "show processes cpu")
            env_out = _safe_command(conn, "show environment all")

        switch = self._build_switch(status_out, err_out, vlan_out, version_out, power_out, cpu_out, env_out)
        self._vlans = _parse_vlans(vlan_out)
        self._cache = switch
        self._cache_at = time.monotonic()
        return switch

    def cached_or_read(self, max_age: float) -> Switch:
        if self._cache is not None and (time.monotonic() - self._cache_at) < max_age:
            return self._cache
        return self.read_switch()

    def _build_switch(
        self, status_out: str, err_out: str, vlan_out: str,
        version_out: str = "", power_out: str = "", cpu_out: str = "", env_out: str = "",
    ) -> Switch:
        rows = _parse_table(status_out, "Port", ["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"])
        err_ports = {
            r["Port"] for r in _parse_table(err_out, "Port", ["Port", "Name", "Status", "Reason", "Err-disabled"])
        }
        power_map = _parse_power_inline(power_out)

        ports: dict[int, Port] = {}
        sfp: dict[int, SfpPort] = {}
        for row in rows:
            port_id = row["Port"]
            m = GI_RE.match(port_id)
            if m:
                n = int(m.group(1))
                if not 1 <= n <= 48:
                    continue
                is_trunk = row["Vlan"].lower() == "trunk"
                is_uplink_named = any(k in row["Name"].upper() for k in ("UPLINK", "TRUNK"))
                protected = is_trunk or is_uplink_named or port_id in self.extra_protected
                state = "err" if port_id in err_ports else _state_from_status(row["Status"])
                vlan = 0 if is_trunk else _safe_int(row["Vlan"], default=0)
                ports[n] = Port(
                    id=f"Gi1/0/{n}", n=n, state=state, vlan=vlan,
                    desc=row["Name"], poe=power_map.get(port_id, 0.0), err=1 if state == "err" else 0,
                    protected=protected,
                )
                continue
            m = TE_RE.match(port_id)
            if m:
                n = int(m.group(1))
                if not 1 <= n <= 4:
                    continue
                sfp[n] = SfpPort(
                    id=f"Te1/1/{n}", desc=row["Name"],
                    state=_state_from_status(row["Status"]), protected=True,
                )

        full_ports = [ports.get(n, Port(id=f"Gi1/0/{n}", n=n)) for n in range(1, 49)]
        full_sfp = [sfp.get(n, SfpPort(id=f"Te1/1/{n}")) for n in range(1, 5)]

        return Switch(
            name=self._name or self.host,
            model=_parse_model(version_out) or "Cisco IOS switch (lecture live)",
            ip=self.host,
            loc="—",
            ports=full_ports,
            sfp=full_sfp,
            live=True,
            cpu_pct=_parse_cpu(cpu_out),
            temp_c=_parse_temp(env_out),
            uptime=_parse_uptime(version_out),
        )

    # ── Switch Manager — preview (jamais d'écriture) ─────────────────
    def build_cli(self, port: Port, req: PortConfigRequest, profiles: list[PortProfile]) -> CliPreview:
        vlan = req.vlan if req.vlan is not None else port.vlan
        desc = (req.desc if req.desc is not None else port.desc).strip()
        iface = f"interface GigabitEthernet1/0/{port.n}"
        profile = next((p for p in profiles if p.vlan == vlan), None)

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
            f"! NetControl — LIVE target: {self._name or self.host} ({self.host})",
            "configure terminal",
            *body,
            "end",
            "write memory",
        ]
        return CliPreview(target=self._name or self.host, ip=self.host, summary=summary, lines=lines)

    def apply(self, port: Port, req: PortConfigRequest, profiles: list[PortProfile]) -> CliPreview:
        """Envoie réellement la configuration au switch. N'est appelé que
        depuis l'action "Apply" explicite de l'utilisateur dans l'app."""
        from netmiko import ConnectHandler

        preview = self.build_cli(port, req, profiles)
        commands = [l for l in preview.lines if not l.startswith("!") and l not in ("configure terminal", "end", "write memory")]

        with ConnectHandler(**self._device()) as conn:
            conn.enable()
            conn.send_config_set(commands)
            conn.save_config()

        self._cache = None  # force une relecture au prochain poll
        return preview


def _safe_int(s: str, default: int) -> int:
    try:
        return int(s)
    except ValueError:
        return default


RESERVED_VLAN_MAX = 1002  # fddi/token-ring/trnet-default : housekeeping IOS, pas de vraies VLANs


def _parse_vlans(vlan_out: str) -> list[Vlan]:
    rows = _parse_table(vlan_out, "VLAN", ["VLAN", "Name", "Status", "Ports"])
    vlans = []
    for row in rows:
        vid = _safe_int(row["VLAN"], default=-1)
        if 0 <= vid < RESERVED_VLAN_MAX:
            vlans.append(Vlan(id=vid, name=row["Name"]))
    return vlans


def _safe_command(conn, cmd: str) -> str:
    """Certaines commandes ne sont pas supportées selon la plateforme/version
    IOS exacte (ex: 'show env' vs 'show environment') — un échec ici ne doit
    jamais faire perdre les autres données déjà lues (ports, VLANs...)."""
    try:
        return conn.send_command(cmd)
    except Exception as e:  # noqa: BLE001
        logger.info("Commande optionnelle indisponible (%s): %s", cmd, e)
        return ""


def _parse_power_inline(power_out: str) -> dict[str, float]:
    rows = _parse_table(power_out, "Interface", ["Interface", "Admin", "Oper", "Power", "Device", "Class", "Max"])
    out = {}
    for row in rows:
        try:
            out[row["Interface"]] = float(row["Power"])
        except ValueError:
            continue
    return out


def _parse_cpu(cpu_out: str) -> Optional[int]:
    m = re.search(r"CPU utilization for five seconds:\s*(\d+)%", cpu_out)
    return int(m.group(1)) if m else None


def _parse_temp(env_out: str) -> Optional[int]:
    m = re.search(r"Temperature Value:\s*(\d+)", env_out) or re.search(r"(\d+)\s*(?:Degree Celsius|C)\b", env_out)
    if m:
        return int(m.group(1))
    if env_out.strip():
        # Format non reconnu sur cette plateforme — on journalise la sortie
        # brute pour ajuster le parsing (diagnostic seulement, rien de
        # sensible dans "show env").
        logger.info("show env non reconnu, sortie brute:\n%s", env_out)
    return None


def _parse_uptime(version_out: str) -> Optional[str]:
    m = re.search(r"uptime is (.+)", version_out)
    return m.group(1).strip() if m else None


def _parse_model(version_out: str) -> Optional[str]:
    m = re.search(r"Model Number\s*:\s*(\S+)", version_out)
    return m.group(1) if m else None
