"""Tests for the shared Gemma inference client.

The vLLM server is MOCKED with respx (OpenAI-compatible /v1/chat/completions).
No GPU and no network access are needed; the client is ready to point at the
real local vLLM later by just setting VLLM_BASE_URL.
"""

from __future__ import annotations

import asyncio
import json
import logging

import httpx
import pytest
import respx

from agents.common.inference_client import (
    CallLog,
    GemmaClient,
    InferenceRequestError,
    InferenceTimeoutError,
    RemoteInferenceBlockedError,
    StructuredOutputError,
)

BASE_URL = "http://localhost:8000"
CHAT_URL = f"{BASE_URL}/v1/chat/completions"
MODEL_ID = "google/gemma-4-E4B-it"

USAGE = {"prompt_tokens": 42, "completion_tokens": 17, "total_tokens": 59}


def completion_body(
    content: str | None = "ok",
    tool_calls: list[dict] | None = None,
    usage: dict | None = None,
) -> dict:
    message: dict = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": MODEL_ID,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if tool_calls else "stop",
            }
        ],
        "usage": usage if usage is not None else dict(USAGE),
    }


def make_client(**kwargs) -> GemmaClient:
    kwargs.setdefault("base_url", BASE_URL)
    kwargs.setdefault("model", MODEL_ID)
    kwargs.setdefault("retry_backoff_s", 0.0)  # no sleeping in tests
    return GemmaClient(**kwargs)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("BLAZE_ALLOW_REMOTE_INFERENCE", raising=False)
    monkeypatch.delenv("VLLM_BASE_URL", raising=False)
    monkeypatch.delenv("VLLM_API_KEY", raising=False)
    monkeypatch.delenv("GEMMA_MODEL_ID", raising=False)


# ---------------------------------------------------------------------------
# Simple chat + accounting
# ---------------------------------------------------------------------------


@respx.mock
async def test_simple_chat_logs_latency_and_tokens():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=completion_body("Bonjour Alpha")))

    async with make_client(agent="radio_intelligence") as client:
        result = await client.chat([{"role": "user", "content": "Salut"}])

    assert result.content == "Bonjour Alpha"
    assert result.finish_reason == "stop"
    assert result.usage.prompt_tokens == 42
    assert result.usage.completion_tokens == 17

    log = client.call_log
    assert log.total_calls == 1
    assert log.successes == 1
    assert log.failures == 0
    assert log.cloud_calls == 0  # demo guard: zero non-local calls
    record = log.records()[0]
    assert record.agent == "radio_intelligence"
    assert record.latency_s > 0
    assert record.prompt_tokens == 42
    assert record.completion_tokens == 17
    assert record.total_tokens == 59
    assert record.remote is False

    snap = log.snapshot()
    assert snap.total_calls == 1
    assert snap.total_tokens == 59
    assert snap.avg_latency_s > 0


@respx.mock
async def test_request_payload_uses_model_and_auth():
    route = respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=completion_body()))

    async with make_client(api_key="local-only-placeholder") as client:
        await client.chat([{"role": "user", "content": "ping"}], temperature=0.1, max_tokens=64)

    request = route.calls.last.request
    payload = json.loads(request.content)
    assert payload["model"] == MODEL_ID
    assert payload["temperature"] == 0.1
    assert payload["max_tokens"] == 64
    assert request.headers["Authorization"] == "Bearer local-only-placeholder"


# ---------------------------------------------------------------------------
# Tool calling
# ---------------------------------------------------------------------------


@respx.mock
async def test_tool_call_parsed():
    tool_calls = [
        {
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "get_weather",
                "arguments": json.dumps({"lat": 43.6, "lon": 3.9}),
            },
        }
    ]
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(200, json=completion_body(content=None, tool_calls=tool_calls))
    )

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Weather at a point",
                "parameters": {
                    "type": "object",
                    "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}},
                    "required": ["lat", "lon"],
                },
            },
        }
    ]

    async with make_client() as client:
        result = await client.chat(
            [{"role": "user", "content": "Meteo secteur nord"}],
            tools=tools,
            tool_choice="auto",
        )

    assert result.finish_reason == "tool_calls"
    assert len(result.tool_calls) == 1
    call = result.tool_calls[0]
    assert call.id == "call_1"
    assert call.name == "get_weather"
    assert call.arguments == {"lat": 43.6, "lon": 3.9}

    payload = json.loads(route.calls.last.request.content)
    assert payload["tools"] == tools
    assert payload["tool_choice"] == "auto"


# ---------------------------------------------------------------------------
# Structured output + repair loop
# ---------------------------------------------------------------------------

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "unit": {"type": "string"},
        "action": {"type": "string"},
    },
    "required": ["unit", "action"],
    "additionalProperties": False,
}


@respx.mock
async def test_structured_output_repaired_after_one_invalid_response():
    responses = [
        httpx.Response(200, json=completion_body("this is not json at all")),
        httpx.Response(200, json=completion_body(json.dumps({"unit": "Alpha", "action": "repli"}))),
    ]
    route = respx.post(CHAT_URL).mock(side_effect=responses)

    async with make_client() as client:
        result = await client.chat_structured(
            [{"role": "user", "content": "Plan pour Alpha"}],
            schema=PLAN_SCHEMA,
        )

    assert result.data == {"unit": "Alpha", "action": "repli"}
    assert result.attempts == 2
    assert route.call_count == 2

    # The repair re-prompt carries the validation error back to the model.
    repair_payload = json.loads(route.calls.last.request.content)
    roles = [m["role"] for m in repair_payload["messages"]]
    assert roles == ["user", "assistant", "user"]
    assert "Validation error" in repair_payload["messages"][-1]["content"]

    # Both model calls were accounted (usage aggregated across attempts).
    assert client.call_log.total_calls == 2
    assert result.usage.total_tokens == 2 * USAGE["total_tokens"]


@respx.mock
async def test_structured_output_schema_violation_then_typed_failure():
    # Valid JSON but missing required "action" — always invalid.
    bad = json.dumps({"unit": "Alpha"})
    route = respx.post(CHAT_URL).mock(return_value=httpx.Response(200, json=completion_body(bad)))

    async with make_client() as client:
        with pytest.raises(StructuredOutputError) as excinfo:
            await client.chat_structured(
                [{"role": "user", "content": "Plan pour Alpha"}],
                schema=PLAN_SCHEMA,
                repair_attempts=2,
            )

    err = excinfo.value
    assert err.attempts == 3  # initial + 2 repairs
    assert "action" in err.last_error
    assert err.last_output == bad
    assert route.call_count == 3


@respx.mock
async def test_structured_output_requests_json_schema_response_format():
    route = respx.post(CHAT_URL).mock(
        return_value=httpx.Response(200, json=completion_body(json.dumps({"unit": "B", "action": "a"})))
    )
    async with make_client() as client:
        await client.chat_structured(
            [{"role": "user", "content": "go"}], schema=PLAN_SCHEMA, schema_name="plan"
        )

    payload = json.loads(route.calls.last.request.content)
    assert payload["response_format"]["type"] == "json_schema"
    assert payload["response_format"]["json_schema"]["name"] == "plan"
    assert payload["response_format"]["json_schema"]["schema"] == PLAN_SCHEMA


# ---------------------------------------------------------------------------
# Timeouts and retries
# ---------------------------------------------------------------------------


@respx.mock
async def test_timeout_then_retry_succeeds():
    route = respx.post(CHAT_URL).mock(
        side_effect=[
            httpx.ConnectTimeout("simulated timeout"),
            httpx.Response(200, json=completion_body("recovered")),
        ]
    )

    async with make_client(max_retries=2) as client:
        result = await client.chat([{"role": "user", "content": "ping"}])

    assert result.content == "recovered"
    assert route.call_count == 2
    record = client.call_log.records()[0]
    assert record.success is True
    assert record.http_attempts == 2


@respx.mock
async def test_timeouts_exhausted_raise_typed_error_and_log_failure():
    route = respx.post(CHAT_URL).mock(side_effect=httpx.ReadTimeout("simulated timeout"))

    async with make_client(max_retries=2) as client:
        with pytest.raises(InferenceTimeoutError) as excinfo:
            await client.chat([{"role": "user", "content": "ping"}])

    assert excinfo.value.attempts == 3  # initial + 2 retries
    assert route.call_count == 3
    log = client.call_log
    assert log.failures == 1
    assert log.successes == 0
    record = log.records()[0]
    assert record.success is False
    assert "InferenceTimeoutError" in record.error


@respx.mock
async def test_server_error_retried_then_client_error_not_retried():
    route = respx.post(CHAT_URL).mock(
        side_effect=[
            httpx.Response(500, text="boom"),
            httpx.Response(200, json=completion_body("after 500")),
        ]
    )
    async with make_client() as client:
        result = await client.chat([{"role": "user", "content": "ping"}])
    assert result.content == "after 500"
    assert route.call_count == 2

    respx.reset()
    route = respx.post(CHAT_URL).mock(return_value=httpx.Response(400, text="bad request"))
    async with make_client() as client:
        with pytest.raises(InferenceRequestError) as excinfo:
            await client.chat([{"role": "user", "content": "ping"}])
    assert excinfo.value.status_code == 400
    assert route.call_count == 1  # 4xx is not retried


# ---------------------------------------------------------------------------
# Local-only guard (cloud_calls must stay 0)
# ---------------------------------------------------------------------------


def test_remote_base_url_refused_without_flag():
    with pytest.raises(RemoteInferenceBlockedError):
        GemmaClient(base_url="https://api.openai.com")


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "0.0.0.0"])
def test_local_base_urls_accepted(host):
    client = GemmaClient(base_url=f"http://{host}:8000")
    assert client.call_log.cloud_calls == 0


@respx.mock
async def test_remote_base_url_with_flag_warns_and_counts_cloud_calls(monkeypatch, caplog):
    monkeypatch.setenv("BLAZE_ALLOW_REMOTE_INFERENCE", "true")
    remote_url = "https://remote.example.com"
    respx.post(f"{remote_url}/v1/chat/completions").mock(
        return_value=httpx.Response(200, json=completion_body("remote"))
    )

    with caplog.at_level(logging.WARNING, logger="blaze.inference"):
        client = GemmaClient(base_url=remote_url, retry_backoff_s=0.0)
    assert any("REMOTE INFERENCE ENABLED" in message for message in caplog.messages)

    async with client:
        await client.chat([{"role": "user", "content": "ping"}])

    assert client.call_log.cloud_calls == 1
    assert client.call_log.records()[0].remote is True


# ---------------------------------------------------------------------------
# Concurrency accounting
# ---------------------------------------------------------------------------


@respx.mock
async def test_concurrent_calls_tracked():
    async def delayed_response(request):
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=completion_body("concurrent"))

    respx.post(CHAT_URL).mock(side_effect=delayed_response)

    shared_log = CallLog()
    async with make_client(call_log=shared_log) as client:
        results = await asyncio.gather(
            *(client.chat([{"role": "user", "content": f"call {i}"}]) for i in range(5))
        )

    assert len(results) == 5
    assert shared_log.total_calls == 5
    assert shared_log.successes == 5
    assert shared_log.max_concurrent >= 2  # 5 simultaneous asyncio calls observed
    assert shared_log.current_concurrent == 0
    assert shared_log.cloud_calls == 0
