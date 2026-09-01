"""Passerelle SNMP vers un WLC Cisco (AIRESPACE-WIRELESS-MIB).

Lecture seule stricte : uniquement des GET/WALK SNMP, jamais de SET.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("netcontrol.wlc")

SYS_DESCR = "1.3.6.1.2.1.1.1.0"

# AIRESPACE-WIRELESS-MIB — table des AP (un OID par colonne, indexé par AP) :
BSN_AP_NAME = "1.3.6.1.4.1.14179.2.2.1.1.3"
BSN_AP_OPER_STATUS = "1.3.6.1.4.1.14179.2.2.1.1.6"  # 1=associated


@dataclass
class ApInfo:
    name: str
    operational: bool


@dataclass
class WlcGateway:
    host: str
    snmp_version: str = "2c"  # "2c" | "3"
    community: Optional[str] = None
    v3_user: Optional[str] = None
    v3_auth_password: Optional[str] = None
    v3_priv_password: Optional[str] = None
    port: int = 161
    timeout: float = 4.0

    def _auth_data(self):
        from pysnmp.hlapi.asyncio import CommunityData, UsmUserData
        from pysnmp.hlapi.asyncio import usmHMACSHAAuthProtocol, usmAesCfb128Protocol

        if self.snmp_version == "3":
            if not self.v3_user:
                raise ValueError("WLC SNMPv3 : wlc_v3_user manquant")
            return UsmUserData(
                self.v3_user,
                authKey=self.v3_auth_password,
                privKey=self.v3_priv_password,
                authProtocol=usmHMACSHAAuthProtocol if self.v3_auth_password else None,
                privProtocol=usmAesCfb128Protocol if self.v3_priv_password else None,
            )
        if not self.community:
            raise ValueError("WLC SNMPv2c : wlc_community manquant")
        return CommunityData(self.community, mpModel=1)

    async def _get(self, oid: str) -> str:
        from pysnmp.hlapi.asyncio import (
            SnmpEngine, ContextData, ObjectType, ObjectIdentity, UdpTransportTarget, getCmd,
        )

        transport = UdpTransportTarget((self.host, self.port), timeout=self.timeout)
        err_ind, err_status, _, var_binds = await getCmd(
            SnmpEngine(), self._auth_data(), transport, ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
        if err_ind:
            raise RuntimeError(str(err_ind))
        if err_status:
            raise RuntimeError(str(err_status.prettyPrint()))
        return str(var_binds[0][1])

    async def _walk(self, base_oid: str) -> list[tuple[str, str]]:
        from pysnmp.hlapi.asyncio import (
            SnmpEngine, ContextData, ObjectType, ObjectIdentity, UdpTransportTarget, nextCmd,
        )

        transport = UdpTransportTarget((self.host, self.port), timeout=self.timeout)
        engine = SnmpEngine()
        auth = self._auth_data()
        results = []
        obj = ObjectType(ObjectIdentity(base_oid))
        for _ in range(256):  # garde-fou : jamais de boucle infinie sur un WLC qui répond mal
            err_ind, err_status, _, var_binds = await nextCmd(
                engine, auth, transport, ContextData(), obj, lexicographicMode=False,
            )
            if err_ind or err_status or not var_binds:
                break
            name, val = var_binds[0]
            oid_str = str(name)
            if not oid_str.startswith(base_oid):
                break
            results.append((oid_str, str(val)))
            obj = ObjectType(ObjectIdentity(name))
        return results

    def probe(self) -> bool:
        """SNMP GET sysDescr — MIB universelle, valide la connectivité +
        les identifiants sans dépendre d'AIRESPACE-WIRELESS-MIB."""
        try:
            descr = asyncio.run(self._get(SYS_DESCR))
            logger.info("WLC %s joignable en SNMP : %s", self.host, descr)
            return True
        except Exception as e:  # noqa: BLE001
            logger.warning("WLC %s injoignable en SNMP : %s", self.host, e)
            return False

    def get_aps(self) -> list[ApInfo]:
        """Best-effort — non validé contre un vrai WLC, voir avertissement
        en tête de fichier."""
        names = asyncio.run(self._walk(BSN_AP_NAME))
        status = dict(asyncio.run(self._walk(BSN_AP_OPER_STATUS)))
        aps = []
        for oid, name in names:
            idx = oid.rsplit(".", 1)[-1]
            status_oid = f"{BSN_AP_OPER_STATUS}.{idx}"
            aps.append(ApInfo(name=name, operational=status.get(status_oid) == "1"))
        return aps
