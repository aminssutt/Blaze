"""Incident router — endpoints land in a later ticket (structure only)."""

from fastapi import APIRouter

router = APIRouter(prefix="/incident", tags=["incident"])
