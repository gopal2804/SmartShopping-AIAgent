"""Usage counting and spend tracking in SQLite: daily per-install limits, per-IP registration limits,
and the monthly model-spend cap. Small and single-process by design (one Render instance)."""
import logging
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from . import config

logger = logging.getLogger("smart_shopping_agent.usage")

IST = timezone(timedelta(hours=5, minutes=30))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS counters (scope TEXT, day TEXT, bucket TEXT, count INTEGER, PRIMARY KEY (scope, day, bucket));
CREATE TABLE IF NOT EXISTS spend (month TEXT PRIMARY KEY, usd REAL, calls INTEGER, input_tokens INTEGER, output_tokens INTEGER);
"""


def today_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def this_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def cost_usd(usage: Any) -> float:
    """Cost of one OpenAI response from its reported token usage."""
    if usage is None:
        return 0.0
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cached = getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0) or 0
    return (
        (input_tokens - cached) * config.PRICE_INPUT_PER_M
        + cached * config.PRICE_CACHED_INPUT_PER_M
        + output_tokens * config.PRICE_OUTPUT_PER_M
    ) / 1_000_000


class UsageStore:
    def __init__(self, path: str):
        if path != ":memory:":
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.executescript(_SCHEMA)
        self._lock = threading.Lock()

    def take(self, scope: str, bucket: str, limit: int) -> Optional[int]:
        """Counts one use. Returns the remaining allowance, or None if the limit was already reached."""
        day = today_ist()
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT count FROM counters WHERE scope=? AND day=? AND bucket=?", (scope, day, bucket)
            ).fetchone()
            used = row[0] if row else 0
            if used >= limit:
                return None
            self._db.execute(
                "INSERT INTO counters VALUES (?,?,?,1) ON CONFLICT(scope,day,bucket) DO UPDATE SET count=count+1",
                (scope, day, bucket),
            )
            return limit - used - 1

    def record_spend(self, usage: Any, kind: str) -> float:
        usd = cost_usd(usage)
        month = this_month()
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO spend VALUES (?,?,1,?,?) ON CONFLICT(month) DO UPDATE SET usd=usd+excluded.usd, "
                "calls=calls+1, input_tokens=input_tokens+excluded.input_tokens, output_tokens=output_tokens+excluded.output_tokens",
                (month, usd, getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0),
            )
        logger.info("spend: %s $%.6f", kind, usd)
        return usd

    def month_spend(self) -> float:
        row = self._db.execute("SELECT usd FROM spend WHERE month=?", (this_month(),)).fetchone()
        return row[0] if row else 0.0

    def budget_left(self) -> bool:
        return self.month_spend() < config.MONTHLY_BUDGET_USD

    def summary(self) -> Dict[str, Any]:
        month = this_month()
        spend = self._db.execute("SELECT usd, calls, input_tokens, output_tokens FROM spend WHERE month=?", (month,)).fetchone()
        day = today_ist()
        buckets = self._db.execute(
            "SELECT bucket, SUM(count), COUNT(DISTINCT scope) FROM counters WHERE day=? GROUP BY bucket", (day,)
        ).fetchall()
        return {
            "month": month,
            "spend_usd": round(spend[0], 4) if spend else 0.0,
            "budget_usd": config.MONTHLY_BUDGET_USD,
            "model_calls": spend[1] if spend else 0,
            "input_tokens": spend[2] if spend else 0,
            "output_tokens": spend[3] if spend else 0,
            "today_ist": day,
            "today": {b: {"requests": n, "installs_or_ips": s} for b, n, s in buckets},
        }


_store: Optional[UsageStore] = None


def store() -> UsageStore:
    global _store
    if _store is None:
        _store = UsageStore(config.USAGE_DB_PATH)
    return _store


def use_store(s: UsageStore) -> None:
    """Swap the store (tests use an in-memory one)."""
    global _store
    _store = s
