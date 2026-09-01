"""Persistance SQLite de l'historique des switchs (CPU/température/PoE) —
sans ça tout est perdu au moindre redémarrage de conteneur (déploiement,
crash, mise à jour). Un fichier unique dans backend/data/, gitignored comme
le reste de l'inventaire. Aucune dépendance ajoutée (sqlite3 est stdlib).
"""

import sqlite3
import threading
from typing import Optional

from ..config import settings

_lock = threading.Lock()
_RETENTION_DAYS = 30


def _db_path():
    return settings.data_dir / "history.sqlite3"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=5.0)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS switch_history ("
        "switch TEXT NOT NULL, t TEXT NOT NULL, "
        "cpu INTEGER, temp INTEGER, poe REAL)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_switch_t ON switch_history(switch, t)")
    return conn


def append_point(switch: str, t: str, cpu: Optional[int], temp: Optional[int], poe: float) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO switch_history (switch, t, cpu, temp, poe) VALUES (?, ?, ?, ?, ?)",
            (switch, t, cpu, temp, poe),
        )
        # Purge à l'occasion plutôt qu'à chaque écriture — coûteux sinon.
        conn.execute(
            "DELETE FROM switch_history WHERE switch = ? AND t < datetime('now', ?)",
            (switch, f"-{_RETENTION_DAYS} days"),
        )


def load_recent(switch: str, limit: int) -> list[dict]:
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT t, cpu, temp, poe FROM switch_history WHERE switch = ? "
            "ORDER BY t DESC LIMIT ?",
            (switch, limit),
        ).fetchall()
    rows.reverse()
    return [{"t": t, "cpu": cpu, "temp": temp, "poe": poe} for t, cpu, temp, poe in rows]
