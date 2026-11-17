"""Deterministic review-pattern signals.

No model is involved here: every number a shopper sees is computed from the reviews, so it can be
checked. Signals describe *unusual patterns*, never verdicts like "fake". Thresholds are deliberately
conservative: a missed pattern is better than a false accusation against a genuine product.
"""
import re
from datetime import date, timedelta
from typing import Dict, List, Optional, Set, Tuple

from .schemas import Review, TrustCheck, TrustReport, TrustSignal

MIN_REVIEWS = 20

BURST_WINDOW_DAYS = 7
BURST_MIN_DATED = 15
BURST_MIN_SPAN_DAYS = 60
BURST_MIN_COUNT = 8

DUP_MIN_WORDS = 8
DUP_JACCARD = 0.5

_MONTHS = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split(), 1)}

# A reward or request must be *linked to* reviewing. Plain mentions ("bought as a gift, 5 star",
# "asked for a refund, 1 star") must not match; the eval includes such genuine phrasings.
_REWARD = r"(cash ?back|refund|money|paid|pay|rs\.? ?\d+|₹ ?\d+|gift card|gift voucher|voucher|reward|free product|discount)"
_FOR_REVIEW = (
    r"(for|after|on) (giving |writing |posting |leaving |a |the |my )*"
    r"((5|five)[ -]?stars?|(positive |good |honest )?(review|rating))"
)
_ASKERS = r"(seller|brand|company|delivery (boy|person|agent|guy)|whats ?app|card|leaflet|pamphlet|note|message|call(ed)?)"
_INCENTIVE_PATTERNS = [
    r"in exchange for (an? )?(honest |unbiased )?review",
    rf"{_REWARD}.{{0,40}}{_FOR_REVIEW}",
    rf"{_FOR_REVIEW}.{{0,40}}{_REWARD}",
    rf"{_ASKERS}.{{0,40}}(ask|asked|asking|request|requested|requesting|forc\w*|pressur\w*|offer\w*).{{0,40}}((5|five)[ -]?stars?|positive review|good review|review|rating)",
    r"vine customer review",
]
_INCENTIVE_RE = re.compile("|".join(f"(?:{p})" for p in _INCENTIVE_PATTERNS), re.I)


# ---------------------------------------------------------------------------------------------- dates


def parse_review_date(text: str, today: date) -> Optional[Tuple[date, str]]:
    """Returns (date, precision) where precision is "day" or "month"; None if unparseable."""
    t = (text or "").lower()
    if not t:
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return _safe_date(int(m[1]), int(m[2]), int(m[3])), "day"
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})", t)
    if m and m[2] in _MONTHS:
        return _safe_date(int(m[3]), _MONTHS[m[2]], int(m[1])), "day"
    m = re.search(r"\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})", t)
    if m and m[1] in _MONTHS:
        return _safe_date(int(m[3]), _MONTHS[m[1]], int(m[2])), "day"
    if "today" in t:
        return today, "day"
    if "yesterday" in t:
        return today - timedelta(days=1), "day"
    m = re.search(r"\b(\d+|a|an)\s+(day|week|month|year)s?\s+ago", t)
    if m:
        n = 1 if m[1] in ("a", "an") else int(m[1])
        days = {"day": 1, "week": 7, "month": 30, "year": 365}[m[2]] * n
        return today - timedelta(days=days), "day" if m[2] in ("day", "week") else "month"
    m = re.search(r"\b([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b", t)
    if m and m[1] in _MONTHS:
        return _safe_date(int(m[2]), _MONTHS[m[1]], 1), "month"
    return None


def _safe_date(y: int, mo: int, d: int) -> date:
    try:
        return date(y, mo, d)
    except ValueError:
        return date(y, mo, 1)


# -------------------------------------------------------------------------------------------- signals


def _pct(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def check_burst(reviews: List[Review], today: date):
    # "recent" reviews are sampled newest-first, which would look like a burst by construction.
    pool = [r for r in reviews if r.source != "recent" and (r.rating or 0) >= 5]
    dated = sorted(d for d, prec in (parse_review_date(r.date, today) or (None, "") for r in pool) if d and prec == "day")
    if len(dated) < BURST_MIN_DATED:
        return None, TrustCheck(id="review_burst", status="skipped", note="Not enough exact review dates to check for bursts")
    span = (dated[-1] - dated[0]).days + 1
    if span < BURST_MIN_SPAN_DAYS:
        return None, TrustCheck(id="review_burst", status="skipped", note=f"Reviews only span {span} days, too short to judge bursts")

    best, best_start, j = 0, 0, 0
    for i in range(len(dated)):
        while (dated[i] - dated[j]).days >= BURST_WINDOW_DAYS:
            j += 1
        if i - j + 1 > best:
            best, best_start = i - j + 1, j
    share = best / len(dated)
    expected = BURST_WINDOW_DAYS / span
    if best >= BURST_MIN_COUNT and share >= 0.3 and share >= 4 * expected:
        start, end = dated[best_start], dated[best_start + best - 1]
        signal = TrustSignal(
            id="review_burst",
            severity="warning" if share >= 0.5 else "caution",
            title=f"{_pct(best, len(dated))}% of dated 5-star reviews were posted within {BURST_WINDOW_DAYS} days",
            detail=(
                f"{best} of {len(dated)} 5-star reviews with exact dates fall between {start:%d %b %Y} and "
                f"{end:%d %b %Y}; the reviews checked span {span} days."
            ),
        )
        return signal, TrustCheck(id="review_burst", status="flagged", note=signal.title)
    return None, TrustCheck(id="review_burst", status="passed", note=f"No unusual bursts among {len(dated)} dated 5-star reviews")


def _shingles(text: str) -> Set[Tuple[str, ...]]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {tuple(words[i : i + 3]) for i in range(len(words) - 2)}


def check_near_duplicates(reviews: List[Review]):
    longer = [(r, _shingles(r.body)) for r in reviews if len(re.findall(r"\w+", r.body)) >= DUP_MIN_WORDS]
    if len(longer) < 10:
        return None, TrustCheck(id="near_duplicates", status="skipped", note="Too few detailed reviews to compare wording")

    parent = list(range(len(longer)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(len(longer)):
        a = longer[i][1]
        for k in range(i + 1, len(longer)):
            b = longer[k][1]
            if a and b and len(a & b) / len(a | b) >= DUP_JACCARD:
                parent[find(i)] = find(k)

    groups: Dict[int, List[int]] = {}
    for i in range(len(longer)):
        groups.setdefault(find(i), []).append(i)
    clusters = sorted((g for g in groups.values() if len(g) > 1), key=len, reverse=True)
    dup_reviews = sum(len(g) for g in clusters)
    biggest = len(clusters[0]) if clusters else 0
    if biggest >= 3 or dup_reviews >= 4:
        examples = [longer[i][0].body[:160] for i in clusters[0][:2]]
        signal = TrustSignal(
            id="near_duplicates",
            severity="warning" if biggest >= 5 or dup_reviews >= 8 else "caution",
            title=f"{dup_reviews} reviews share near-identical wording",
            detail=f"Largest group: {biggest} reviews with almost the same text, out of {len(longer)} detailed reviews compared.",
            examples=examples,
        )
        return signal, TrustCheck(id="near_duplicates", status="flagged", note=signal.title)
    return None, TrustCheck(id="near_duplicates", status="passed", note=f"No near-duplicate wording among {len(longer)} detailed reviews")


def check_unverified(reviews: List[Review]):
    n = len(reviews)
    unverified = [r for r in reviews if not r.verified]
    share = len(unverified) / n
    if share >= 0.3:
        five = [r for r in reviews if (r.rating or 0) >= 5]
        low = [r for r in reviews if r.rating is not None and r.rating <= 2]
        five_u = _pct(sum(not r.verified for r in five), len(five))
        low_u = _pct(sum(not r.verified for r in low), len(low))
        signal = TrustSignal(
            id="unverified_share",
            severity="warning" if share >= 0.5 else "caution",
            title=f"{_pct(len(unverified), n)}% of reviews are not from verified purchases",
            detail=f"Unverified: {five_u}% of 5-star reviews vs {low_u}% of 1–2 star reviews, out of {n} reviews checked.",
        )
        return signal, TrustCheck(id="unverified_share", status="flagged", note=signal.title)
    return None, TrustCheck(
        id="unverified_share", status="passed", note=f"{_pct(n - len(unverified), n)}% of reviews are verified purchases"
    )


def check_incentives(reviews: List[Review]):
    hits = []
    for r in reviews:
        text = f"{r.title}. {r.body}"
        m = _INCENTIVE_RE.search(text)
        if m:
            start, end = max(0, m.start() - 40), min(len(text), m.end() + 40)
            hits.append(("…" if start else "") + text[start:end].strip() + ("…" if end < len(text) else ""))
    if len(hits) >= 2:
        signal = TrustSignal(
            id="incentive_mentions",
            severity="warning" if len(hits) >= 4 else "caution",
            title=f"{len(hits)} reviews mention rewards or requests tied to reviews",
            detail="These reviewers describe cashback, refunds, gifts, free products or requests linked to reviewing or rating.",
            examples=hits[:3],
        )
        return signal, TrustCheck(id="incentive_mentions", status="flagged", note=signal.title)
    return None, TrustCheck(id="incentive_mentions", status="passed", note="No repeated mentions of rewards for reviews")


# --------------------------------------------------------------------------------------------- report


def assess(reviews: List[Review], today: Optional[date] = None) -> TrustReport:
    today = today or date.today()
    n = len(reviews)
    if n < MIN_REVIEWS:
        return TrustReport(level="insufficient", reviews_checked=n, signals=[], checks=[])

    signals: List[TrustSignal] = []
    checks: List[TrustCheck] = []
    for result in (check_burst(reviews, today), check_near_duplicates(reviews), check_unverified(reviews), check_incentives(reviews)):
        signal, check = result
        checks.append(check)
        if signal:
            signals.append(signal)

    warnings = sum(s.severity == "warning" for s in signals)
    level = "notable_concerns" if warnings or len(signals) >= 2 else "some_concerns" if signals else "no_concerns"
    return TrustReport(level=level, reviews_checked=n, signals=signals, checks=checks)


def template_summary(report: TrustReport) -> str:
    if report.level == "insufficient":
        return f"Only {report.reviews_checked} reviews were available, too few to check for unusual patterns."
    if not report.signals:
        return f"No unusual review patterns found in the {report.reviews_checked} reviews checked."
    titles = "; ".join(s.title for s in report.signals)
    return f"Unusual patterns found: {titles}. Weigh verified and critical reviews more heavily."
