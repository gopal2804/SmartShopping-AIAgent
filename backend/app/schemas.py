from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class Review(BaseModel):
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


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    product: Product
    analysis: Optional[ProductAnalysis] = None
    messages: List[ChatMessage] = Field(min_length=1, max_length=40)
