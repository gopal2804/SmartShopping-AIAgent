import logging
from typing import AsyncIterator

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402

from . import llm  # noqa: E402
from .schemas import ChatRequest, MatchRequest, MatchVerdicts, Product, ProductAnalysis  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")
logger = logging.getLogger("smart_shopping_agent")

app = FastAPI(title="Smart Shopping Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model": llm.MODEL}


@app.post("/api/analyze", response_model=ProductAnalysis)
async def analyze(product: Product) -> ProductAnalysis:
    if not product.title and not product.page_text:
        raise HTTPException(status_code=422, detail="No product data was extracted from the page.")
    try:
        return await llm.analyze_product(product)
    except Exception as exc:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {exc}") from exc


@app.post("/api/match", response_model=MatchVerdicts)
async def match(req: MatchRequest) -> MatchVerdicts:
    try:
        return MatchVerdicts(verdicts=await llm.verify_matches(req))
    except Exception as exc:
        logger.exception("Match failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {exc}") from exc


@app.post("/api/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    async def body() -> AsyncIterator[str]:
        try:
            async for chunk in llm.stream_chat(req):
                yield chunk
        except Exception as exc:
            logger.exception("Chat failed")
            yield f"\n\n[Error: {exc}]"

    return StreamingResponse(body(), media_type="text/plain; charset=utf-8")
