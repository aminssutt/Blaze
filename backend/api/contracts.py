"""Frozen-contract validation for API intake (finding from #55).

A plan whose actions drift from the contract (e.g. `description` instead of
`instruction`) silently degrades the Dispatch Agent to generic messages —
intake is the right place to fail loudly.
"""

import json
from functools import lru_cache

from jsonschema import Draft7Validator
from referencing import Registry, Resource

from backend.api.config import REPO_ROOT

SCHEMA_DIR = REPO_ROOT / "contracts" / "schemas"


@lru_cache(maxsize=None)
def _registry() -> Registry:
    resources = [
        Resource.from_contents(json.loads(path.read_text(encoding="utf-8")))
        for path in SCHEMA_DIR.glob("*.schema.json")
    ]
    return Registry().with_resources((r.id(), r) for r in resources)


@lru_cache(maxsize=None)
def _validator(schema_name: str) -> Draft7Validator:
    schema = json.loads((SCHEMA_DIR / f"{schema_name}.schema.json").read_text(encoding="utf-8"))
    return Draft7Validator(schema, registry=_registry())


def contract_errors(schema_name: str, instance: dict) -> list[str]:
    """Human-readable validation errors of `instance` against a frozen contract."""
    return [
        f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
        for error in _validator(schema_name).iter_errors(instance)
    ]
