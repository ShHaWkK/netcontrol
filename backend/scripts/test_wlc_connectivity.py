"""Test de connectivité SNMP en lecture seule vers un WLC.

Usage :
    cd backend
    .venv/Scripts/python.exe -m pip install -e ".[real]"
    .venv/Scripts/python.exe scripts/test_wlc_connectivity.py 10.1.10.XX

Ce qu'il faut avoir en main avant de lancer ce script :
  - L'IP de management du WLC.
  - Une communauté SNMP v2c EN LECTURE SEULE (pas "private"), à demander
    à l'équipe réseau/sécurité — ce n'est pas un compte admin web du WLC.
  - Ou, en SNMPv3 (recommandé en prod) : un user + mot de passe
    d'authentification + mot de passe de confidentialité (chiffrement).

⚠️ La partie "liste des AP" (AIRESPACE-WIRELESS-MIB) n'a jamais été
validée contre un vrai contrôleur — dis-moi ce que ce script affiche,
je corrigerai le parsing si le format ne correspond pas.
"""

import sys
from getpass import getpass

from app.providers.wlc_gateway import WlcGateway


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: test_wlc_connectivity.py <ip-du-wlc>")
        sys.exit(1)

    host = sys.argv[1]
    use_v3 = input("SNMPv3 ? (o/n, n = v2c) : ").strip().lower() == "o"

    if use_v3:
        user = input("Utilisateur SNMPv3: ")
        auth_pw = getpass("Mot de passe d'authentification: ")
        priv_pw = getpass("Mot de passe de confidentialité (vide si aucun): ") or None
        gw = WlcGateway(host=host, snmp_version="3", v3_user=user, v3_auth_password=auth_pw, v3_priv_password=priv_pw)
    else:
        community = getpass("Communauté SNMP (lecture seule): ")
        gw = WlcGateway(host=host, snmp_version="2c", community=community)

    print(f"\nÉtape 1 — connectivité SNMP de base (sysDescr) sur {host}...")
    if not gw.probe():
        print("✗ Échec. Vérifier IP, communauté/identifiants, et que le WLC autorise ce poste en SNMP (ACL).")
        sys.exit(1)
    print("✓ Connecté.")

    print("\nÉtape 2 — liste des AP (AIRESPACE-WIRELESS-MIB, best-effort)...")
    try:
        aps = gw.get_aps()
        if not aps:
            print("Aucun AP retourné — soit il n'y en a pas, soit les OID ne correspondent pas à ce modèle de WLC.")
        for ap in aps:
            print(f"  {ap.name:24s} {'associated' if ap.operational else 'down'}")
    except Exception as e:
        print(f"✗ Échec lecture AP : {e}")
        print("  (la connectivité de base fonctionne — c'est juste le parsing MIB à ajuster, dis-le moi)")

    print("\nTest terminé — lecture seule, aucune écriture SNMP envoyée.")


if __name__ == "__main__":
    main()
