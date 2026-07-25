"""BLAZE Agent 2 — Situation Context (tool selection + SituationSnapshot)."""

from agents.situation_context.agent import (
    AGENT_ID,
    DEFAULT_MAX_TOOL_CALLS,
    DEFAULT_TOOL_CATALOG,
    CatalogTool,
    RejectedToolCall,
    SituationContextAgent,
    SituationContextRun,
    SnapshotContractError,
    ToolSelection,
    catalog_from_registry,
    fields_for_tool,
)

__all__ = [
    "AGENT_ID",
    "DEFAULT_MAX_TOOL_CALLS",
    "DEFAULT_TOOL_CATALOG",
    "CatalogTool",
    "RejectedToolCall",
    "SituationContextAgent",
    "SituationContextRun",
    "SnapshotContractError",
    "ToolSelection",
    "catalog_from_registry",
    "fields_for_tool",
]
