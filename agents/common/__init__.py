"""BLAZE shared agent utilities — Gemma inference client used by all 5 agents."""

from agents.common.inference_client import (
    CallLog,
    CallRecord,
    ChatResult,
    GemmaClient,
    GemmaClientError,
    InferenceRequestError,
    InferenceTimeoutError,
    RemoteInferenceBlockedError,
    StructuredOutputError,
    StructuredResult,
    ToolCall,
    Usage,
)

__all__ = [
    "CallLog",
    "CallRecord",
    "ChatResult",
    "GemmaClient",
    "GemmaClientError",
    "InferenceRequestError",
    "InferenceTimeoutError",
    "RemoteInferenceBlockedError",
    "StructuredOutputError",
    "StructuredResult",
    "ToolCall",
    "Usage",
]
