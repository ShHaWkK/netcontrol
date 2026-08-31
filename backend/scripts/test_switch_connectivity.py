"""Test de connectivité SSH en lecture seule vers un switch réel.

Usage :
    cd backend
    .venv/Scripts/python.exe -m pip install -e ".[real]"
    .venv/Scripts/python.exe scripts/test_switch_connectivity.py 10.1.10.39

N'envoie que des commandes "show" (aucune écriture, aucune config touchée).
Le mot de passe est saisi en local via getpass — il ne transite jamais
ailleurs, n'est jamais écrit sur disque ni journalisé.
"""

import sys
from getpass import getpass

from netmiko import ConnectHandler


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: test_switch_connectivity.py <ip-du-switch>")
        sys.exit(1)

    host = sys.argv[1]
    username = input("Utilisateur SSH: ")
    password = getpass("Mot de passe SSH: ")
    secret = getpass("Enable secret (vide si identique au mot de passe): ") or password

    device = {
        "device_type": "cisco_ios",
        "host": host,
        "username": username,
        "password": password,
        "secret": secret,
    }

    print(f"\nConnexion à {host}...")
    with ConnectHandler(**device) as conn:
        conn.enable()
        print("✓ Connecté et en mode enable.\n")

        print("── show version ──")
        print(conn.send_command("show version | include Model|Version|uptime"))

        print("\n── show interfaces status ──")
        print(conn.send_command("show interfaces status"))

        print("\n── show vlan brief ──")
        print(conn.send_command("show vlan brief"))

    print("\nTest terminé — aucune commande d'écriture n'a été envoyée.")


if __name__ == "__main__":
    main()
