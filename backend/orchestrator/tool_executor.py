"""BLAZE tool executor — deterministic, audited execution of Gemma tool calls.

``ToolExecutor.execute(tool_request) -> tool_result`` (issue #26):

  1. The incoming ToolRequest is validated against the frozen contract
     (contracts/schemas/tool_request.schema.json). A malformed envelope is a
     caller bug and raises :class:`ToolRequestContractError` — nothing runs.
  2. Unknown tool name  -> status="error", error starts with
     ``tool_not_allowlisted`` — NEVER executed.
  3. Allowlisted stub not merged yet -> ``tool_unavailable`` — never executed.
  4. Arguments are validated against the tool's own JSON Schema; any
     violation -> ``invalid_arguments: <jsonschema details>`` — never executed
     (no partial execution).
  5. The handler runs in a worker thread bounded by the tool's timeout.
     On timeout, if the tool supports it (``supports_cached_mode``) the
     callable is re-invoked with ``mode="cached"`` -> status="fallback",
     ``is_cached=true`` + staleness; otherwise status="timeout".
  6. On success the adapter's ToolResult (provenance: source_type /
     source_name / retrieved_at / is_cached / staleness_seconds) is passed
     through, re-keyed to the request's tool_call_id / registry tool name,
     and validated against contracts/schemas/tool_result.schema.json.
  7. EVERY request/result pair is appended to an in-memory append-only audit
     journal (:class:`ToolAuditLog`), each pair re-validated against both
     frozen schemas at append time, exportable as JSONL.

No eval, no exec, no dynamic import: the registry is the only path to code.
"""

from __future__ import annotations

import copy
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from jsonschema import Draft7Validator, FormatChecker

from backend.orchestrator.tool_registry import (
    ToolRegistry,
    ToolSpec,
    build_default_registry,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL_REQUEST_SCHEMA_PATH = _REPO_ROOT / "contracts" / "schemas" / "tool_request.schema.json"
TOOL_RESULT_SCHEMA_PATH = _REPO_ROOT / "contracts" / "schemas" / "tool_result.schema.json"

#: Keys whose presence marks an adapter return value as ToolResult-shaped.
_TOOL_RESULT_MARKER_KEYS = {"status", "source_type", "retrieved_at"}


class ToolRequestContractError(ValueError):
    """The ToolRequest envelope itself violates the frozen contract."""


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_schema(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _build_validator(schema: Dict[str, Any]) -> Draft7Validator:
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema, format_checker=FormatChecker())


def _schema_errors(validator: Draft7Validator, instance: Any) -> List[str]:
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in errors
    ]


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

class ToolAuditLog:
    """Append-only in-memory journal of ToolRequest/ToolResult pairs.

    Every pair is validated against the frozen contract schemas at append
    time, so the journal can only ever contain contract-valid pairs.
    Exportable as JSONL (one ``{"logged_at", "request", "result"}`` object
    per line).
    """

    def __init__(self) -> None:
        self._entries: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._request_validator = _build_validator(_load_schema(TOOL_REQUEST_SCHEMA_PATH))
        self._result_validator = _build_validator(_load_schema(TOOL_RESULT_SCHEMA_PATH))

    def append(self, request: Mapping[str, Any], result: Mapping[str, Any]) -> None:
        request_errors = _schema_errors(self._request_validator, dict(request))
        if request_errors:
            raise ValueError(f"audit refused: ToolRequest violates contract: {request_errors}")
        result_errors = _schema_errors(self._result_validator, dict(result))
        if result_errors:
            raise ValueError(f"audit refused: ToolResult violates contract: {result_errors}")
        entry = {
            "logged_at": _utcnow_iso(),
            "request": copy.deepcopy(dict(request)),
            "result": copy.deepcopy(dict(result)),
        }
        with self._lock:
            self._entries.append(entry)

    def entries(self) -> List[Dict[str, Any]]:
        """Snapshot copy — the internal journal cannot be mutated from outside."""
        with self._lock:
            return copy.deepcopy(self._entries)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)

    def export_jsonl(self, path: Path | str) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            lines = [json.dumps(e, ensure_ascii=False) for e in self._entries]
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        return path


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

class ToolExecutor:
    """Executes contract-valid ToolRequests through the allowlist registry."""

    def __init__(
        self,
        registry: Optional[ToolRegistry] = None,
        audit_log: Optional[ToolAuditLog] = None,
    ) -> None:
        self.registry = registry if registry is not None else build_default_registry()
        self.audit_log = audit_log if audit_log is not None else ToolAuditLog()
        self._request_validator = _build_validator(_load_schema(TOOL_REQUEST_SCHEMA_PATH))
        self._result_validator = _build_validator(_load_schema(TOOL_RESULT_SCHEMA_PATH))

    # -- public API ---------------------------------------------------------

    def execute(self, request: Mapping[str, Any]) -> Dict[str, Any]:
        """Validate, execute (or reject) one tool call and audit the pair."""
        request = dict(request)
        envelope_errors = _schema_errors(self._request_validator, request)
        if envelope_errors:
            # Malformed envelope: the orchestrator (not the model) builds the
            # envelope, so this is an internal bug — refuse loudly, run nothing.
            raise ToolRequestContractError(
                f"ToolRequest violates contract: {'; '.join(envelope_errors)}"
            )

        tool_name = request["tool_name"]
        tool_call_id = request["tool_call_id"]
        arguments = request["arguments"]

        spec = self.registry.get(tool_name)
        if spec is None:
            result = self._error_result(
                tool_call_id,
                tool_name,
                error=f"tool_not_allowlisted: '{tool_name}' is not in the tool registry",
            )
        elif not spec.available:
            result = self._error_result(
                tool_call_id,
                tool_name,
                error=(
                    f"tool_unavailable: '{tool_name}' is allowlisted but its adapter "
                    "is not merged yet"
                ),
                spec=spec,
            )
        else:
            argument_errors = _schema_errors(
                _build_validator(spec.args_schema), arguments
            )
            if argument_errors:
                result = self._error_result(
                    tool_call_id,
                    tool_name,
                    error=f"invalid_arguments: {'; '.join(argument_errors)}",
                    spec=spec,
                )
            else:
                result = self._run_with_timeout(spec, tool_call_id, arguments)

        result = self._contract_checked(result, tool_call_id, tool_name, spec)
        self.audit_log.append(request, result)
        return result

    def build_request(
        self,
        agent_id: str,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Convenience builder for a contract-valid ToolRequest envelope."""
        request: Dict[str, Any] = {
            "tool_call_id": f"call-{uuid.uuid4().hex[:12]}",
            "agent_id": agent_id,
            "tool_name": tool_name,
            "arguments": arguments if arguments is not None else {},
            "requested_at": _utcnow_iso(),
        }
        if reason is not None:
            request["reason"] = reason
        return request

    # -- internals ----------------------------------------------------------

    def _run_with_timeout(
        self, spec: ToolSpec, tool_call_id: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        # Single-purpose worker; shutdown(wait=False) so a hung tool never
        # blocks the orchestrator past its declared timeout.
        pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"tool-{spec.name}")
        try:
            future = pool.submit(spec.handler, **arguments)
            try:
                raw = future.result(timeout=spec.timeout_s)
            except FuturesTimeoutError:
                future.cancel()
                return self._timeout_fallback(spec, tool_call_id, arguments)
            except Exception as exc:  # noqa: BLE001 — adapter failure, structured error
                return self._error_result(
                    tool_call_id,
                    spec.name,
                    error=f"tool_execution_failed: {type(exc).__name__}: {exc}",
                    spec=spec,
                )
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        return self._normalize_result(raw, tool_call_id, spec)

    def _timeout_fallback(
        self, spec: ToolSpec, tool_call_id: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        timeout_note = f"timeout after {spec.timeout_s}s"
        if spec.supports_cached_mode:
            cached_args = {**arguments, "mode": "cached"}
            try:
                raw = spec.handler(**cached_args)
            except Exception as exc:  # noqa: BLE001
                return {
                    **self._error_result(tool_call_id, spec.name, error="", spec=spec),
                    "status": "timeout",
                    "error": f"{timeout_note}; cache fallback failed: {exc}",
                }
            result = self._normalize_result(raw, tool_call_id, spec)
            result["status"] = "fallback"
            result["is_cached"] = True
            result["error"] = f"{timeout_note}; served from local cache"
            return result
        return {
            **self._error_result(tool_call_id, spec.name, error="", spec=spec),
            "status": "timeout",
            "error": f"{timeout_note}; tool has no cached fallback",
        }

    def _normalize_result(
        self, raw: Any, tool_call_id: str, spec: ToolSpec
    ) -> Dict[str, Any]:
        """Re-key an adapter return value as the ToolResult for this call.

        Provenance (source_type/source_name/retrieved_at/is_cached/
        staleness_seconds) comes from the tool itself when it returns a
        ToolResult-shaped dict; raw payloads are wrapped with the registry's
        provenance defaults.
        """
        if isinstance(raw, dict) and _TOOL_RESULT_MARKER_KEYS <= set(raw):
            result = copy.deepcopy(raw)
            result["tool_call_id"] = tool_call_id
            result["tool_name"] = spec.name
            return result
        return {
            "tool_call_id": tool_call_id,
            "tool_name": spec.name,
            "status": "success",
            "data": raw if isinstance(raw, (dict, list)) else {"value": raw},
            "source_type": spec.source_type,
            "source_name": spec.source_name,
            "retrieved_at": _utcnow_iso(),
            "data_timestamp": None,
            "is_cached": False,
            "staleness_seconds": None,
            "error": None,
        }

    def _error_result(
        self,
        tool_call_id: str,
        tool_name: str,
        error: str,
        spec: Optional[ToolSpec] = None,
    ) -> Dict[str, Any]:
        # A rejection carries no external data: provenance falls back to the
        # tool's declared source when known, else the executor itself.
        return {
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "status": "error",
            "data": None,
            "source_type": spec.source_type if spec else "model_inference",
            "source_name": spec.source_name if spec else "blaze-tool-executor",
            "retrieved_at": _utcnow_iso(),
            "data_timestamp": None,
            "is_cached": False,
            "staleness_seconds": None,
            "error": error,
        }

    def _contract_checked(
        self,
        result: Dict[str, Any],
        tool_call_id: str,
        tool_name: str,
        spec: Optional[ToolSpec],
    ) -> Dict[str, Any]:
        """Guarantee the outgoing ToolResult is contract-valid."""
        errors = _schema_errors(self._result_validator, result)
        if not errors:
            return result
        return self._error_result(
            tool_call_id,
            tool_name,
            error=f"tool_result_contract_violation: {'; '.join(errors)}",
            spec=spec,
        )
