import type { Product, Review, ReviewSource } from "../types";
import {
  clean,
  dedupeReviews,
  fetchPage,
  first,
  formatBreakdown,
  PAGE_DELAY_MS,
  pageText,
  parseRating,
  SAMPLE_PLAN,
  sleep,
  takeNew,
  textOf,
  type MoreReviewsResult,
} from "./common";

const ASIN_RE = /\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})/;

export function isAmazonProductPage(url: URL): boolean {
  return url.hostname === "www.amazon.in" && ASIN_RE.test(url.pathname);
}

const REVIEW_SELECTOR = '[data-hook="review"]';
const SCREEN_READER_HINTS = /(Brief|Full) content visible, double tap to read (full|brief) content\./gi;

function extractReviews(root: ParentNode): Review[] {
  const nodes = Array.from(root.querySelectorAll(REVIEW_SELECTOR));
  return nodes.map((node) => {
    const ratingText = textOf(first(['[data-hook="review-star-rating"]', '[data-hook="cmps-review-star-rating"]'], node));
    const rawTitle = textOf(first(['[data-hook="reviewTitle"]', '[data-hook="review-title"]'], node));
    const body = textOf(first(['[data-hook="reviewText"]', '[data-hook="review-body"]'], node))
      .replace(SCREEN_READER_HINTS, "")
      .replace(/Read more$/i, "")
      .trim();
    const badges = textOf(first(['[data-hook="review-badges"]'], node));
    return {
      title: clean(rawTitle.replace(/^[0-5](\.\d)? out of 5 stars/i, "")),
      body,
      rating: parseRating(ratingText),
      date: textOf(first(['[data-hook="review-date"]'], node)),
      verified:
        /Verified Purchase/i.test(badges) ||
        !!node.querySelector('[data-hook="avp-badge"], [data-hook="avp-badge-linkless"]'),
    };
  });
}

// Product-page reviews are lazy-loaded when scrolled near; nudge them into view, then restore the scroll.
async function ensureReviewsLoaded(): Promise<void> {
  if (document.querySelector(REVIEW_SELECTOR)) return;
  const section = document.querySelector('#reviewsMedley, [data-hook="reviews-medley-widget"], #customerReviews');
  if (!section) return;
  const { scrollX, scrollY } = window;
  section.scrollIntoView({ block: "center" });
  for (let i = 0; i < 15 && !document.querySelector(REVIEW_SELECTOR); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  window.scrollTo(scrollX, scrollY);
}

export async function extractAmazon(url: URL): Promise<Product> {
  await ensureReviewsLoaded();
  const ratingEl = document.querySelector("#acrPopover");
  const ratingSource =
    ratingEl?.getAttribute("title") || textOf(first(["#acrPopover .a-icon-alt", '[data-hook="rating-out-of-text"]']));

  return {
    site: "amazon",
    url: url.href,
    product_id: url.pathname.match(ASIN_RE)?.[1] ?? "",
    title: textOf(first(["#productTitle", '[data-hook="product-link"]', "#title"])),
    price: textOf(
      first([
        "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
        "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
        "#corePrice_feature_div .a-offscreen",
        "#priceblock_dealprice",
        "#priceblock_ourprice",
      ])
    ),
    rating: parseRating(ratingSource),
    rating_count: textOf(first(["#acrCustomerReviewText", '[data-hook="total-review-count"]'])),
    rating_breakdown: ratingBreakdown(document),
    features: Array.from(document.querySelectorAll("#feature-bullets li .a-list-item"))
      .map(textOf)
      .filter(Boolean)
      .slice(0, 10),
    reviews: dedupeReviews(extractReviews(document)),
    page_text: pageText(),
  };
}

// Histogram aria-labels are worded differently for signed-out and signed-in users:
// "52 percent of reviews have 5 stars" vs "5 stars represent 52% of ratings" / "1 star represents 5% of ratings".
const BREAKDOWN_LABELS: { re: RegExp; star: number; pct: number }[] = [
  { re: /(\d{1,3}) percent of reviews have ([1-5]) stars?/i, star: 2, pct: 1 },
  { re: /([1-5]) stars? represents? (\d{1,3})\s?% of ratings/i, star: 1, pct: 2 },
];

function ratingBreakdown(root: ParentNode): string {
  const counts: Record<number, number> = {};
  for (const el of Array.from(root.querySelectorAll("[aria-label]"))) {
    const label = el.getAttribute("aria-label") ?? "";
    for (const { re, star, pct } of BREAKDOWN_LABELS) {
      const m = label.match(re);
      if (m) {
        counts[Number(m[star])] ??= Number(m[pct]);
        break;
      }
    }
  }
  return formatBreakdown(counts);
}

const AMAZON_SORT: Record<ReviewSource, { sortBy: string; filterByStar: string }> = {
  top: { sortBy: "", filterByStar: "" },
  critical: { sortBy: "", filterByStar: "critical" },
  recent: { sortBy: "recent", filterByStar: "" },
};

interface ReviewsState {
  asin: string;
  reviewsAjaxUrl: string;
  reviewsCsrfToken: string;
}

function readState(doc: Document): ReviewsState | null {
  try {
    const st = JSON.parse(doc.querySelector<HTMLElement>("#cr-state-object")?.dataset.state ?? "");
    return st.reviewsAjaxUrl && st.reviewsCsrfToken ? st : null;
  } catch {
    return null;
  }
}

// The ajax endpoint returns "&&&"-separated JSON arrays like ["append", "#selector", "<html>"].
function parseAjaxHtml(text: string): Document {
  const html = text
    .split("&&&")
    .map((chunk) => {
      try {
        const part = JSON.parse(chunk.trim());
        return Array.isArray(part) && typeof part[2] === "string" ? part[2] : "";
      } catch {
        return "";
      }
    })
    .join("");
  return new DOMParser().parseFromString(html, "text/html");
}

// Amazon ignores ?pageNumber=N. "Show 10 more reviews" POSTs to an ajax endpoint with a
// nextPageToken carried on the button, and each response contains the next button.
async function* amazonReviewPages(origin: string, asin: string, source: ReviewSource) {
  const sort = AMAZON_SORT[source];
  const firstUrl = new URL(`${origin}/product-reviews/${asin}/`);
  if (sort.sortBy) firstUrl.searchParams.set("sortBy", sort.sortBy);
  if (sort.filterByStar) firstUrl.searchParams.set("filterByStar", sort.filterByStar);

  const first = await fetchPage(firstUrl.href);
  if (!first) return;
  if (first.finalUrl.includes("/ap/signin")) {
    yield { loginWall: true as const };
    return;
  }
  yield { doc: first.doc };

  const state = readState(first.doc);
  let button = first.doc.querySelector('[data-hook="show-more-button"]');
  for (let n = 1; state && button; n++) {
    await sleep(PAGE_DELAY_MS);
    let params: Record<string, string>;
    try {
      params = JSON.parse(button.getAttribute("data-reviews-state-param") ?? "");
    } catch {
      return;
    }
    const body = new URLSearchParams({
      sortBy: sort.sortBy,
      filterByStar: sort.filterByStar,
      reviewerType: "all_reviews",
      formatType: "",
      mediaType: "",
      filterByAge: "",
      filterByLanguage: "",
      filterByKeyword: "",
      pageSize: "10",
      asin: state.asin,
      scope: `reviewsAjax${n}`,
      reftag: button.getAttribute("data-reftag") ?? "",
      ...params,
    });
    const res = await fetch(new URL(state.reviewsAjaxUrl, origin).href, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "anti-csrftoken-a2z": state.reviewsCsrfToken,
      },
      body,
    });
    if (!res.ok) return;
    const doc = parseAjaxHtml(await res.text());
    yield { doc };
    button = doc.querySelector('[data-hook="show-more-button"]');
  }
}

// Amazon only serves the full review list to signed-in users; signed-out requests redirect to /ap/signin.
export async function fetchMoreAmazonReviews(url: URL): Promise<MoreReviewsResult> {
  const asin = url.pathname.match(ASIN_RE)?.[1];
  const result: MoreReviewsResult = { reviews: [], pagesRead: 0, blocked: null, ratingBreakdown: "" };
  if (!asin) return result;
  const seen = new Set<string>();

  for (const { source, pages } of SAMPLE_PLAN) {
    let read = 0;
    for await (const page of amazonReviewPages(url.origin, asin, source)) {
      if ("loginWall" in page) return { ...result, blocked: "login" };
      result.pagesRead++;
      result.ratingBreakdown ||= ratingBreakdown(page.doc);
      const fresh = takeNew(extractReviews(page.doc), seen, source);
      result.reviews.push(...fresh);
      if (fresh.length === 0 || ++read >= pages) break;
    }
  }
  return result;
}
