"""Exception hierarchy for the PRISM Python SDK."""

from __future__ import annotations

from typing import Any, Optional


class PrismError(Exception):
    """Base class for all SDK-raised errors."""


class PrismConnectionError(PrismError):
    """Raised when the HTTP transport itself fails (DNS, TCP, TLS, timeout)."""


class PrismApiError(PrismError):
    """Raised when PRISM returns a non-2xx response."""

    def __init__(
        self,
        status: int,
        message: str,
        *,
        url: str = "",
        body: Optional[Any] = None,
    ) -> None:
        super().__init__(f"[{status}] {message} ({url})" if url else f"[{status}] {message}")
        self.status = status
        self.url = url
        self.body = body


class PrismAuthError(PrismApiError):
    """401/403 from the dashboard. Token missing, invalid, or insufficient."""


class PrismRateLimitError(PrismApiError):
    """429 from the per-IP rate limiter."""
