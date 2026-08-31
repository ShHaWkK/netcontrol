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
