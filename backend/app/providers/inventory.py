"""Inventaire des switchs ajoutés dynamiquement depuis l'admin (en plus de
ceux fixés dans backend/.env au démarrage). Persisté dans backend/data/ —
déjà hors de git (voir .gitignore) puisque ça peut contenir des identifiants.
"""

import json
from typing import Optional

from pydantic import BaseModel

from ..config import settings


class SwitchEntry(BaseModel):
    host: str
    device_type: str = "cisco_ios"
    username: Optional[str] = None
    password: Optional[str] = None
    secret: Optional[str] = None


def _inventory_file():
    return settings.data_dir / "switches.json"


def load_inventory() -> list[SwitchEntry]:
    try:
        raw = json.loads(_inventory_file().read_text())
        return [SwitchEntry(**e) for e in raw]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_inventory(entries: list[SwitchEntry]) -> None:
    _inventory_file().write_text(json.dumps([e.model_dump() for e in entries], indent=2))


def upsert(entry: SwitchEntry) -> None:
    entries = [e for e in load_inventory() if e.host != entry.host]
    entries.append(entry)
    save_inventory(entries)


def remove(host: str) -> None:
    save_inventory([e for e in load_inventory() if e.host != host])


class ZabbixConfig(BaseModel):
    url: str
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


def _zabbix_file():
    return settings.data_dir / "zabbix.json"


def load_zabbix() -> Optional[ZabbixConfig]:
    try:
        return ZabbixConfig(**json.loads(_zabbix_file().read_text()))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save_zabbix(cfg: ZabbixConfig) -> None:
    _zabbix_file().write_text(json.dumps(cfg.model_dump(), indent=2))


def clear_zabbix() -> None:
    _zabbix_file().unlink(missing_ok=True)


class WlcConfig(BaseModel):
    host: str
    snmp_version: str = "2c"
    community: Optional[str] = None
    v3_user: Optional[str] = None
    v3_auth_password: Optional[str] = None
    v3_priv_password: Optional[str] = None


def _wlc_file():
    return settings.data_dir / "wlc.json"


def load_wlc() -> Optional[WlcConfig]:
    try:
        return WlcConfig(**json.loads(_wlc_file().read_text()))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def save_wlc(cfg: WlcConfig) -> None:
    _wlc_file().write_text(json.dumps(cfg.model_dump(), indent=2))


def clear_wlc() -> None:
    _wlc_file().unlink(missing_ok=True)


class WanTargetEntry(BaseModel):
    name: str
    host: str


def _wan_file():
    return settings.data_dir / "wan.json"


def load_wan_targets() -> list[WanTargetEntry]:
    try:
        raw = json.loads(_wan_file().read_text())
        return [WanTargetEntry(**e) for e in raw]
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_wan_targets(entries: list[WanTargetEntry]) -> None:
    _wan_file().write_text(json.dumps([e.model_dump() for e in entries], indent=2))


def upsert_wan_target(entry: WanTargetEntry) -> None:
    entries = [e for e in load_wan_targets() if e.name != entry.name]
    entries.append(entry)
    save_wan_targets(entries)


def remove_wan_target(name: str) -> None:
    save_wan_targets([e for e in load_wan_targets() if e.name != name])
