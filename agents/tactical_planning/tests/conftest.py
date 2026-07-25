"""Make `agents.tactical_planning.*` importable when pytest runs from agents/tactical_planning (or repo root)."""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
