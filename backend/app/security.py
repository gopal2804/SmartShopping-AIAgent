"""Anonymous install tokens: "v1.<install_id>.<issued_unix>.<hmac>", signed with APP_SECRET.

They identify an install for rate limiting without any personal data. Anyone can register, so tokens are
a speed bump, not real authentication; per-IP registration limits and the monthly budget cap do the rest.
"""
import hashlib
import hmac
import secrets
import time
from typing import Optional

from . import config

_VERSION = "v1"


def _sign(payload: str) -> str:
    return hmac.new(config.APP_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]


def issue_token() -> str:
    install_id = secrets.token_urlsafe(12)
    payload = f"{_VERSION}.{install_id}.{int(time.time())}"
    return f"{payload}.{_sign(payload)}"


def verify_token(token: str) -> Optional[str]:
    """Returns the install id for a valid token, else None."""
    parts = (token or "").split(".")
    if len(parts) != 4 or parts[0] != _VERSION:
        return None
    payload, signature = ".".join(parts[:3]), parts[3]
    if not hmac.compare_digest(_sign(payload), signature):
        return None
    return parts[1]
