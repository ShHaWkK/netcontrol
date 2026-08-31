#!/usr/bin/env bash
# NetControl — installe Zabbix (serveur + base de données + interface web)
# via docker-compose, sur cette même machine. Ensuite : connect-zabbix.sh
# pour brancher NetControl dessus.
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Installation Zabbix (serveur + DB + web) ==="
echo
echo "Démarrage des conteneurs zabbix-db, zabbix-server, zabbix-web..."
docker compose up -d zabbix-db zabbix-server zabbix-web

echo
echo "Attente du démarrage (la première fois, l'initialisation de la base"
echo "de données Zabbix peut prendre 1-2 minutes)..."
for i in $(seq 1 60); do
  if curl -fs http://localhost:8081 >/dev/null 2>&1; then
    echo "✓ Interface web Zabbix disponible."
    break
  fi
  sleep 2
done

ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<IP-de-ce-serveur>")

cat <<EOF

════════════════════════════════════════════════════════════════
  Zabbix est installé. Étapes MANUELLES restantes (une seule fois) :
════════════════════════════════════════════════════════════════

1. Ouvre http://${ip}:8081 (ou http://localhost:8081 sur cette machine)
2. Connecte-toi : Admin / zabbix
3. ⚠️  Change immédiatement ce mot de passe (Administration > Users > Admin)
4. Crée un API token : Administration > API tokens > Create token
   - Nom libre (ex: "netcontrol")
   - Ne coche PAS d'expiration si tu ne veux pas le refaire régulièrement
   - Copie le token affiché — il ne sera plus jamais visible ensuite
5. Reviens ici et lance :
   ./connect-zabbix.sh
   → URL : http://zabbix-web:8080   (nom du service, PAS localhost — le
     backend NetControl tourne dans un autre conteneur Docker)
   → colle le token à l'étape demandée

════════════════════════════════════════════════════════════════

Ensuite, pour que Zabbix surveille réellement quelque chose (switchs,
bornes WiFi, imprimantes...), il faudra créer des "hosts" Zabbix avec
leurs items SNMP/agent — je peux t'aider à préparer ces templates une
fois que tu me dis quels équipements sont prêts à être ajoutés.
EOF
