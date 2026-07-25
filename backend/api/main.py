"""BLAZE backend — FastAPI application entrypoint.

Run from the backend/ directory:

    uvicorn api.main:app --host $BACKEND_HOST --port $BACKEND_PORT

or simply:

    python -m api.main
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
from api.health import router as health_router
from api.routers import ALL_ROUTERS


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="BLAZE Backend",
        description="Deterministic orchestrator API for the BLAZE incident-response demo.",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    for router in ALL_ROUTERS:
        app.include_router(router)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "api.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
    )
