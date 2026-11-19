import json

from app.llm import MAX_CONTEXT_CHARS, build_product_context
from app.schemas import Product, Review


def test_many_long_reviews_fit_without_breaking_the_json():
    reviews = [Review(title=f"r{i}", body="word " * 600, rating=4) for i in range(300)]
    product = Product(site="amazon", url="https://www.amazon.in/dp/B000000001", title="Test", reviews=reviews)
    ctx = build_product_context(product)
    inner = ctx.removeprefix("<product_data>\n").removesuffix("\n</product_data>")
    data = json.loads(inner)  # still valid JSON: bodies were shortened, not cut mid-structure
    assert len(inner) <= MAX_CONTEXT_CHARS
    assert len(data["reviews"]) == 300
