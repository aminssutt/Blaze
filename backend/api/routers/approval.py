"""Approval router — endpoints land in a later ticket (structure only)."""

from fastapi import APIRouter

router = APIRouter(prefix="/approval", tags=["approval"])
