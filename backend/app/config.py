from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuration NetControl (variables d'environnement NETCONTROL_*)."""

    mode: str = "simulation"  # simulation | production
    site_name: str = "Olympic Family Hotel — Terrou-Bi"
    site_location: str = "Dakar, Senegal"
    operator: str = "quentin@bsrq.media"
    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    tick_seconds: float = 3.0
    syslog_seconds: float = 4.5

    model_config = {"env_prefix": "NETCONTROL_"}


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
