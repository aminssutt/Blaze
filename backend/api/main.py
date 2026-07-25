"""BLAZE backend entrypoint.

Run from the repo root:
    uvicorn backend.api.main:app --host $BACKEND_HOST --port $BACKEND_PORT
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.config import get_settings
from backend.api.health import router as health_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BLAZE backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    return app


app = create_app()
