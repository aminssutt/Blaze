"""Router registry.

Future routers (incident, approval, dispatch) register here; `backend.api.main`
mounts everything in ALL_ROUTERS. Implementations land in later tickets —
these modules only reserve the structure.
"""

from fastapi import APIRouter

from backend.api.routers.approval import router as approval_router
from backend.api.routers.dispatch import router as dispatch_router
from backend.api.routers.incident import router as incident_router
from backend.streaming.sse import router as streaming_router

ALL_ROUTERS: list[APIRouter] = [
    incident_router,
    approval_router,
    dispatch_router,
    streaming_router,
]
