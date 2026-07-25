"""Health endpoint with per-component reachability sub-checks.

Every sub-check is best-effort: a missing dependency or an unreachable
service can never make /health fail — degraded components are reported
in the payload and the endpoint always answers 200.
"""

import importlib.util
import shutil

import httpx
from fastapi import APIRouter

from backend.api.config import get_settings

router = APIRouter()

CHECK_TIMEOUT_S = 2.0


async def _check_vllm(base_url: str) -> dict:
    url = f"{base_url.rstrip('/')}/health"
    try:
        async with httpx.AsyncClient(timeout=CHECK_TIMEOUT_S) as client:
            resp = await client.get(url)
        ok = resp.status_code == 200
        return {"status": "ok" if ok else "error", "detail": f"HTTP {resp.status_code}"}
    except httpx.HTTPError as exc:
        return {"status": "unreachable", "detail": type(exc).__name__}


def _check_stt() -> dict:
    if importlib.util.find_spec("faster_whisper") is not None:
        return {"status": "ok", "detail": "faster-whisper importable"}
    return {"status": "not_installed", "detail": "faster-whisper not in this environment"}


def _check_tts(settings) -> dict:
    if shutil.which("piper") is None:
        return {"status": "not_installed", "detail": "piper binary not on PATH"}
    if not settings.piper_voice_path:
        return {"status": "not_configured", "detail": "PIPER_VOICE_PATH empty"}
    voice = settings.resolve_path(settings.piper_voice_path)
    if voice.is_file():
        return {"status": "ok", "detail": str(voice.name)}
    return {"status": "missing", "detail": f"voice model not found: {voice}"}


@router.get("/health")
async def health() -> dict:
    settings = get_settings()
    components = {
        "vllm": await _check_vllm(settings.vllm_base_url),
        "stt": _check_stt(),
        "tts": _check_tts(settings),
    }
    degraded = [name for name, c in components.items() if c["status"] != "ok"]
    return {
        "status": "ok" if not degraded else "degraded",
        "degraded_components": degraded,
        "components": components,
        "network_mode": settings.network_mode,
        "scenario_id": settings.scenario_id,
    }
