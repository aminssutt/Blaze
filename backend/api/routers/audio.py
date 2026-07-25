"""Audio endpoints — manifest, playback files, dev ingestion trigger (issue #24)."""

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.loaders.audio_ingestion import AudioIngestionService

router = APIRouter(prefix="/audio", tags=["audio"])

service = AudioIngestionService()


@router.get("/manifest")
async def get_manifest():
    return {"items": service.load_manifest()}


@router.get("/file/{audio_id}")
async def get_audio_file(audio_id: str, variant: Literal["clean", "radio"] = "radio"):
    """Serve a scenario WAV so the frontend timeline can play it."""
    for item in service.load_manifest():
        if item["audio_id"] == audio_id:
            path = service.resolve_path(item, variant)
            if not path.is_file():
                raise HTTPException(status_code=404, detail=f"file missing: {path.name}")
            return FileResponse(path, media_type="audio/wav", filename=path.name)
    raise HTTPException(status_code=404, detail=f"unknown audio_id {audio_id!r}")


class IngestRequest(BaseModel):
    variant: Literal["clean", "radio"] = "radio"
    speed_factor: float = 10.0


@router.post("/ingest")
async def trigger_ingestion(request: Request, body: IngestRequest | None = None):
    """Dev trigger: stream the 5 audio.received events through the bus."""
    body = body or IngestRequest()
    task = asyncio.create_task(
        service.ingest(
            request.app.state.event_bus,
            variant=body.variant,
            speed_factor=body.speed_factor,
        )
    )
    request.app.state.audio_ingest_task = task
    return {"status": "ingestion_started", "variant": body.variant}
