# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite (frontend) / FastAPI (backend Python — orchestre l'API Zabbix, Netmiko, le collecteur Vector et l'API Starlink). Ensemble livré en docker-compose reproductible, serveur on-site autonome (NUC/VM), sans dépendance cloud.

## Users

- **Techniciens BSRQ.MEDIA on-site** (2 personnes, présence 07h–22h) : exploitation quotidienne — surveillance, diagnostic, interventions sur les ports switch. Utilisateur principal.
- **Support L3 remote** (nuit) : reçoit les alertes différenciées, accès distant sécurisé pour diagnostic.
- **CIO (Comité International Olympique)** : accès **lecture seule** ; consulte l'état du réseau. Contact : Romain Rossel, Events Technology Manager.
- **Avant attribution du marché** : le CIO est aussi le public de la démo (mode simulation), présentée en local par BSRQ.MEDIA (pilotée en visio ou sur place) — pas d'hébergement public requis.

## Product Purpose

NetControl est l'**interface unique** de supervision et d'exploitation du réseau de l'**Olympic Family Hotel (Terrou-Bi, Dakar)** pendant les JOJ Dakar 2026 (période opérationnelle : **15 octobre – 17 novembre 2026**, délégation CIO ~240 personnes). Zabbix est le socle de collecte mais reste **caché en backend** : personne n'ouvre Zabbix, tout passe par NetControl.

Double objectif :
1. **Mode simulation** — démo au CIO avant attribution du marché (priorité n°1, avec la heatmap WiFi en tête d'affiche).
2. **Production** — usage réel sur site pendant l'événement.

Succès = le CIO retient BSRQ.MEDIA à la pré-qualification, puis les techs exploitent le réseau sans jamais toucher Zabbix ni SSH manuel pour les opérations courantes.

## Positioning

Face à un Zabbix brut (générique, austère, inexploitable par un non-spécialiste), NetControl offre une lecture métier immédiate du réseau de l'hôtel : heatmap WiFi sur plans d'étage façon Ekahau, faceplates de switches manipulables, corrélation alertes/logs. C'est l'outil sur-mesure BSRQ.MEDIA pour ce site et cet événement — pas un dashboard générique.

## Operating Context

Infrastructure supervisée :
- **WLC Cisco 3504 AireOS** (SNMP, AIRESPACE-WIRELESS-MIB) ; AP **Aironet 2800** indoor + **1562** outdoor/mesh.
- **3 SSIDs segmentés VLAN** : `IOC-Staff`, `IOC-Members`, `IOC-Guests`.
- **Switches Catalyst 3650** (PoE+, ~20 drops LAN).
- **2 imprimantes MFP** (Printer-MIB).
- **2 kits Starlink** (API gRPC locale 192.168.100.1 ; sites Terrou-Bi + Azalaï).
- **2 lignes Internet 1 Gbps Sonatel/Orange** — hors périmètre contractuel mais qualité supervisée (ping/perte/jitter).
- **Firewall CheckPoint** — reachability seulement, hors périmètre.
- Syslog des équipements collecté via **Vector**.
- Matériel sourcé via broker (occasion).

Rythme opérationnel : 2 techs on-site 07h–22h, relais L3 remote la nuit ; alerting email + Telegram avec sévérités différenciées jour/nuit.

## Capabilities and Constraints

Modules confirmés :
- **Heatmap WiFi** sur plans d'étage (voir Brand Commitments pour les choix de rendu validés).
- **Dashboard santé** (vue d'ensemble).
- **Vue logs/alertes** : problèmes Zabbix + syslog équipements (Vector), corrélés.
- **Switch Manager** : vue faceplate des switches ; affectation VLAN/description/PoE par port sans SSH manuel ; profils de port (« AP », « Imprimante », « Visio »…) ; backend Netmiko ; garde-fous : ports protégés (uplinks/WLC), prévisualisation CLI avant application, journal d'audit, rollback. **Exclus du module** : trunks, routage, WLC (CLI uniquement).
- **Mode simulation** intégré pour la démo (scénario d'incident de référence : AP-MR2-01 en err-disabled, corrélé entre les vues).

Contraintes :
- Serveur on-site autonome sans cloud ; docker-compose reproductible.
- Accès distant sécurisé ; compte lecture seule pour le CIO.
- **Langue de l'interface : anglais uniquement.** Documentation livrable en français, séparée.
- Méthode de travail exigée : proposer architecture et plan par étapes, **attendre la validation de l'utilisateur avant de générer le code**.

## Brand Commitments

- Nom du produit : **NetControl**. Éditeur : **BSRQ.MEDIA** (l'utilisateur en est Président).
- **Maquette HTML validée** (jugée « très bien ») comme référence visuelle du développement : artifact https://claude.ai/code/artifact/b31be72a-95bb-40db-8005-1c549d2081bd (source : `netcontrol-maquette.html` en scratchpad de session, non versionnée). 4 vues : vue d'ensemble, heatmap, Switch Manager, journaux ; simulateur intégré.
- **Rendu heatmap — choix validés après deux rejets** (à reprendre tels quels) : échelle vert → jaune → orange → rouge en **6 paliers nets** (inversée pour le RSSI : vert = bon) ; interpolation à noyau **très resserré** (sigma 36 px, cutoff 100 px sur plan 1000×640 — zones compactes à l'échelle d'une pièce) ; **infos AP toujours visibles** : nom sous chaque marqueur, valeur dans la pastille, tableau temps réel des AP sous la carte (clients par SSID, canal, bruit, RSSI). Rejeté : dégradé bleu monochrome, interpolation large et floue.

## Evidence on Hand

- Brief complet de l'appel d'offres CIO (sessions précédentes) ; plan par étapes validé par l'utilisateur (⚠️ **non versionné dans ce repo** — à récupérer ou re-valider avant de coder).
- Maquette HTML autonome (artifact ci-dessus) avec scénario d'incident démontrable.
- **Absents, à ne pas fabriquer** : plans d'étage réels du Terrou-Bi, inventaire matériel définitif, identifiants/adressage réels, logos CIO/JOJ (usage soumis aux règles de la marque olympique).

## Product Principles

1. **Interface unique** : aucune tâche courante ne doit renvoyer vers Zabbix ou SSH ; si NetControl ne le couvre pas, c'est explicitement hors périmètre (trunks, routage, WLC).
2. **Lisible d'un coup d'œil** : un tech ou un observateur CIO doit comprendre l'état du réseau en secondes (paliers nets, valeurs visibles, corrélation entre vues).
3. **Sûr par construction** : toute action d'écriture (Switch Manager) passe par garde-fous — ports protégés, préviz CLI, audit, rollback.
4. **Démontrable sans le vrai réseau** : le mode simulation est un citoyen de première classe, pas un bouchon de test.
5. **Autonome et reproductible** : tout tourne on-site en docker-compose, sans dépendance cloud.
