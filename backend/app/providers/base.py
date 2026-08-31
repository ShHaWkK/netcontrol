from abc import ABC, abstractmethod
from typing import Optional

from ..models import (
    Alert,
    Ap,
    CliPreview,
    LogEntry,
    PortConfigRequest,
    Snapshot,
    Vlan,
)


class DataProvider(ABC):
    """Contrat commun à toutes les sources de données NetControl.

    Jalon 1 : SimulationProvider. Jalon 2 : ZabbixProvider (SNMP/API) et
    NetmikoProvider (Switch Manager) implémenteront ce même contrat — le
    frontend ne change pas.
    """

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    def snapshot(self) -> Snapshot: ...

    @abstractmethod
    def get_aps(self) -> list[Ap]: ...

    @abstractmethod
    def set_ap_position(self, ap_id: str, x: float, y: float) -> Ap: ...

    @abstractmethod
    def get_alerts(self) -> list[Alert]: ...

    @abstractmethod
    def ack_alert(self, alert_id: int) -> Alert: ...

    @abstractmethod
    def get_logs(
        self,
        type_: Optional[str] = None,
        sev: Optional[str] = None,
        query: Optional[str] = None,
        limit: int = 120,
    ) -> list[LogEntry]: ...

    @abstractmethod
    def preview_port_config(
        self, switch_name: str, port_n: int, req: PortConfigRequest
    ) -> CliPreview: ...

    @abstractmethod
    def apply_port_config(
        self, switch_name: str, port_n: int, req: PortConfigRequest
    ) -> CliPreview: ...

    @abstractmethod
    def get_vlans(self) -> list[Vlan]:
        """Liste des VLANs à proposer dans le Switch Manager — réels si un
        switch live existe, simulés sinon."""
        ...
