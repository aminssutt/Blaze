"""Backend configuration — everything comes from .env, nothing hardcoded."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Model and inference
    gemma_model_id: str = ""
    hf_token: str = ""
    vllm_base_url: str = "http://localhost:8000"
    vllm_api_key: str = "local-only-placeholder"

    # External data
    nasa_firms_map_key: str = ""

    # Scenario
    scenario_id: str = "wildfire-demo-01"
    demo_mode: bool = True
    use_cached_external_data: bool = True
    network_mode: str = "online"  # online | offline

    # Speech
    whisper_model_size: str = "small"
    whisper_language: str = "fr"
    piper_voice_path: str = ""

    # Backend/frontend
    backend_host: str = "0.0.0.0"
    backend_port: int = 8080
    frontend_port: int = 3000

    @property
    def cors_origins(self) -> list[str]:
        return [
            f"http://localhost:{self.frontend_port}",
            f"http://127.0.0.1:{self.frontend_port}",
        ]

    def resolve_path(self, value: str) -> Path:
        """Resolve a .env path relative to the repo root."""
        p = Path(value)
        return p if p.is_absolute() else REPO_ROOT / p


@lru_cache
def get_settings() -> Settings:
    return Settings()
