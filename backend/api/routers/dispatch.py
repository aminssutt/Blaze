"""Dispatch endpoints — SIMULATED radio dispatch + per-unit Piper TTS (issue #35).

No real transmission happens anywhere here: every send is labeled
`simulated_dispatch`. Approval gating on top of these endpoints lands with
issue #34.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.api.config import get_settings
from speech.tts.service import TTSService

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

DELIVERY_LABEL = "simulated_dispatch"

_tts_service: TTSService | None = None


def get_tts() -> TTSService:
    global _tts_service
    if _tts_service is None:
        # PIPER_VOICE_PATH lives in .env, loaded by pydantic-settings — pass it
        # explicitly, the service only falls back to os.environ standalone.
        _tts_service = TTSService(voice_path=get_settings().piper_voice_path or None)
    return _tts_service


class DispatchInstruction(BaseModel):
    """Mirrors contracts/schemas/dispatch_instruction.schema.json."""

    dispatch_id: str
    plan_id: str
    unit_id: str
    priority: Literal["low", "medium", "high", "critical"]
    message_text: str
    acknowledgement_required: bool
    tts_audio_path: str | None = None
    generated_at: str
    dispatch_status: Literal[
        "pending", "tts_generating", "ready", "sent", "acknowledged", "failed"
    ] = "pending"


class SendRequest(BaseModel):
    instructions: list[DispatchInstruction]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.post("/send")
async def send_dispatch(request: Request, body: SendRequest):
    """Simulated per-unit dispatch: TTS each message, emit events, never crash."""
    bus = request.app.state.event_bus
    tts = get_tts()
    results = []
    for instruction in body.instructions:
        await bus.publish(
            "tts.started",
            {"dispatch_id": instruction.dispatch_id, "unit_id": instruction.unit_id},
        )
        tts_result = tts.synthesize(
            instruction.message_text, f"dispatch_{instruction.unit_id}.wav"
        )
        if tts_result["status"] == "success":
            instruction.tts_audio_path = tts_result["wav_path"]
            instruction.dispatch_status = "sent"
            await bus.publish(
                "tts.ready",
                {
                    "dispatch_id": instruction.dispatch_id,
                    "unit_id": instruction.unit_id,
                    "tts_audio_path": tts_result["wav_path"],
                    "latency_ms": tts_result["latency_ms"],
                },
            )
        else:
            instruction.tts_audio_path = None
            instruction.dispatch_status = "sent"  # text still goes out, simulated
            await bus.publish(
                "fallback.activated",
                {
                    "fallback": "tts_text_only",
                    "dispatch_id": instruction.dispatch_id,
                    "unit_id": instruction.unit_id,
                    "reason": tts_result.get("error", "tts unavailable"),
                    "fallback_text": tts_result["fallback_text"],
                },
            )
        await bus.publish(
            "dispatch.sent",
            {
                "dispatch_id": instruction.dispatch_id,
                "unit_id": instruction.unit_id,
                "delivery": DELIVERY_LABEL,
                "sent_at": _now(),
                "acknowledgement_required": instruction.acknowledgement_required,
            },
        )
        results.append(
            {
                "instruction": instruction.model_dump(),
                "tts": tts_result,
                "delivery": DELIVERY_LABEL,
            }
        )
    return {"delivery": DELIVERY_LABEL, "results": results}


@router.get("/audio/{unit_id}")
async def get_dispatch_audio(unit_id: str):
    """Serve the generated per-unit WAV so the frontend can play it."""
    wav = get_tts().output_dir / f"dispatch_{unit_id}.wav"
    if not wav.is_file():
        raise HTTPException(status_code=404, detail=f"no dispatch audio for {unit_id}")
    return FileResponse(wav, media_type="audio/wav", filename=wav.name)
