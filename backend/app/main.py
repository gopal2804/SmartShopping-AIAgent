import hmac
import logging
from typing import AsyncIterator, Callable

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402

from . import config, llm, usage  # noqa: E402
from .schemas import ChatRequest, MatchRequest, MatchVerdicts, Product, ProductAnalysis, TrustReport  # noqa: E402
from .security import issue_token, verify_token  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")
logger = logging.getLogger("smart_shopping_agent")

app = FastAPI(title="Smart Shopping Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

UPSTREAM_ERROR = "The AI service had a problem. Please try again in a moment."


def _error(status: int, code: str, message: str) -> HTTPException:
    # `code` lets the extension show the right message; internals never reach the client.
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _client_ip(request: Request) -> str:
    if config.TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def guarded(bucket: str) -> Callable:
    """Dependency for AI routes: valid install token, budget left, and within the install's daily limit."""

    def dependency(authorization: str = Header(default="")) -> str:
        install_id = verify_token(authorization[len("Bearer "):] if authorization.startswith("Bearer ") else "")
        if not install_id:
            raise _error(401, "auth", "This install isn't registered with the server. Reload the side panel.")
        store = usage.store()
        if not store.budget_left():
            raise _error(503, "budget", "The AI features are paused for the rest of the month (usage budget reached).")
        if store.take(f"install:{install_id}", bucket, config.DAILY_LIMITS[bucket]) is None:
            raise _error(
                429,
                "limit",
                f"You've reached today's limit of {config.DAILY_LIMITS[bucket]} for this feature. It resets at midnight IST.",
            )
        return install_id

    return dependency


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": llm.MODEL}


@app.post("/api/register")
async def register(request: Request) -> dict:
    """Issues an anonymous install token. Limited per IP so tokens can't be minted in bulk."""
    ip = _client_ip(request)
    if usage.store().take(f"ip:{ip}", "register", config.REGISTRATIONS_PER_IP_PER_DAY) is None:
        raise _error(429, "limit", "Too many new installs from this network today. Please try again tomorrow.")
    return {"token": issue_token()}


@app.post("/api/analyze", response_model=ProductAnalysis)
async def analyze(product: Product, _: str = Depends(guarded("analyze"))) -> ProductAnalysis:
    if not product.title and not product.page_text:
        raise _error(422, "no_data", "No product data was extracted from the page.")
    try:
        return await llm.analyze_product(product)
    except Exception as exc:
        logger.exception("Analysis failed")
        raise _error(502, "upstream", UPSTREAM_ERROR) from exc


@app.post("/api/match", response_model=MatchVerdicts)
async def match(req: MatchRequest, _: str = Depends(guarded("match"))) -> MatchVerdicts:
    try:
        return MatchVerdicts(verdicts=await llm.verify_matches(req))
    except Exception as exc:
        logger.exception("Match failed")
        raise _error(502, "upstream", UPSTREAM_ERROR) from exc


@app.post("/api/trust", response_model=TrustReport)
async def trust_check(product: Product, _: str = Depends(guarded("trust"))) -> TrustReport:
    # Signals are computed without the model; only the one-line summary uses it, with a template fallback.
    return await llm.assess_trust(product)


@app.post("/api/chat")
async def chat(req: ChatRequest, _: str = Depends(guarded("chat"))) -> StreamingResponse:
    async def body() -> AsyncIterator[str]:
        try:
            async for chunk in llm.stream_chat(req):
                yield chunk
        except Exception:
            logger.exception("Chat failed")
            yield f"\n\n[Error: {UPSTREAM_ERROR}]"

    return StreamingResponse(body(), media_type="text/plain; charset=utf-8")


@app.get("/admin/usage")
async def admin_usage(x_admin_token: str = Header(default="")) -> dict:
    """This month's model spend and today's request counts. Disabled unless ADMIN_TOKEN is set."""
    if not config.ADMIN_TOKEN:
        raise HTTPException(status_code=404, detail="Not Found")
    if not hmac.compare_digest(x_admin_token, config.ADMIN_TOKEN):
        raise HTTPException(status_code=403, detail="Forbidden")
    return usage.store().summary()
