"""Router registry.

Future routers (incident, approval, dispatch) register here; `api.main`
mounts everything in ALL_ROUTERS. Implementations land in later tickets —
these modules only reserve the structure.
"""

from fastapi import APIRouter

from api.routers.approval import router as approval_router
from api.routers.dispatch import router as dispatch_router
from api.routers.incident import router as incident_router

ALL_ROUTERS: list[APIRouter] = [
    incident_router,
    approval_router,
    dispatch_router,
]
