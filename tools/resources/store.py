"""BLAZE seeded scenario store — units, resources, roads, safety rules.

Standalone module (issue #32). Loads `data/scenario/*.json`, exposes them as
tool queries shaped like the ToolResult contract
(contracts/schemas/tool_result.schema.json) with `seeded_demo` provenance.

Radio-event-driven state updates (water 30%, D17 restrictions…) persist for the
duration of a run; `reset()` restores the initial seeded state exactly.
"""

from __future__ import annotations

import copy
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

TOOL_NAME = "scenario_state"

_REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = _REPO_ROOT / "data" / "scenario"

# section -> (seed file, list key, item id key)
SECTIONS: Dict[str, tuple[str, str, str]] = {
    "units": ("units.json", "units", "unit_id"),
    "resources": ("resources.json", "resources", "resource_id"),
    "roads": ("roads.json", "roads", "road_id"),
    "safety_rules": ("safety_rules.json", "rules", "rule_id"),
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ScenarioStore:
    def __init__(self, scenario_dir: Path = SCENARIO_DIR) -> None:
        self._initial: Dict[str, dict] = {}
        for section, (filename, _, _) in SECTIONS.items():
            with (scenario_dir / filename).open() as f:
                self._initial[section] = json.load(f)
        self._state = copy.deepcopy(self._initial)

    # -- queries ------------------------------------------------------------

    def get(self, section: str, tool_call_id: Optional[str] = None) -> dict:
        doc = self._doc(section)
        return self._tool_result(doc, data=copy.deepcopy(doc))

    def get_item(self, section: str, item_id: str) -> dict:
        doc = self._doc(section)
        return self._tool_result(doc, data=copy.deepcopy(self._find(section, item_id)))

    # -- state updates (radio events) ---------------------------------------

    def update(self, section: str, item_id: str, changes: Dict[str, Any]) -> dict:
        """Merge fields into one item (e.g. water_pct=30, status='restricted')."""
        doc = self._doc(section)
        item = self._find(section, item_id)
        item.update(copy.deepcopy(changes))
        return self._tool_result(doc, data=copy.deepcopy(item))

    def reset(self) -> None:
        """Restore the initial seeded state exactly."""
        self._state = copy.deepcopy(self._initial)

    # -- internals ----------------------------------------------------------

    def _doc(self, section: str) -> dict:
        if section not in SECTIONS:
            raise KeyError(f"unknown section {section!r} (expected {sorted(SECTIONS)})")
        return self._state[section]

    def _find(self, section: str, item_id: str) -> dict:
        _, list_key, id_key = SECTIONS[section]
        for item in self._doc(section)[list_key]:
            if item[id_key] == item_id:
                return item
        raise KeyError(f"unknown {section} id {item_id!r}")

    def _tool_result(self, doc: dict, data: Any) -> dict:
        return {
            "tool_call_id": f"tc-{uuid.uuid4().hex[:12]}",
            "tool_name": TOOL_NAME,
            "status": "success",
            "data": data,
            "source_type": "seeded_demo",
            "source_name": doc.get("source_name", "scenario"),
            "retrieved_at": _utcnow_iso(),
            "is_cached": False,
        }


_default_store: Optional[ScenarioStore] = None


def get_store() -> ScenarioStore:
    global _default_store
    if _default_store is None:
        _default_store = ScenarioStore()
    return _default_store
