"""Test de connectivité en lecture seule vers l'API Zabbix.

Usage :
    cd backend
    .venv/Scripts/python.exe -m pip install -e ".[real]"
    .venv/Scripts/python.exe scripts/test_zabbix_connectivity.py http://10.1.10.50

N'appelle que problem.get / host.get (aucune écriture). Le token ou le
mot de passe est saisi en local via getpass — jamais écrit sur disque.
"""

import sys
from getpass import getpass

from app.providers.zabbix_gateway import ZabbixGateway


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: test_zabbix_connectivity.py <url-zabbix, ex: http://10.1.10.50>")
        sys.exit(1)

    url = sys.argv[1]
    use_token = input("Authentification par API token ? (o/n): ").strip().lower() == "o"

    if use_token:
        token = getpass("API token Zabbix: ")
        gw = ZabbixGateway(url=url, token=token)
    else:
        username = input("Utilisateur Zabbix: ")
        password = getpass("Mot de passe: ")
        gw = ZabbixGateway(url=url, username=username, password=password)

    print(f"\nConnexion à {url}...")
    problems = gw.get_problems()
    print(f"✓ Connecté. {len(problems)} problème(s) actif(s) :\n")
    for p in problems[:20]:
        print(f"  [{p.sev:8s}] {p.src:20s} {p.msg}  (depuis {p.since}, acquitté={p.acked})")

    print("\nTest terminé — aucune écriture n'a été envoyée à Zabbix.")


if __name__ == "__main__":
    main()
