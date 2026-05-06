"""Tests for prism_client.PrismClient using an injected fake transport."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Mapping, Optional, Tuple

import pytest

from prism_client import (
    PrismApiError,
    PrismAuthError,
    PrismClient,
    PrismRateLimitError,
)


class FakeTransport:
    """Records calls and replays canned responses. Single-use per call queue."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []
        self._queue: List[Tuple[int, Dict[str, str], bytes]] = []

    def enqueue(self, status: int, body: Any, *, headers: Optional[Mapping[str, str]] = None) -> None:
        if isinstance(body, (dict, list)):
            payload = json.dumps(body).encode("utf-8")
            base_headers = {"content-type": "application/json"}
        elif isinstance(body, bytes):
            payload = body
            base_headers = {}
        else:
            payload = str(body).encode("utf-8")
            base_headers = {"content-type": "text/plain"}
        if headers:
            base_headers.update({k.lower(): v for k, v in headers.items()})
        self._queue.append((status, base_headers, payload))

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "body": body,
                "timeout": timeout,
            }
        )
        if not self._queue:
            raise AssertionError(f"no canned response for {method} {url}")
        return self._queue.pop(0)


@pytest.fixture
def transport() -> FakeTransport:
    return FakeTransport()


@pytest.fixture
def client(transport: FakeTransport) -> PrismClient:
    return PrismClient(base_url="http://prism.test", token="t-abc", transport=transport)


def test_chat_posts_json_with_bearer(client: PrismClient, transport: FakeTransport) -> None:
    transport.enqueue(200, {"response": "hello", "sessionId": "s1"})

    out = client.chat("hi", session_id="s1", character_id="aria-individual")

    assert out == {"response": "hello", "sessionId": "s1"}
    call = transport.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "http://prism.test/api/chat"
    assert call["headers"]["Authorization"] == "Bearer t-abc"
    assert call["headers"]["Content-Type"] == "application/json"
    assert json.loads(call["body"]) == {
        "message": "hi",
        "sessionId": "s1",
        "characterId": "aria-individual",
    }


def test_query_params_drop_none(client: PrismClient, transport: FakeTransport) -> None:
    transport.enqueue(200, {"events": []})
    client.events(since=None, limit=50)
    assert transport.calls[0]["url"] == "http://prism.test/api/events?limit=50"


def test_auth_error_maps_to_typed_exception(client: PrismClient, transport: FakeTransport) -> None:
    transport.enqueue(401, {"error": "missing token"})
    with pytest.raises(PrismAuthError) as exc_info:
        client.list_providers()
    assert exc_info.value.status == 401
    assert "missing token" in str(exc_info.value)


def test_rate_limit_error_maps_to_typed_exception(client: PrismClient, transport: FakeTransport) -> None:
    transport.enqueue(429, {"error": "slow down"})
    with pytest.raises(PrismRateLimitError):
        client.list_providers()


def test_generic_api_error_for_other_codes(client: PrismClient, transport: FakeTransport) -> None:
    transport.enqueue(500, {"error": "boom"})
    with pytest.raises(PrismApiError) as exc_info:
        client.sr_status()
    assert exc_info.value.status == 500
    assert not isinstance(exc_info.value, (PrismAuthError, PrismRateLimitError))


def test_token_omitted_when_none() -> None:
    transport = FakeTransport()
    transport.enqueue(200, {"ok": True})
    c = PrismClient(base_url="http://prism.test", token=None, transport=transport)
    c.readiness()
    assert "Authorization" not in transport.calls[0]["headers"]


def test_sr_configure_round_trip(client: PrismClient, transport: FakeTransport) -> None:
    transport.enqueue(200, {"isolation": "full"})
    cfg = {"hemispheres": [{"role": "logic", "providerId": "a"}, {"role": "creative", "providerId": "b"}]}
    out = client.sr_configure(cfg)
    assert out == {"isolation": "full"}
    assert json.loads(transport.calls[0]["body"]) == cfg


def test_sse_event_parser_splits_multiline_data() -> None:
    event = "event: chunk\ndata: {\"delta\":\"he\"}\ndata: {\"delta\":\"llo\"}"
    # Two data lines join with newline; not valid JSON together, returns raw fallback.
    parsed = PrismClient._parse_sse_event(event)
    assert parsed == {"raw": "{\"delta\":\"he\"}\n{\"delta\":\"llo\"}"}


def test_sse_event_parser_returns_dict_for_single_data() -> None:
    event = "data: {\"role\":\"assistant\",\"content\":\"hi\"}"
    parsed = PrismClient._parse_sse_event(event)
    assert parsed == {"role": "assistant", "content": "hi"}


def test_sse_event_parser_returns_none_for_no_data_lines() -> None:
    assert PrismClient._parse_sse_event("event: ping\nid: 1") is None


def test_base_url_strip_trailing_slash() -> None:
    transport = FakeTransport()
    transport.enqueue(200, {"ok": True})
    c = PrismClient(base_url="http://prism.test/", token="x", transport=transport)
    c.readiness()
    assert transport.calls[0]["url"] == "http://prism.test/api/readiness"
