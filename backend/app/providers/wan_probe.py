"""Sonde WAN — latence/perte réelles vers une cible (IP publique, passerelle
opérateur...) via ping ICMP système. Lecture seule : jamais de commande
d'écriture, juste `ping -c 1`.
"""

import logging
import re
import statistics
import subprocess
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

from ..models import WanLink

logger = logging.getLogger("netcontrol.wan")

_TIME_RE = re.compile(r"time[=<]([\d.]+)")


@dataclass
class WanProbe:
    name: str
    host: str
    timeout: float = 1.5

    _latency: "deque[int]" = field(default_factory=lambda: deque(maxlen=60), init=False, repr=False)
    _attempts: "deque[bool]" = field(default_factory=lambda: deque(maxlen=20), init=False, repr=False)

    def ping_once(self) -> Optional[int]:
        try:
            out = subprocess.run(
                ["ping", "-c", "1", "-W", str(max(1, int(self.timeout))), self.host],
                capture_output=True, text=True, timeout=self.timeout + 2,
            )
            m = _TIME_RE.search(out.stdout)
            if out.returncode == 0 and m:
                ms = round(float(m.group(1)))
                self._latency.append(ms)
                self._attempts.append(True)
                return ms
        except Exception as e:  # noqa: BLE001
            logger.warning("Ping %s (%s) échoué: %s", self.name, self.host, e)
        self._attempts.append(False)
        return None

    def probe(self) -> bool:
        """Test de connectivité pour la connexion à chaud — ne lève jamais."""
        return self.ping_once() is not None

    def snapshot(self) -> WanLink:
        latency = list(self._latency)
        jitter = round(statistics.pstdev(latency), 1) if len(latency) >= 2 else 0.0
        loss_pct = round(100 * (1 - sum(self._attempts) / len(self._attempts)), 1) if self._attempts else 0.0
        return WanLink(
            name=self.name, sub=self.host,
            latency=latency or [0],
            jitter=jitter,
            loss=f"{loss_pct}%",
        )
