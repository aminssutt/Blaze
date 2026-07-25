"""Make the repo root importable so tests can use `inference.metrics` as a
namespace package, without requiring any packaging ticket."""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
