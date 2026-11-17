from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class Review(BaseModel):
    id: Optional[str] = Field(None, max_length=64)
    title: str = Field("", max_length=300)
    body: str = Field("", max_length=3000)
    rating: Optional[float] = None
    date: str = Field("", max_length=100)
    verified: bool = False
    source: Optional[Literal["top", "critical", "recent"]] = None


class Product(BaseModel):
    site: Literal["amazon", "flipkart"]
    url: str = Field(max_length=2000)
    product_id: str = Field("", max_length=100)
    title: str = Field("", max_length=500)
    brand: str = Field("", max_length=100)
    price: str = Field("", max_length=50)
    rating: Optional[float] = None
    rating_count: str = Field("", max_length=100)
    rating_breakdown: str = Field("", max_length=200)
    features: List[str] = Field(default_factory=list, max_length=30)
    reviews: List[Review] = Field(default_factory=list, max_length=300)
    page_text: str = Field("", max_length=20000)


class Theme(BaseModel):
    point: str
    frequency: Literal["most", "many", "some", "few"]


class ProductAnalysis(BaseModel):
    verdict: Literal["recommended", "consider_alternatives", "avoid"]
    verdict_reason: str
    summary: str
    pros: List[Theme]
    cons: List[Theme]
    best_for: List[str]
    confidence: Literal["high", "medium", "low"]
    confidence_reason: str


class MatchItem(BaseModel):
    title: str = Field(max_length=500)
    variant: str = Field("", max_length=200)
    brand: str = Field("", max_length=100)


class MatchSource(MatchItem):
    site: Literal["amazon", "flipkart"]


class MatchRequest(BaseModel):
    source: MatchSource
    candidates: List[MatchItem] = Field(min_length=1, max_length=6)


class MatchVerdict(BaseModel):
    index: int
    verdict: Literal["same", "variant", "different"]
    differences: List[str]
    reason: str


class MatchVerdicts(BaseModel):
    verdicts: List[MatchVerdict]


class Comparison(BaseModel):
    """Other-site listing shown to the user; numbers are scraped, not model output."""

    site: Literal["amazon", "flipkart"]
    verdict: Literal["same", "variant"]
    title: str = Field(max_length=500)
    price: Optional[float] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    differences: List[str] = Field(default_factory=list, max_length=5)


SignalId = Literal["review_burst", "near_duplicates", "unverified_share", "incentive_mentions"]


class TrustSignal(BaseModel):
    id: SignalId
    severity: Literal["caution", "warning"]
    title: str
    detail: str
    examples: List[str] = Field(default_factory=list)


class TrustCheck(BaseModel):
    id: SignalId
    status: Literal["passed", "flagged", "skipped"]
    note: str


class TrustReport(BaseModel):
    """Computed by app/trust.py; only `summary` may come from the model, and it is validated."""

    level: Literal["insufficient", "no_concerns", "some_concerns", "notable_concerns"]
    reviews_checked: int
    signals: List[TrustSignal]
    checks: List[TrustCheck]
    summary: str = ""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    product: Product
    analysis: Optional[ProductAnalysis] = None
    comparison: Optional[Comparison] = None
    trust: Optional[TrustReport] = None
    messages: List[ChatMessage] = Field(min_length=1, max_length=40)
