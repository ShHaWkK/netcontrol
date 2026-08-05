# NetControl

Supervision réseau de l'**Olympic Family Hotel (Terrou-Bi, Dakar)** pour les JOJ Dakar 2026 — BSRQ.MEDIA.

NetControl est l'interface unique d'exploitation du réseau CIO : heatmap WiFi sur plan d'étage, vue de santé globale, Switch Manager (provisioning des ports sans SSH) et journaux corrélés (syslog, alertes, audit). Zabbix sert de socle de collecte en production, entièrement caché derrière NetControl.

## État actuel — Jalon 1 : mode simulation

L'application tourne avec un **provider de données simulé** (aucun équipement requis) destiné à la démonstration au CIO. Le simulateur reproduit une journée d'exploitation réaliste : 13 AP (Aironet 2800 + 1562), 2 switches Catalyst 3650, 3 SSIDs segmentés, WAN Sonatel/Orange/Starlink, et un **scénario d'incident intégré** (AP-MR2-01 en err-disabled, résoluble depuis le Switch Manager).

L'architecture backend repose sur une couche `DataProvider` abstraite ([backend/app/providers/base.py](backend/app/providers/base.py)) : les jalons suivants brancheront les providers réels (API Zabbix, SNMP `AIRESPACE-WIRELESS-MIB`, Netmiko) sans modifier le frontend.

## Lancement

### Docker (recommandé)

```bash
docker compose up --build
```

- Interface : http://localhost:8080
- API (OpenAPI) : http://localhost:8000/docs

### Développement local

```bash
# Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/uvicorn app.main:app --reload          # → :8000

# Frontend (autre terminal)
cd frontend
npm install
npm run dev                                       # → :5173 (proxy /api et /ws vers :8000)
```

## Scénario de démonstration

L'interface est en anglais (exigence produit) ; la documentation reste en français.

1. **Overview** : une alerte critique est active — AP-MR2-01 injoignable.
2. **WiFi Heatmap** : l'AP MR2-01 apparaît en ✕ rouge sur Meeting Room 2 (zone sans couverture). Métriques commutables (clients, utilisation canal, bruit, RSSI), filtre par SSID, mode édition pour repositionner les AP (positions persistées).
3. **Switch Manager** : sur SW-EDGE-01, le port Gi1/0/12 est en err-disabled (rouge). Le sélectionner → profil « Access point » → *Preview commands* → *Apply*.
4. Résolution corrélée : le port repasse up, l'AP rejoint le WLC (syslog `%CAPWAP-5-JOIN`), l'alerte critique disparaît, la heatmap se recolore — le tout en temps réel (WebSocket, tick 3 s).
5. **Logs** : chaque action est tracée (audit `quentin@bsrq.media`, syslog `%SYS-5-CONFIG_I`).

Les uplinks, ports WLC et le port du serveur NetControl sont **protégés en lecture seule** : impossible de se couper soi-même depuis l'outil.

## Architecture

```
backend/   FastAPI (Python 3.12) — REST + WebSocket /ws, tick 3 s
  app/providers/base.py         Contrat DataProvider (abstrait)
  app/providers/simulation.py   Simulateur (port fidèle de la maquette validée)
frontend/  React 18 + TypeScript + Vite — 4 vues, thème clair/sombre
docs/maquette-reference.html    Maquette HTML validée (référence visuelle)
```

La heatmap suit les choix validés : échelle vert → jaune → orange → rouge en 6 paliers nets (inversée pour le RSSI), interpolation IDW gaussienne resserrée (σ = 36 px, cutoff 100 px sur plan 1000×640), nom et valeur de chaque AP toujours visibles, tableau temps réel sous la carte.

## Feuille de route

- **Jalon 2 — providers réels** : API Zabbix 7.0 LTS (+ docker-compose Zabbix/PostgreSQL), SNMP WLC 3504 (`AIRESPACE-WIRELESS-MIB`), Netmiko pour le Switch Manager (garde-fous : préviz CLI, sauvegarde running-config, rollback, audit), collecteur syslog Vector, API Starlink locale (gRPC 192.168.100.1).
- **Jalon 3 — durcissement** : authentification + rôle lecture seule CIO, alerting email/Telegram avec sévérités différenciées jour (07 h–22 h) / nuit (astreinte L3), sauvegardes, documentation d'exploitation.

© BSRQ.MEDIA 2026
