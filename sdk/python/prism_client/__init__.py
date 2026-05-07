"""PRISM Python SDK.

Thin, stdlib-only client over the PRISM dashboard HTTP/SSE surface. No
external dependencies; targets PRISM v0.5.0+.

Quick start::

    from prism_client import PrismClient

    prism = PrismClient(base_url="http://localhost:7070", token="...")
    reply = prism.chat("Summarize today's incidents")
    print(reply["response"])
"""

from .client import PrismClient
from .errors import (
    PrismApiError,
    PrismAuthError,
    PrismConnectionError,
    PrismError,
    PrismRateLimitError,
)

__all__ = [
    "PrismClient",
    "PrismError",
    "PrismApiError",
    "PrismAuthError",
    "PrismConnectionError",
    "PrismRateLimitError",
]

__version__ = "0.1.0"
