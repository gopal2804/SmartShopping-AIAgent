"""API protection: install tokens, daily limits, registration limits, budget cap, safe errors.
No OpenAI calls: the model functions are replaced with fakes."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import config, llm, main, usage
from app.schemas import ProductAnalysis

PRODUCT = {"site": "amazon", "url": "https://www.amazon.in/dp/X", "title": "Test earbuds"}
ANALYSIS = ProductAnalysis(
    verdict="recommended", verdict_reason="r", summary="s", pros=[], cons=[], best_for=[],
    confidence="high", confidence_reason="c",
)


@pytest.fixture
def client(monkeypatch):
    usage.use_store(usage.UsageStore(":memory:"))
    monkeypatch.setitem(config.DAILY_LIMITS, "analyze", 3)
    monkeypatch.setattr(config, "REGISTRATIONS_PER_IP_PER_DAY", 2)
    monkeypatch.setattr(config, "MONTHLY_BUDGET_USD", 1.0)

    async def fake_analyze(product):
        # Pretend the model used 1M input + 1M output tokens.
        usage.store().record_spend(SimpleNamespace(input_tokens=1_000_000, output_tokens=1_000_000), "analysis")
        return ANALYSIS

    async def failing_match(req):
        raise RuntimeError("secret internal detail: sk-abc123")

    monkeypatch.setattr(llm, "analyze_product", fake_analyze)
    monkeypatch.setattr(llm, "verify_matches", failing_match)
    return TestClient(main.app)


def register(client) -> dict:
    res = client.post("/api/register")
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def test_health_and_root_are_public(client):
    assert client.get("/health").json()["status"] == "ok"
    root = client.get("/")
    assert root.status_code == 200 and root.json()["service"] == "Smart Shopping Agent API"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer nonsense"}, {"Authorization": "Bearer v1.abc.123.badsig"}])
def test_ai_routes_reject_missing_or_forged_tokens(client, headers):
    res = client.post("/api/analyze", json=PRODUCT, headers=headers)
    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "auth"


def test_daily_limit_per_install(client, monkeypatch):
    monkeypatch.setattr(config, "MONTHLY_BUDGET_USD", 1000.0)
    a, b = register(client), register(client)
    assert [client.post("/api/analyze", json=PRODUCT, headers=a).status_code for _ in range(4)] == [200, 200, 200, 429]
    assert client.post("/api/analyze", json=PRODUCT, headers=a).json()["detail"]["code"] == "limit"
    # Another install has its own allowance.
    assert client.post("/api/analyze", json=PRODUCT, headers=b).status_code == 200


def test_registration_is_limited_per_ip(client):
    register(client)
    register(client)
    res = client.post("/api/register")
    assert res.status_code == 429


def test_budget_cap_pauses_ai_features(client):
    headers = register(client)
    # One fake call costs 1M * 0.10 + 1M * 0.50 = $0.60; the cap is $1.00.
    assert client.post("/api/analyze", json=PRODUCT, headers=headers).status_code == 200
    assert client.post("/api/analyze", json=PRODUCT, headers=headers).status_code == 200  # $0.60 < $1.00, allowed
    res = client.post("/api/analyze", json=PRODUCT, headers=headers)  # $1.20 spent: paused
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "budget"
    assert usage.store().month_spend() == pytest.approx(1.2)


def test_upstream_errors_do_not_leak_internals(client):
    headers = register(client)
    body = {"source": {"site": "amazon", "title": "A"}, "candidates": [{"title": "B"}]}
    res = client.post("/api/match", json=body, headers=headers)
    assert res.status_code == 502
    assert "sk-abc123" not in res.text and "secret" not in res.text
    assert res.json()["detail"]["code"] == "upstream"


def test_admin_usage_requires_token(client, monkeypatch):
    assert client.get("/admin/usage").status_code == 404  # disabled without ADMIN_TOKEN
    monkeypatch.setattr(config, "ADMIN_TOKEN", "s3cret")
    assert client.get("/admin/usage", headers={"X-Admin-Token": "wrong"}).status_code == 403
    res = client.get("/admin/usage", headers={"X-Admin-Token": "s3cret"})
    assert res.status_code == 200 and "spend_usd" in res.json()


def test_cost_uses_cached_token_price():
    u = SimpleNamespace(input_tokens=1_000_000, output_tokens=0, input_tokens_details=SimpleNamespace(cached_tokens=1_000_000))
    assert usage.cost_usd(u) == pytest.approx(config.PRICE_CACHED_INPUT_PER_M)
