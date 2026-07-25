"""BLAZE orchestrator — deterministic tool execution layer (issue #26).

The registry (`tool_registry`) is the ONLY path from a Gemma function call to
executable code, and the executor (`tool_executor`) is the ONLY component that
invokes registered callables: allowlist, argument validation, timeouts, cache
fallback, provenance, append-only audit trail.
"""
