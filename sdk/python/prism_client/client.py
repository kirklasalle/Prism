"""PrismClient — stdlib-only HTTP wrapper over the PRISM dashboard API.

Design notes:
    * No external dependencies. Uses urllib so the SDK remains drop-in for
      restricted enterprise environments where ``pip install requests`` is
      gated.
    * Transport is injectable for tests via the ``transport`` constructor
      argument; the default is :func:`_urllib_transport`.
    * Methods map 1:1 to dashboard routes documented in
      ``src/core/operator/dashboard-service.ts`` and surfaced at
      ``/api/v1/openapi.json``.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, Iterator, Mapping, Optional, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlencode

from .errors import (
    PrismApiError,
    PrismAuthError,
    PrismConnectionError,
    PrismRateLimitError,
)

# (status, headers, raw_body_bytes)
TransportResponse = Tuple[int, Dict[str, str], bytes]
Transport = Callable[[str, str, Mapping[str, str], Optional[bytes], float], TransportResponse]

DEFAULT_BASE_URL = "http://localhost:7070"
DEFAULT_TIMEOUT_S = 30.0
DEFAULT_USER_AGENT = "prism-python-sdk/0.2.0"


def _urllib_transport(
    method: str,
    url: str,
    headers: Mapping[str, str],
    body: Optional[bytes],
    timeout: float,
) -> TransportResponse:
    req = urllib_request.Request(url=url, method=method, data=body, headers=dict(headers))
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — operator-supplied URL
            raw = resp.read()
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, raw
    except urllib_error.HTTPError as exc:
        raw = exc.read() if hasattr(exc, "read") else b""
        return exc.code, {k.lower(): v for k, v in (exc.headers or {}).items()}, raw
    except urllib_error.URLError as exc:
        raise PrismConnectionError(f"transport error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise PrismConnectionError(f"timeout after {timeout}s") from exc


class PrismClient:
    """Synchronous client over the PRISM dashboard API.

    Parameters
    ----------
    base_url:
        Dashboard base URL. Defaults to ``http://localhost:7070`` or the
        ``PRISM_BASE_URL`` environment variable.
    token:
        Bearer token for the dashboard auth gate. Defaults to the
        ``PRISM_TOKEN`` environment variable. Pass ``None`` and set
        ``PRISM_AUTH_DISABLED=true`` on the server for dev-mode local use.
    timeout:
        Per-request timeout in seconds.
    transport:
        Optional injection point for tests. Defaults to a urllib-backed
        implementation.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        *,
        timeout: float = DEFAULT_TIMEOUT_S,
        user_agent: str = DEFAULT_USER_AGENT,
        transport: Optional[Transport] = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("PRISM_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.token = token if token is not None else os.environ.get("PRISM_TOKEN")
        self.timeout = timeout
        self.user_agent = user_agent
        self._transport: Transport = transport or _urllib_transport

    # ------------------------------------------------------------------ core

    def _headers(self, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": self.user_agent,
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if extra:
            headers.update(extra)
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Optional[Any] = None,
        accept: str = "application/json",
    ) -> Any:
        url = self.base_url + path
        if params:
            cleaned = {k: v for k, v in params.items() if v is not None}
            if cleaned:
                url = f"{url}?{urlencode(cleaned, doseq=True)}"

        body_bytes: Optional[bytes] = None
        headers = self._headers({"Accept": accept})
        if json_body is not None:
            body_bytes = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"

        status, resp_headers, raw = self._transport(method, url, headers, body_bytes, self.timeout)
        return self._handle_response(status, resp_headers, raw, url)

    def _handle_response(
        self,
        status: int,
        headers: Mapping[str, str],
        raw: bytes,
        url: str,
    ) -> Any:
        content_type = headers.get("content-type", "")
        parsed: Any
        if "application/json" in content_type and raw:
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                parsed = raw.decode("utf-8", errors="replace")
        else:
            parsed = raw.decode("utf-8", errors="replace") if raw else None

        if 200 <= status < 300:
            return parsed

        message = self._extract_error_message(parsed)
        if status in (401, 403):
            raise PrismAuthError(status, message, url=url, body=parsed)
        if status == 429:
            raise PrismRateLimitError(status, message, url=url, body=parsed)
        raise PrismApiError(status, message, url=url, body=parsed)

    @staticmethod
    def _extract_error_message(parsed: Any) -> str:
        if isinstance(parsed, dict):
            for key in ("error", "message", "reason"):
                value = parsed.get(key)
                if isinstance(value, str) and value:
                    return value
        if isinstance(parsed, str) and parsed:
            return parsed[:500]
        return "request failed"

    # ----------------------------------------------------------------- chat

    def chat(
        self,
        prompt: str,
        *,
        session_id: Optional[str] = None,
        character_id: Optional[str] = None,
        extra: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Send a chat message via ``POST /api/chat``."""
        payload: Dict[str, Any] = {"message": prompt}
        if session_id is not None:
            payload["sessionId"] = session_id
        if character_id is not None:
            payload["characterId"] = character_id
        if extra:
            payload.update(extra)
        return self._request("POST", "/api/chat", json_body=payload)

    def chat_stream(
        self,
        prompt: str,
        *,
        session_id: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Stream a chat reply via SSE (``GET /api/chat/stream``).

        Yields parsed JSON envelopes for each ``data:`` event. Non-JSON event
        payloads are skipped.
        """
        url = self.base_url + "/api/chat/stream?" + urlencode(
            {k: v for k, v in {"message": prompt, "sessionId": session_id}.items() if v is not None}
        )
        headers = self._headers({"Accept": "text/event-stream"})
        req = urllib_request.Request(url=url, method="GET", headers=headers)
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310
                if resp.status >= 300:
                    raw = resp.read()
                    raise PrismApiError(resp.status, "stream rejected", url=url, body=raw)
                buffer: list[str] = []
                for raw_line in resp:
                    line = raw_line.decode("utf-8", errors="replace").rstrip("\n").rstrip("\r")
                    if line == "":
                        if buffer:
                            event = "\n".join(buffer)
                            buffer.clear()
                            payload = self._parse_sse_event(event)
                            if payload is not None:
                                yield payload
                        continue
                    buffer.append(line)
        except urllib_error.URLError as exc:
            raise PrismConnectionError(f"stream transport error: {exc.reason}") from exc

    @staticmethod
    def _parse_sse_event(event: str) -> Optional[Dict[str, Any]]:
        data_lines: list[str] = []
        for line in event.split("\n"):
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            return None
        joined = "\n".join(data_lines)
        try:
            decoded = json.loads(joined)
        except ValueError:
            return {"raw": joined}
        if isinstance(decoded, dict):
            return decoded
        return {"value": decoded}

    # ---------------------------------------------------------------- providers

    def list_providers(self) -> Any:
        return self._request("GET", "/api/llm/providers")

    def provider_health(self) -> Any:
        return self._request("GET", "/api/llm/provider-health")

    def select_provider(self, provider_id: str, model: Optional[str] = None) -> Any:
        body: Dict[str, Any] = {"providerId": provider_id}
        if model is not None:
            body["model"] = model
        return self._request("POST", "/api/llm/select", json_body=body)

    # --------------------------------------------------------- spectrum refraction

    def sr_status(self) -> Any:
        return self._request("GET", "/api/sr/status")

    def sr_configure(self, config: Mapping[str, Any]) -> Any:
        return self._request("POST", "/api/sr/configure", json_body=dict(config))

    def sr_activate(self) -> Any:
        return self._request("POST", "/api/sr/activate", json_body={})

    def sr_deactivate(self) -> Any:
        return self._request("POST", "/api/sr/deactivate", json_body={})

    # --------------------------------------------------------- approvals & events

    def pending_approvals(self) -> Any:
        return self._request("GET", "/api/pending")

    def events(self, *, since: Optional[str] = None, limit: Optional[int] = None) -> Any:
        return self._request("GET", "/api/events", params={"since": since, "limit": limit})

    def traces(self, *, limit: Optional[int] = None) -> Any:
        return self._request("GET", "/api/traces", params={"limit": limit})

    # --------------------------------------------------------------- readiness

    def readiness(self) -> Any:
        return self._request("GET", "/api/readiness")

    def setup_status(self) -> Any:
        return self._request("GET", "/api/setup/status")

    def status(self) -> Any:
        """Consolidated status snapshot — runtime, version, gates, advisories.

        Mirrors what ``prism doctor`` reports in JSON mode against a live
        server.
        """
        return self._request("GET", "/api/status")

    # --------------------------------------------------------- autonomous loop (v0.21)

    def chat_autonomous(
        self,
        prompt: str,
        *,
        session_id: str,
        character_id: Optional[str] = None,
        extra: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Drive the autonomous AgenticChatExecutor loop via ``POST /api/chat``.

        v0.21 headline. The server-side executor handles tool dispatch,
        budget enforcement, workspace-sandbox containment, and Tier-3
        routing to the Approval Queue. The terminal answer is returned
        synchronously; intermediate ``agentic_event`` envelopes stream
        over the dashboard WebSocket — subscribe via :meth:`watch_events`
        for the live timeline.
        """
        payload: Dict[str, Any] = {"message": prompt, "sessionId": session_id}
        if character_id is not None:
            payload["characterId"] = character_id
        if extra:
            payload.update(extra)
        return self._request("POST", "/api/chat", json_body=payload)

    def watch_events(
        self,
        *,
        session_id: Optional[str] = None,
        limit: int = 100,
    ) -> Iterator[Dict[str, Any]]:
        """Yield recent ``agentic_event`` envelopes from the activity bus.

        Polling shim over ``GET /api/events`` for stdlib-only callers that
        cannot easily open a WebSocket. For real-time streaming, attach to
        the dashboard ``/ws`` endpoint directly.
        """
        events = self.events(limit=limit)
        if not isinstance(events, list):
            events = events.get("events", []) if isinstance(events, dict) else []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            if ev.get("type") != "agentic_event":
                continue
            if session_id and ev.get("sessionId") != session_id:
                continue
            yield ev
