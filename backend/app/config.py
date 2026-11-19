"""Server settings, all overridable with environment variables (see .env.example)."""
import logging
import os
import secrets
from typing import Dict

logger = logging.getLogger("smart_shopping_agent.config")


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


# Signs install tokens. Must be set (and kept secret) in production; a random one means tokens stop
# working whenever the server restarts.
APP_SECRET = os.getenv("APP_SECRET") or ""
if not APP_SECRET:
    APP_SECRET = secrets.token_hex(32)
    logger.warning("APP_SECRET not set: using a random one, so install tokens reset on every restart")

# Requests per install per Indian calendar day, by feature.
DAILY_LIMITS: Dict[str, int] = {
    "analyze": _int("LIMIT_ANALYZE_PER_DAY", 20),
    "chat": _int("LIMIT_CHAT_PER_DAY", 100),
    # Up to 2 match calls per product since v0.6.0 (a second search by model number).
    "match": _int("LIMIT_MATCH_PER_DAY", 150),
    "trust": _int("LIMIT_TRUST_PER_DAY", 60),
}
REGISTRATIONS_PER_IP_PER_DAY = _int("LIMIT_REGISTRATIONS_PER_IP_PER_DAY", 10)

# Hard stop for model spend in a calendar month (UTC). Also set a budget in the OpenAI dashboard as a backstop.
MONTHLY_BUDGET_USD = _float("MONTHLY_BUDGET_USD", 10.0)

# USD per 1M tokens for OPENAI_MODEL, used to turn reported token usage into cost.
PRICE_INPUT_PER_M = _float("PRICE_INPUT_PER_M", 0.10)
PRICE_CACHED_INPUT_PER_M = _float("PRICE_CACHED_INPUT_PER_M", 0.01)
PRICE_OUTPUT_PER_M = _float("PRICE_OUTPUT_PER_M", 0.50)

USAGE_DB_PATH = os.getenv("USAGE_DB_PATH", "data/usage.db")

# Protects GET /admin/usage. Unset = endpoint disabled.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

# Behind a proxy (Render), the client IP is in X-Forwarded-For. Only trust it when deployed behind one.
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"
