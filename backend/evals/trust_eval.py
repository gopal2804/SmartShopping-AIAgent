"""Review-trust eval: planted patterns must be caught, genuine-looking review sets must not be flagged,
and model-written summaries must pass the validator (or fall back to the template).

Run from backend/:  .venv/bin/python -m evals.trust_eval [--genuine-seeds 20] [--no-llm]
"""
import argparse
import asyncio
import random
from datetime import date, timedelta
from typing import List

from dotenv import load_dotenv

load_dotenv(".env")

from app import llm, trust  # noqa: E402
from app.schemas import Review, TrustReport, TrustSignal  # noqa: E402

TODAY = date(2026, 11, 17)

OPENERS = ["Using it for", "Bought this", "Ordered after comparing options", "Have had it for", "Got it during a sale",
           "Replaced my old one with this", "Purchased for my parents", "Picked it up", "Tried this for"]
ASPECTS = ["battery", "build quality", "sound", "fit", "fabric", "packaging", "delivery", "comfort", "display",
           "charging speed", "noise level", "stitching", "size", "colour", "weight", "app support"]
VERDICTS_POS = ["is excellent", "is better than expected", "works well", "is decent for the price", "feels premium",
                "is solid", "has been reliable", "is impressive"]
VERDICTS_NEG = ["is disappointing", "stopped working", "is below average", "feels cheap", "is inconsistent",
                "broke quickly", "is not as described", "needs improvement"]
CLOSERS = ["Would recommend.", "Not sure I would buy again.", "Overall happy.", "Value for money.",
           "Customer support was slow.", "Returned the first unit.", "Good enough for daily use.", "",
           "Bought another as a gift for my wife.", "Asked for a refund, still waiting.",
           "I would request everyone to read reviews before buying.", "Money well spent."]
UNITS = ["days", "weeks", "months"]


def _text(rng: random.Random, rating: int) -> str:
    good = rating >= 4
    parts = [f"{rng.choice(OPENERS)} {rng.randint(2, 11)} {rng.choice(UNITS)}."]
    for aspect in rng.sample(ASPECTS, rng.randint(2, 3)):
        parts.append(f"The {aspect} {rng.choice(VERDICTS_POS if good else VERDICTS_NEG)}.")
    parts.append(rng.choice(CLOSERS))
    return " ".join(p for p in parts if p)


def _amazon_date(d: date) -> str:
    return f"Reviewed in India on {d.day} {d:%B %Y}"


def genuine(seed: int, n: int = 200, span_days: int = 600, verified_rate: float = 0.92, month_dates: bool = False) -> List[Review]:
    rng = random.Random(seed)
    reviews = []
    for i in range(n):
        source = rng.choices(["top", "critical", "recent"], [0.5, 0.3, 0.2])[0]
        rating = rng.choice([1, 2]) if source == "critical" else rng.choices([5, 4, 3, 2, 1], [55, 22, 8, 5, 10])[0]
        age = rng.randint(0, 40) if source == "recent" else rng.randint(0, span_days)
        d = TODAY - timedelta(days=age)
        reviews.append(Review(
            id=f"R{seed:03d}{i:05d}",
            title=rng.choice(["Good", "Okay", "Worth it", "Average", "Not great", "Nice product"]),
            body=_text(rng, rating),
            rating=rating,
            date=f"{d:%b}, {d:%Y}" if month_dates else _amazon_date(d),
            verified=rng.random() < verified_rate,
            source=source,
        ))
    return reviews


def plant_burst(reviews: List[Review], count: int = 40) -> List[Review]:
    rng = random.Random(1)
    start = TODAY - timedelta(days=200)
    return reviews + [
        Review(id=f"RB{i:05d}", title="Excellent", body=_text(rng, 5), rating=5, verified=True, source="top",
               date=_amazon_date(start + timedelta(days=rng.randint(0, 4))))
        for i in range(count)
    ]


def plant_duplicates(reviews: List[Review], count: int = 6) -> List[Review]:
    base = "Amazing product, sound quality is superb and battery backup is too good, must buy for everyone at this price"
    variants = [base, base + "!", base.replace("Amazing", "Awesome"), base + " 👍", base.replace("superb", "super"), base.lower()]
    return reviews + [
        Review(id=f"RD{i:05d}", title="Best", body=variants[i % len(variants)], rating=5, verified=True, source="top",
               date=_amazon_date(TODAY - timedelta(days=30 * i + 3)))
        for i in range(count)
    ]


def plant_incentives(reviews: List[Review]) -> List[Review]:
    texts = [
        "Product is ok but the seller sent a card asking for 5 star review to get ₹100 cashback. Not fair.",
        "Got a WhatsApp message from the seller offering refund after giving 5 star rating.",
        "Delivery boy pressured me to give good rating. Product average.",
    ]
    return reviews + [
        Review(id=f"RI{i}", title="Average", body=t, rating=3, verified=True, source="critical",
               date=_amazon_date(TODAY - timedelta(days=50 + i)))
        for i, t in enumerate(texts)
    ]


CASES = [
    # (name, reviews, expected level set, signal that must be present or None)
    ("genuine (Amazon-style dates)", genuine(1), {"no_concerns"}, None),
    ("genuine (Flipkart month-only dates)", genuine(2, month_dates=True), {"no_concerns"}, None),
    ("genuine, newly launched (30-day span)", genuine(3, span_days=30), {"no_concerns"}, None),
    ("too few reviews", genuine(4, n=12), {"insufficient"}, None),
    ("planted: 5-star burst", plant_burst(genuine(5)), {"some_concerns", "notable_concerns"}, "review_burst"),
    ("planted: near-duplicate reviews", plant_duplicates(genuine(6)), {"some_concerns", "notable_concerns"}, "near_duplicates"),
    ("planted: reward-for-review mentions", plant_incentives(genuine(7)), {"some_concerns", "notable_concerns"}, "incentive_mentions"),
    ("planted: many unverified buyers", genuine(8, verified_rate=0.55), {"some_concerns", "notable_concerns"}, "unverified_share"),
]


def run_deterministic(genuine_seeds: int) -> List[TrustReport]:
    passed, reports = 0, []
    for name, reviews, levels, must in CASES:
        report = trust.assess(reviews, today=TODAY)
        reports.append(report)
        ids = {s.id for s in report.signals}
        ok = report.level in levels and (must in ids if must else not ids)
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:40s} level={report.level:17s} signals={sorted(ids)}")
    print(f"\nplanted/edge cases: {passed}/{len(CASES)} passed")

    false_alarms = []
    for seed in range(100, 100 + genuine_seeds):
        for month_dates in (False, True):
            r = trust.assess(genuine(seed, month_dates=month_dates), today=TODAY)
            if r.signals:
                false_alarms.append((seed, month_dates, [s.title for s in r.signals]))
    print(f"false alarms on genuine review sets: {len(false_alarms)}/{genuine_seeds * 2}")
    for fa in false_alarms[:5]:
        print("   ", fa)
    return reports


def run_validator_unit_checks() -> None:
    report = TrustReport(
        level="some_concerns", reviews_checked=203, checks=[],
        signals=[TrustSignal(id="incentive_mentions", severity="caution",
                             title="3 reviews mention rewards or requests tied to reviews", detail="…")],
    )
    cases = [
        ("3 of the 203 reviews describe rewards linked to reviewing, so lean on verified and critical reviews.", True),
        ("These reviews are fake; the seller paid for them.", False),        # accusation
        ("About 40% of reviews were rewarded, so be careful.", False),        # invented number
        ("Some reviewers say they were offered cashback for ratings.", True),
    ]
    ok = sum(llm.summary_is_safe(text, report) == expect for text, expect in cases)
    print(f"summary validator unit checks: {ok}/{len(cases)}")


async def run_llm(reports: List[TrustReport], runs: int) -> None:
    flagged = [r for r in reports if r.signals]
    rejected, total = 0, 0
    for _ in range(runs):
        for r in flagged:
            r.summary = ""
            summary = await llm.summarize_trust(r)
            total += 1
            if summary == trust.template_summary(r):
                rejected += 1
            assert llm.summary_is_safe(summary, r) or summary == trust.template_summary(r)
    print(f"model summaries: {total - rejected}/{total} accepted by validator, {rejected} replaced by template")
    print("example:", flagged[0].signals[0].title, "->", await llm.summarize_trust(flagged[0]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--genuine-seeds", type=int, default=20)
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--llm-runs", type=int, default=3)
    args = parser.parse_args()
    reports = run_deterministic(args.genuine_seeds)
    run_validator_unit_checks()
    if not args.no_llm:
        asyncio.run(run_llm(reports, args.llm_runs))


if __name__ == "__main__":
    main()
