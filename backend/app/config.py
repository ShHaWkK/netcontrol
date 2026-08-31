from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Configuration NetControl (variables d'environnement NETCONTROL_*, ou
    backend/.env — jamais commité, voir .env.example)."""

    mode: str = "simulation"  # simulation | production
    site_name: str = "Olympic Family Hotel — Terrou-Bi"
    site_location: str = "Dakar, Senegal"
    operator: str = "quentin@bsrq.media"
    data_dir: Path = BACKEND_DIR / "data"
    tick_seconds: float = 3.0
    syslog_seconds: float = 4.5

    # ── Jalon 2 — switch(s) réel(s) via Netmiko ──────────────────────
    # Si `switch_hosts` est vide, NetControl reste 100% simulé (comportement
    # actuel). S'il est renseigné, NetControl tente de joindre chaque switch
    # au démarrage ; ceux qui répondent passent en direct (live=true côté
    # API), les autres et tout ce qui n'a pas de source réelle (WLC WiFi,
    # WAN, alertes) restent simulés — c'est ce qui rend le mode "dynamique".
    switch_hosts: str = ""  # ex: "10.1.10.39,10.1.10.40" (liste séparée par des virgules)
    switch_user: Optional[str] = None
    switch_password: Optional[str] = None
    switch_secret: Optional[str] = None  # enable secret ; vide = identique au password
    switch_device_type: str = "cisco_ios"
    switch_poll_seconds: float = 15.0
    # Ports protégés en plus des trunks/uplinks (toujours protégés par défaut) :
    switch_extra_protected_ports: str = ""  # ex: "Gi1/0/48,Te1/1/3"
    switch_write_enabled: bool = True  # coupe-circuit global pour apply_port_config

    # ── Zabbix — alertes/problèmes réels ──────────────────────────────
    # Vide = pas de source réelle, les alertes restent simulées (dynamique,
    # même principe que les switchs). Zabbix 7.0 : privilégier un API token
    # (Administration > API tokens) plutôt qu'un user/password.
    zabbix_url: str = ""  # ex: "http://10.1.10.50" (sans /api_jsonrpc.php)
    zabbix_token: Optional[str] = None
    zabbix_user: Optional[str] = None
    zabbix_password: Optional[str] = None
    zabbix_poll_seconds: float = 15.0

    # ── WLC WiFi — SNMP (AIRESPACE-WIRELESS-MIB) ──────────────────────
    # Vide = heatmap/AP restent simulés. Ce qu'il faut réunir par WLC :
    #  - IP de management
    #  - SNMP v2c : une communauté en LECTURE SEULE (pas "private"/RW)
    #  - ou SNMP v3 (recommandé en prod) : user + authentification/priv
    # À demander au réseau/sécurité, PAS un compte admin web du WLC — SNMP
    # read-only suffit à tout ce que NetControl affiche.
    # Un ou plusieurs WLC, séparés par des virgules (même principe que les
    # switchs) : ajouter un site/bâtiment = ajouter une IP ici.
    wlc_hosts: str = ""  # ex: "10.1.10.50,10.1.10.51"
    wlc_snmp_version: str = "2c"  # "2c" | "3" — partagé par tous les WLC listés
    wlc_community: Optional[str] = None  # v2c
    wlc_v3_user: Optional[str] = None  # v3
    wlc_v3_auth_password: Optional[str] = None
    wlc_v3_priv_password: Optional[str] = None
    wlc_poll_seconds: float = 15.0

    model_config = {
        "env_prefix": "NETCONTROL_",
        "env_file": str(BACKEND_DIR / ".env"),
        "env_file_encoding": "utf-8",
    }

    @property
    def switch_targets(self) -> list[tuple[str, str]]:
        """Liste (host, device_type). Chaque entrée de switch_hosts peut
        préciser son propre type Netmiko avec 'host:device_type' — utile
        pour mélanger plusieurs modèles/vendeurs (ex: Cisco IOS + NX-OS +
        Aruba) sur le même parc. Sans suffixe, switch_device_type sert de
        valeur par défaut. Ajouter un switch = ajouter une entrée ici,
        rien d'autre à changer dans le code."""
        targets = []
        for entry in self.switch_hosts.split(","):
            entry = entry.strip()
            if not entry:
                continue
            if ":" in entry:
                host, device_type = entry.split(":", 1)
                targets.append((host.strip(), device_type.strip() or self.switch_device_type))
            else:
                targets.append((entry, self.switch_device_type))
        return targets

    @property
    def switch_protected_port_list(self) -> list[str]:
        return [p.strip() for p in self.switch_extra_protected_ports.split(",") if p.strip()]

    @property
    def wlc_host_list(self) -> list[str]:
        return [h.strip() for h in self.wlc_hosts.split(",") if h.strip()]


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
