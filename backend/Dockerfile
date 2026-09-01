FROM python:3.12-slim

# iputils-ping : nécessaire pour la sonde WAN réelle (latence/perte ICMP) —
# absent de l'image slim par défaut.
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/netcontrol
COPY pyproject.toml ./
COPY app ./app
# [real] : dépendances des providers réels (Netmiko, Zabbix) — sans matériel
# configuré (backend/.env vide), l'app tourne pareil en 100% simulation.
RUN pip install --no-cache-dir ".[real]"

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
