"""Health endpoint with best-effort component sub-checks.

Every sub-check is wrapped so that a missing dependency or an unreachable
service can NEVER make /health fail: degraded components are reported in
the payload, and the endpoint always answers 200.
"""

import importlib.util
import shutil

import httpx
from fastapi import APIRouter

from api.config import get_settings

router = APIRouter(tags=["health"])

VLLM_PING_TIMEOUT_S = 2.0


async def check_vllm() -> dict:
    """Ping VLLM_BASE_URL/health with a short timeout."""
    settings = get_settings()
    url = settings.vllm_base_url.rstrip("/") + "/health"
    try:
        async with httpx.AsyncClient(timeout=VLLM_PING_TIMEOUT_S) as client:
            response = await client.get(url)
        if response.status_code == 200:
            return {"status": "ok", "url": url}
        return {"status": "unreachable", "url": url, "detail": f"HTTP {response.status_code}"}
    except Exception as exc:  # noqa: BLE001 — best-effort check, never raise
        return {"status": "unreachable", "url": url, "detail": type(exc).__name__}


def check_stt() -> dict:
    """STT is available if the faster_whisper package is importable."""
    try:
        installed = importlib.util.find_spec("faster_whisper") is not None
    except Exception:  # noqa: BLE001 — best-effort check, never raise
        installed = False
    return {"status": "ok" if installed else "not_installed", "engine": "faster-whisper"}


def check_tts() -> dict:
    """TTS is available if the piper binary is on PATH."""
    try:
        binary = shutil.which("piper")
    except Exception:  # noqa: BLE001 — best-effort check, never raise
        binary = None
    return {"status": "ok" if binary else "not_installed", "engine": "piper"}


@router.get("/health")
async def health() -> dict:
    """Global status plus per-component sub-checks. Always answers 200."""
    settings = get_settings()
    checks = {
        "vllm": await check_vllm(),
        "stt": check_stt(),
        "tts": check_tts(),
    }
    all_ok = all(check["status"] == "ok" for check in checks.values())
    return {
        "status": "ok" if all_ok else "degraded",
        "demo_mode": settings.demo_mode,
        "network_mode": settings.network_mode,
        "checks": checks,
    }
