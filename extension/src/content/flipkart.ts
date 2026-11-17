import type { Product, Review, ReviewSource } from "../types";
import {
  canonicalProductUrl,
  clean,
  collectReviewPages,
  dedupeReviews,
  formatBreakdown,
  pageText,
  parseRating,
  readJsonLdProduct,
  textLines,
  textOf,
  type MoreReviewsResult,
} from "./common";

// Flipkart uses obfuscated, frequently changing class names, so this extractor relies on
// structured data and visible-text patterns instead of CSS classes.

export function isFlipkartProductPage(url: URL): boolean {
  return url.hostname === "www.flipkart.com" && /\/(p|product-reviews)\/itm/.test(url.pathname);
}

/** Structured data for *this* product. Flipkart swaps pages in place, so data whose sku isn't the URL's pid is stale. */
export function currentJsonLd(root: Document, pid: string) {
  const ld = readJsonLdProduct(root);
  return ld && (!pid || !ld.sku || ld.sku === pid) ? ld : null;
}

/**
 * Fallback when structured data is missing: the first non-struck ₹ amount *after the product heading*.
 * Ads and recommendation strips with their own prices sit above the heading, so "first ₹ on the page"
 * picks the wrong product.
 */
export function priceAfterHeading(root: Document): string {
  const h1 = root.querySelector("h1");
  if (!h1) return "";
  for (const el of Array.from(root.querySelectorAll("div, span"))) {
    if (el.children.length !== 0 || !/^₹\s?[\d,]+(\.\d+)?$/.test(textOf(el))) continue;
    if (!(h1.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (!isStruck(el, root)) return textOf(el);
  }
  return "";
}

/** Crossed-out M.R.P. Parsed (fetched) documents have no computed styles, so markup and inline styles count too. */
function isStruck(el: Element, root: Document): boolean {
  if (el.closest("del, s, strike")) return true;
  if (/line-through/.test(el.getAttribute("style") ?? "")) return true;
  const view = root.defaultView;
  return !!view && view.getComputedStyle(el).textDecorationLine.includes("line-through");
}

export function flipkartPagePrice(root: Document, pid: string): string {
  return currentJsonLd(root, pid)?.price || priceAfterHeading(root);
}

/** After in-place navigation the new product's structured data can arrive a moment after the URL changes. */
async function waitForJsonLd(pid: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ld = currentJsonLd(document, pid);
    if ((ld && ld.price) || Date.now() >= deadline) return ld;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const BADGE_RE = /Certified Buyer|Verified Purchase/g;
const NOISE_RE = /^(•|READ MORE|Permalink|Report Abuse|Helpful for \d+|Helpful|\d+)$/i;
const RATING_RE = /^[1-5](\.\d)?$/;

function countBadges(el: Element): number {
  return (el.textContent?.match(BADGE_RE) ?? []).length;
}

// A review card's text lines look like:
// ["5.0", "•", "Super!", "Review for: Color …", <body lines…>, "<author>", ", <city>", "8", "46", "Verified Purchase · Aug, 2025"]
// The rating line or the "Review for:" line can be missing.
function parseReviewCard(container: Element): Review {
  const lines = textLines(container);
  const ratingIdx = lines.findIndex((l) => RATING_RE.test(l));
  const variantIdx = lines.findIndex((l) => /^Review for:/i.test(l));

  let titleIdx = -1;
  let bodyStart = -1;
  if (variantIdx > 0) {
    titleIdx = variantIdx - 1;
    bodyStart = variantIdx + 1;
  } else if (ratingIdx >= 0) {
    titleIdx = lines.findIndex((l, i) => i > ratingIdx && l !== "•");
    bodyStart = titleIdx + 1;
  }
  const cityIdx = bodyStart > 0 ? lines.findIndex((l, i) => i > bodyStart && l.startsWith(",")) : -1;
  const bodyLines = cityIdx > bodyStart ? lines.slice(bodyStart, cityIdx - 1).filter((l) => !NOISE_RE.test(l)) : [];
  const body = bodyLines.length
    ? bodyLines.join(" ")
    : lines.reduce((a, b) => (b.length > a.length ? b : a), "");

  return {
    title: titleIdx >= 0 && lines[titleIdx] !== "•" ? lines[titleIdx] : "",
    body,
    rating: ratingIdx >= 0 && ratingIdx < titleIdx ? parseRating(lines[ratingIdx]) : null,
    date: clean((lines.find((l) => /(ago|\b20\d\d)$/i.test(l)) ?? "").replace(/^.*·\s*/, "")),
    verified: true,
  };
}

function reviewsFromBadges(root: ParentNode): Review[] {
  const badges = Array.from(root.querySelectorAll("p, span, div")).filter(
    (el) => el.children.length <= 1 && /^(Certified Buyer|Verified Purchase)/.test(textOf(el))
  );

  // Each card can contain nested badge elements, so collect unique containers.
  const containers = new Set<Element>();
  for (const badge of badges) {
    // Climb to the largest ancestor that still contains only this one review.
    let container: Element = badge;
    for (let i = 0; i < 10 && container.parentElement && countBadges(container.parentElement) === 1; i++) {
      container = container.parentElement;
    }
    containers.add(container);
  }
  return Array.from(containers, parseReviewCard);
}

type Json = Record<string, unknown>;

// Flipkart server-renders star icons as empty placeholders, but embeds the full review
// objects (with numeric ratings) in window.__INITIAL_STATE__. Prefer that when present.
function reviewsFromInitialState(root: Document): Review[] {
  const script = Array.from(root.querySelectorAll("script")).find((s) =>
    s.textContent?.includes("window.__INITIAL_STATE__")
  );
  if (!script?.textContent) return [];
  let state: unknown;
  try {
    const raw = script.textContent;
    state = JSON.parse(raw.slice(raw.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
  } catch {
    return [];
  }

  const found: Json[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const obj = node as Json;
    if (typeof obj.text === "string" && typeof obj.rating === "number" && "reviewPropertyMap" in obj) {
      found.push(obj);
      return;
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(state);

  return found.map((r) => ({
    id: typeof r.id === "string" && r.id ? r.id : undefined,
    title: clean(String(r.title ?? "")),
    body: clean(String(r.text)),
    rating: r.rating as number,
    date: clean(String(r.created ?? "")),
    verified: !!(r.reviewPropertyMap as Json | null)?.VERIFIED_PURCHASE || !!r.certifiedBuyer,
  }));
}

function reviewsFromDocument(root: Document): Review[] {
  const fromState = reviewsFromInitialState(root);
  return fromState.length ? fromState : reviewsFromBadges(root);
}

function fallbackTitle(): string {
  const h1 = textOf(document.querySelector("h1")).replace(/\.\.\.\s*more$/i, "");
  return h1 || clean(document.title.split(/ Reviews:| Price in India/)[0]);
}

export async function extractFlipkart(url: URL): Promise<Product> {
  const pid = url.searchParams.get("pid") ?? "";
  const ld = await waitForJsonLd(pid);
  const ldReviews = ld?.reviews.filter((r) => r.body) ?? [];
  const reviews = dedupeReviews([...reviewsFromDocument(document), ...ldReviews]);

  return {
    site: "flipkart",
    url: canonicalProductUrl(url, pid),
    product_id: pid,
    title: ld?.name || fallbackTitle(),
    brand: ld?.brand ?? "",
    price: ld?.price || priceAfterHeading(document),
    rating: ld?.rating ?? null,
    rating_count: ld?.ratingCount || (document.body.innerText.match(/[\d,]+ ratings and [\d,]+ reviews/)?.[0] ?? ""),
    rating_breakdown: ratingBreakdown(document),
    features: [],
    reviews,
    page_text: pageText(reviews.length),
  };
}

// Review pages show the histogram as separate text lines: "5", "★", "25,175", "4", "★", "10,005", …
function ratingBreakdown(root: Document): string {
  const lines = root.body ? textLines(root.body) : [];
  const counts: Record<number, number> = {};
  for (let i = 0; i + 2 < lines.length; i++) {
    if (/^[1-5]$/.test(lines[i]) && lines[i + 1] === "★" && /^[\d,]+$/.test(lines[i + 2])) {
      counts[Number(lines[i])] ??= Number(lines[i + 2].replace(/,/g, ""));
    }
  }
  return Object.keys(counts).length === 5 ? formatBreakdown(counts) : "";
}

const FLIPKART_SORT: Record<ReviewSource, string> = {
  top: "MOST_HELPFUL",
  critical: "NEGATIVE_FIRST",
  recent: "MOST_RECENT",
};

export function fetchMoreFlipkartReviews(url: URL): Promise<MoreReviewsResult> {
  const reviewsUrl = new URL(url.href.replace("/p/itm", "/product-reviews/itm"));
  return collectReviewPages({
    pageUrl: (source, n) => {
      reviewsUrl.searchParams.set("sortOrder", FLIPKART_SORT[source]);
      reviewsUrl.searchParams.set("page", String(n));
      return reviewsUrl.href;
    },
    parse: reviewsFromDocument,
    isLoginWall: (page) => /\/account\/login/.test(page.finalUrl),
    ratingBreakdown,
  });
}
