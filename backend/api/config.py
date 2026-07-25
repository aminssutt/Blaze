"""Application settings, loaded from the repo-root .env file.

All keys mirror `.env.example` at the repository root. Nothing is hardcoded
in the app itself: hosts, ports and URLs all come from the environment.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/api/config.py -> parents[2] == repository root
_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """BLAZE backend settings (see .env.example at the repo root)."""

    model_config = SettingsConfigDict(
        # Later entries win: a .env in the CWD overrides the repo-root one.
        env_file=(_REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
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
    network_mode: str = "online"

    # Speech
    whisper_model_size: str = "small"
    whisper_language: str = "fr"
    piper_voice_path: str = "speech/tts/piper-voices/fr_FR-siwis-medium.onnx"

    # Backend / frontend
    backend_host: str = "0.0.0.0"
    backend_port: int = 8080
    frontend_port: int = 3000

    @property
    def cors_origins(self) -> list[str]:
        """Frontend origins allowed by CORS."""
        return [
            f"http://localhost:{self.frontend_port}",
            f"http://127.0.0.1:{self.frontend_port}",
        ]


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor (import-time safe, override-friendly in tests)."""
    return Settings()
