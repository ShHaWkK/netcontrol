#!/usr/bin/env bash
# NetControl — connecte Zabbix (alertes/problèmes réels) sans tout
# réinstaller. Écrit backend/.env, redémarre juste le backend (pas de
# rebuild nécessaire, c'est de la config, pas du code), et vérifie.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f backend/.env ]; then
  echo "✗ backend/.env n'existe pas — lance d'abord ./install.sh"
  exit 1
fi

echo "=== Connexion Zabbix ==="
read -rp "URL Zabbix (ex: http://10.1.10.50, sans /api_jsonrpc.php) : " zbx_url

use_token="n"
read -rp "Authentification par API token ? (o/n, n = user/password) : " use_token

# nettoie les anciennes valeurs pour ne pas mélanger token et user/password
sed -i '/^NETCONTROL_ZABBIX_/d' backend/.env
{
  echo "NETCONTROL_ZABBIX_URL=${zbx_url}"
  if [ "$use_token" = "o" ]; then
    read -rsp "API token Zabbix : " zbx_token; echo
    echo "NETCONTROL_ZABBIX_TOKEN=${zbx_token}"
  else
    read -rp "Utilisateur Zabbix : " zbx_user
    read -rsp "Mot de passe : " zbx_pass; echo
    echo "NETCONTROL_ZABBIX_USER=${zbx_user}"
    echo "NETCONTROL_ZABBIX_PASSWORD=${zbx_pass}"
  fi
} >> backend/.env

echo
echo "Redémarrage du backend (config seule, pas de rebuild)..."
docker compose up -d --force-recreate backend

echo "Attente..."
for i in $(seq 1 15); do
  curl -fs http://localhost:8000/api/health >/dev/null 2>&1 && break
  sleep 1
done

echo
result=$(curl -fs http://localhost:8000/api/state 2>/dev/null | grep -o '"alerts_live":[a-z]*' || echo "injoignable")
echo "État : ${result}"
if echo "$result" | grep -q "true"; then
  echo "✓ Zabbix connecté — les alertes de l'Overview sont maintenant réelles."
else
  echo "⚠️  Toujours pas connecté. Vérifie :"
  echo "   docker compose logs backend | grep -i zabbix"
  echo "   curl -v ${zbx_url}/api_jsonrpc.php   (doit répondre, pas de timeout)"
fi
