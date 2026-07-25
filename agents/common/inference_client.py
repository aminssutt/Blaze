"""Shared Gemma inference client for all 5 BLAZE agents.

OpenAI-compatible calls to the local vLLM server (POST {VLLM_BASE_URL}/v1/chat/completions)
with:

- per-call timeout (default 60 s) and bounded retry with exponential backoff,
- tool / function calling (``tools`` + ``tool_choice``),
- structured output via ``response_format: json_schema`` + a bounded JSON repair loop
  (re-prompt with the jsonschema validation error, then typed ``StructuredOutputError``),
- call accounting in a queryable :class:`CallLog` (latency, token usage, success/failure,
  max observed concurrency, ``cloud_calls`` guard counter) for the metrics panel,
- a hard local-only guard: any non-local ``base_url`` raises
  :class:`RemoteInferenceBlockedError` unless ``BLAZE_ALLOW_REMOTE_INFERENCE=true``
  (dev only — logged as a warning, remote calls counted in ``cloud_calls``).

Configuration comes from the environment (constructor arguments override):

- ``VLLM_BASE_URL``   (default ``http://localhost:8000``)
- ``VLLM_API_KEY``    (default ``local-only-placeholder`` — vLLM ignores it locally)
- ``GEMMA_MODEL_ID``  (default ``google/gemma-4-E4B-it``)
- ``BLAZE_ALLOW_REMOTE_INFERENCE`` (``true`` to allow non-local base URLs, dev only)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Sequence
from urllib.parse import urlparse

import httpx
import jsonschema
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("blaze.inference")

DEFAULT_BASE_URL = "http://localhost:8000"
DEFAULT_API_KEY = "local-only-placeholder"
DEFAULT_MODEL_ID = "google/gemma-4-E4B-it"
DEFAULT_TIMEOUT_S = 60.0
DEFAULT_MAX_RETRIES = 2
DEFAULT_REPAIR_ATTEMPTS = 2
DEFAULT_RETRY_BACKOFF_S = 0.5

CHAT_COMPLETIONS_PATH = "/v1/chat/completions"

#: Hostnames considered local — anything else is a cloud call and is refused by default.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1"})

ALLOW_REMOTE_ENV = "BLAZE_ALLOW_REMOTE_INFERENCE"


# ---------------------------------------------------------------------------
# Typed errors
# ---------------------------------------------------------------------------


class GemmaClientError(Exception):
    """Base class for all GemmaClient failures."""


class RemoteInferenceBlockedError(GemmaClientError):
    """Raised when the base_url is not local and BLAZE_ALLOW_REMOTE_INFERENCE is not set."""


class InferenceTimeoutError(GemmaClientError):
    """Raised when a call still times out after all retries are exhausted."""

    def __init__(self, message: str, attempts: int) -> None:
        super().__init__(message)
        self.attempts = attempts


class InferenceRequestError(GemmaClientError):
    """Raised for HTTP/transport failures (4xx immediately, 5xx after retries)."""

    def __init__(self, message: str, status_code: int | None = None, body: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class StructuredOutputError(GemmaClientError):
    """Raised when the model output never validates against the schema after repair attempts."""

    def __init__(self, message: str, attempts: int, last_error: str, last_output: str | None) -> None:
        super().__init__(message)
        self.attempts = attempts
        self.last_error = last_error
        self.last_output = last_output


# ---------------------------------------------------------------------------
# Result models
# ---------------------------------------------------------------------------


class Usage(BaseModel):
    """Token usage reported by the server for one call."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ToolCall(BaseModel):
    """A parsed function/tool call proposed by the model."""

    id: str = ""
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ChatResult(BaseModel):
    """Result of one chat completion call."""

    model_config = ConfigDict(frozen=True)

    content: str | None = None
    tool_calls: tuple[ToolCall, ...] = ()
    finish_reason: str | None = None
    usage: Usage = Field(default_factory=Usage)
    raw: dict[str, Any] = Field(default_factory=dict)


class StructuredResult(BaseModel):
    """Result of a schema-constrained call: validated data + how many attempts it took."""

    model_config = ConfigDict(frozen=True)

    data: Any
    attempts: int
    usage: Usage = Field(default_factory=Usage)


# ---------------------------------------------------------------------------
# Call accounting (consumed by inference/metrics)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CallRecord:
    """One completed (or failed) logical call to the model."""

    agent: str | None
    kind: str  # "chat" | "structured"
    model: str
    started_at: float  # unix timestamp
    latency_s: float
    success: bool
    error: str | None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    remote: bool
    http_attempts: int


@dataclass
class CallLogSnapshot:
    """Aggregated view of the call log for the metrics panel."""

    total_calls: int
    successes: int
    failures: int
    cloud_calls: int
    current_concurrent: int
    max_concurrent: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int
    avg_latency_s: float
    records: tuple[CallRecord, ...] = field(repr=False, default=())


class CallLog:
    """Thread-safe accounting of every model call.

    Queried by ``inference/metrics``: per-call records (latency, tokens, success),
    aggregate counters, the max number of simultaneous calls observed, and the
    ``cloud_calls`` counter which MUST stay 0 during the demo (100% local).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: list[CallRecord] = []
        self._cloud_calls = 0
        self._current_concurrent = 0
        self._max_concurrent = 0

    # -- lifecycle hooks used by GemmaClient ------------------------------

    def call_started(self, *, remote: bool) -> None:
        with self._lock:
            self._current_concurrent += 1
            self._max_concurrent = max(self._max_concurrent, self._current_concurrent)
            if remote:
                self._cloud_calls += 1

    def call_finished(self, record: CallRecord) -> None:
        with self._lock:
            self._current_concurrent -= 1
            self._records.append(record)

    # -- query interface ---------------------------------------------------

    @property
    def total_calls(self) -> int:
        with self._lock:
            return len(self._records)

    @property
    def successes(self) -> int:
        with self._lock:
            return sum(1 for r in self._records if r.success)

    @property
    def failures(self) -> int:
        with self._lock:
            return sum(1 for r in self._records if not r.success)

    @property
    def cloud_calls(self) -> int:
        with self._lock:
            return self._cloud_calls

    @property
    def current_concurrent(self) -> int:
        with self._lock:
            return self._current_concurrent

    @property
    def max_concurrent(self) -> int:
        with self._lock:
            return self._max_concurrent

    def records(self) -> tuple[CallRecord, ...]:
        with self._lock:
            return tuple(self._records)

    def snapshot(self) -> CallLogSnapshot:
        with self._lock:
            records = tuple(self._records)
        successes = sum(1 for r in records if r.success)
        latencies = [r.latency_s for r in records]
        return CallLogSnapshot(
            total_calls=len(records),
            successes=successes,
            failures=len(records) - successes,
            cloud_calls=self.cloud_calls,
            current_concurrent=self.current_concurrent,
            max_concurrent=self.max_concurrent,
            total_prompt_tokens=sum(r.prompt_tokens for r in records),
            total_completion_tokens=sum(r.completion_tokens for r in records),
            total_tokens=sum(r.total_tokens for r in records),
            avg_latency_s=(sum(latencies) / len(latencies)) if latencies else 0.0,
            records=records,
        )


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


def _is_local_base_url(base_url: str) -> bool:
    host = urlparse(base_url).hostname
    return host is not None and host.lower() in LOCAL_HOSTS


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


class GemmaClient:
    """OpenAI-compatible async client for the shared local Gemma deployment (vLLM).

    Usage::

        async with GemmaClient(agent="radio_intelligence") as client:
            result = await client.chat([{"role": "user", "content": "..."}])
            plan = await client.chat_structured(messages, schema=PLAN_SCHEMA)
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        *,
        agent: str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_backoff_s: float = DEFAULT_RETRY_BACKOFF_S,
        repair_attempts: int = DEFAULT_REPAIR_ATTEMPTS,
        call_log: CallLog | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("VLLM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.api_key = api_key or os.getenv("VLLM_API_KEY") or DEFAULT_API_KEY
        self.model = model or os.getenv("GEMMA_MODEL_ID") or DEFAULT_MODEL_ID
        self.agent = agent
        self.timeout_s = float(timeout_s)
        self.max_retries = int(max_retries)
        self.retry_backoff_s = float(retry_backoff_s)
        self.repair_attempts = int(repair_attempts)
        self.call_log = call_log if call_log is not None else CallLog()

        self._remote = not _is_local_base_url(self.base_url)
        if self._remote:
            if not _env_flag(ALLOW_REMOTE_ENV):
                raise RemoteInferenceBlockedError(
                    f"Refusing non-local inference base_url {self.base_url!r}: the BLAZE demo is "
                    f"100% local (cloud_calls must stay 0). Set {ALLOW_REMOTE_ENV}=true only for dev."
                )
            logger.warning(
                "REMOTE INFERENCE ENABLED (dev only): base_url=%s is not local; "
                "these calls are counted in cloud_calls and must NOT happen during the demo.",
                self.base_url,
            )

        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(self.timeout_s),
            headers={"Authorization": f"Bearer {self.api_key}"},
            transport=transport,
        )

    # -- lifecycle ---------------------------------------------------------

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "GemmaClient":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

    # -- public API --------------------------------------------------------

    async def chat(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        tools: Sequence[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
        timeout_s: float | None = None,
        agent: str | None = None,
        extra_body: dict[str, Any] | None = None,
        _kind: str = "chat",
    ) -> ChatResult:
        """One chat completion call, with timeout + bounded retry and call accounting.

        ``tools``/``tool_choice`` follow the OpenAI function-calling format; parsed
        tool calls are returned in :attr:`ChatResult.tool_calls` with their JSON
        arguments already decoded.
        """
        payload: dict[str, Any] = {"model": self.model, "messages": list(messages)}
        if tools is not None:
            payload["tools"] = list(tools)
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if response_format is not None:
            payload["response_format"] = response_format
        if extra_body:
            payload.update(extra_body)

        agent_name = agent or self.agent
        started_at = time.time()
        start = time.perf_counter()
        http_attempts = 0
        error: str | None = None
        result: ChatResult | None = None

        self.call_log.call_started(remote=self._remote)
        try:
            body, http_attempts = await self._post_with_retries(payload, timeout_s=timeout_s)
            result = self._parse_response(body)
            return result
        except GemmaClientError as exc:
            error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            latency_s = time.perf_counter() - start
            usage = result.usage if result is not None else Usage()
            self.call_log.call_finished(
                CallRecord(
                    agent=agent_name,
                    kind=_kind,
                    model=self.model,
                    started_at=started_at,
                    latency_s=latency_s,
                    success=result is not None,
                    error=error,
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    total_tokens=usage.total_tokens,
                    remote=self._remote,
                    http_attempts=http_attempts,
                )
            )

    async def chat_structured(
        self,
        messages: Sequence[dict[str, Any]],
        *,
        schema: dict[str, Any],
        schema_name: str = "structured_response",
        repair_attempts: int | None = None,
        tools: Sequence[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout_s: float | None = None,
        agent: str | None = None,
    ) -> StructuredResult:
        """Schema-constrained call with a bounded JSON repair loop.

        The response is requested via ``response_format: json_schema`` and validated
        locally with ``jsonschema``. If the output is not valid JSON or does not match
        the schema, the model is re-prompted with the exact validation error, up to
        ``repair_attempts`` extra times (default 2). After that, a typed
        :class:`StructuredOutputError` is raised.
        """
        max_repairs = self.repair_attempts if repair_attempts is None else int(repair_attempts)
        response_format = {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema, "strict": True},
        }

        work_messages = list(messages)
        total_usage = Usage()
        last_error = ""
        last_output: str | None = None

        for attempt in range(1, max_repairs + 2):  # initial call + max_repairs repairs
            result = await self.chat(
                work_messages,
                tools=tools,
                tool_choice=tool_choice,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
                timeout_s=timeout_s,
                agent=agent,
                _kind="structured",
            )
            total_usage = Usage(
                prompt_tokens=total_usage.prompt_tokens + result.usage.prompt_tokens,
                completion_tokens=total_usage.completion_tokens + result.usage.completion_tokens,
                total_tokens=total_usage.total_tokens + result.usage.total_tokens,
            )
            last_output = result.content or ""
            try:
                data = json.loads(last_output)
            except json.JSONDecodeError as exc:
                last_error = f"Output is not valid JSON: {exc}"
            else:
                try:
                    jsonschema.validate(data, schema)
                except jsonschema.ValidationError as exc:
                    last_error = f"JSON does not match the required schema: {exc.message}"
                else:
                    return StructuredResult(data=data, attempts=attempt, usage=total_usage)

            logger.warning(
                "Structured output validation failed (attempt %d/%d): %s",
                attempt,
                max_repairs + 1,
                last_error,
            )
            # The rejected output is echoed back as CONTEXT only (validation
            # already ran on the full text), so it is clipped: a degenerate
            # generation (e.g. a whitespace loop up to max_tokens) would
            # otherwise push the repair prompt past the model window and turn
            # one bad output into an unrecoverable HTTP 400 (issue #53).
            echoed = last_output or ""
            if len(echoed) > 800:
                echoed = echoed[:800] + " …[output truncated for repair]"
            work_messages = work_messages + [
                {"role": "assistant", "content": echoed},
                {
                    "role": "user",
                    "content": (
                        "Your previous response was rejected by the JSON validator.\n"
                        f"Validation error: {last_error}\n"
                        "Respond again with ONLY a JSON object that strictly matches the "
                        f"required schema:\n{json.dumps(schema, ensure_ascii=False)}"
                    ),
                },
            ]

        raise StructuredOutputError(
            f"Model output failed schema validation after {max_repairs + 1} attempts: {last_error}",
            attempts=max_repairs + 1,
            last_error=last_error,
            last_output=last_output,
        )

    # -- internals ---------------------------------------------------------

    async def _post_with_retries(
        self, payload: dict[str, Any], *, timeout_s: float | None = None
    ) -> tuple[dict[str, Any], int]:
        """POST /v1/chat/completions with bounded retries on timeout / transport / 5xx."""
        attempts_allowed = self.max_retries + 1
        timeout = httpx.Timeout(timeout_s) if timeout_s is not None else None
        last_error: Exception | None = None

        for attempt in range(1, attempts_allowed + 1):
            try:
                kwargs: dict[str, Any] = {"json": payload}
                if timeout is not None:
                    kwargs["timeout"] = timeout
                response = await self._client.post(CHAT_COMPLETIONS_PATH, **kwargs)
            except httpx.TimeoutException as exc:
                last_error = exc
                if attempt < attempts_allowed:
                    await self._backoff(attempt)
                    continue
                raise InferenceTimeoutError(
                    f"Inference call timed out after {attempt} attempt(s): {exc}",
                    attempts=attempt,
                ) from exc
            except httpx.TransportError as exc:
                last_error = exc
                if attempt < attempts_allowed:
                    await self._backoff(attempt)
                    continue
                raise InferenceRequestError(
                    f"Transport error after {attempt} attempt(s): {exc}"
                ) from exc

            if response.status_code >= 500:
                last_error = InferenceRequestError(
                    f"Server error {response.status_code}",
                    status_code=response.status_code,
                    body=response.text,
                )
                if attempt < attempts_allowed:
                    await self._backoff(attempt)
                    continue
                raise InferenceRequestError(
                    f"Server error {response.status_code} after {attempt} attempt(s)",
                    status_code=response.status_code,
                    body=response.text,
                )
            if response.status_code >= 400:
                raise InferenceRequestError(
                    f"Request rejected with HTTP {response.status_code}",
                    status_code=response.status_code,
                    body=response.text,
                )
            return response.json(), attempt

        raise InferenceRequestError(f"Inference call failed: {last_error}")  # pragma: no cover

    async def _backoff(self, attempt: int) -> None:
        delay = self.retry_backoff_s * (2 ** (attempt - 1))
        if delay > 0:
            await asyncio.sleep(delay)

    @staticmethod
    def _parse_response(body: dict[str, Any]) -> ChatResult:
        choices = body.get("choices") or []
        if not choices:
            raise InferenceRequestError("Response body has no choices", body=json.dumps(body))
        choice = choices[0]
        message = choice.get("message") or {}

        tool_calls: list[ToolCall] = []
        for tc in message.get("tool_calls") or []:
            function = tc.get("function") or {}
            raw_args = function.get("arguments") or "{}"
            if isinstance(raw_args, dict):
                arguments = raw_args
            else:
                try:
                    arguments = json.loads(raw_args)
                except json.JSONDecodeError:
                    logger.warning("Tool call arguments are not valid JSON: %r", raw_args)
                    arguments = {"_raw": raw_args}
            tool_calls.append(
                ToolCall(id=tc.get("id") or "", name=function.get("name") or "", arguments=arguments)
            )

        usage_body = body.get("usage") or {}
        usage = Usage(
            prompt_tokens=usage_body.get("prompt_tokens") or 0,
            completion_tokens=usage_body.get("completion_tokens") or 0,
            total_tokens=usage_body.get("total_tokens") or 0,
        )
        return ChatResult(
            content=message.get("content"),
            tool_calls=tuple(tool_calls),
            finish_reason=choice.get("finish_reason"),
            usage=usage,
            raw=body,
        )
