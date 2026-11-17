import type { Review, ReviewSource } from "../types";

export const MAX_REVIEWS = 250;
export const MAX_REVIEW_PAGES = 20;
const MAX_PAGE_TEXT = 15000;
export const PAGE_DELAY_MS = 400;

export function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function textOf(el: Element | null | undefined): string {
  return clean(el?.textContent);
}

export function first(selectors: string[], root: ParentNode = document): Element | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el && textOf(el)) return el;
  }
  return null;
}

export function parseRating(s: string | null | undefined): number | null {
  const m = clean(s).match(/([0-5](?:\.\d)?)/);
  return m ? Number(m[1]) : null;
}

export function pageText(): string {
  return truncate((document.body?.innerText ?? "").replace(/\n{2,}/g, "\n"), MAX_PAGE_TEXT);
}

/**
 * Returns a filter that drops reviews already seen. Reviews with a site ID are deduped by ID, so the
 * same review fetched by two sort orders collapses, while *different* reviewers posting identical text
 * (a copy-paste pattern the trust check looks for) are kept. ID-less reviews fall back to the text.
 */
export function unseenFilter(): (r: Review) => boolean {
  const ids = new Set<string>();
  const bodies = new Set<string>();
  return (r) => {
    const body = r.body.slice(0, 120);
    if (!r.body) return false;
    if (r.id) {
      if (ids.has(r.id)) return false;
      ids.add(r.id);
    } else if (bodies.has(body)) {
      return false;
    }
    bodies.add(body);
    return true;
  };
}

/** Truncates without splitting an emoji's surrogate pair, which would make the JSON body invalid UTF-8. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function dedupeReviews(reviews: Review[]): Review[] {
  return reviews
    .filter(unseenFilter())
    .slice(0, MAX_REVIEWS)
    .map((r) => ({ ...r, title: truncate(r.title, 300), body: truncate(r.body, 1500) }));
}

// Line-by-line text that also works on DOMParser documents, which have no layout (innerText is unreliable there).
export function textLines(root: Node): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const part of (n.nodeValue ?? "").split("\n")) {
      const line = clean(part);
      if (line) lines.push(line);
    }
  }
  return lines;
}

export type FetchedPage = { doc: Document; finalUrl: string } | null;

export async function fetchPage(url: string): Promise<FetchedPage> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  return { doc: new DOMParser().parseFromString(await res.text(), "text/html"), finalUrl: res.url };
}

export interface MoreReviewsResult {
  reviews: Review[];
  pagesRead: number;
  blocked: "login" | null;
  ratingBreakdown: string;
}

// Default sort ("most helpful") skews positive, so the page budget is split across sort orders.
export const SAMPLE_PLAN: { source: ReviewSource; pages: number }[] = [
  { source: "top", share: 0.5 },
  { source: "critical", share: 0.3 },
  { source: "recent", share: 0.2 },
].map(({ source, share }) => ({
  source: source as ReviewSource,
  pages: Math.max(1, Math.round(MAX_REVIEW_PAGES * share)),
}));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keeps only reviews the filter hasn't seen, tagging them with their source. */
export function takeNew(reviews: Review[], isUnseen: (r: Review) => boolean, source: ReviewSource): Review[] {
  return reviews.filter(isUnseen).map((r) => ({ ...r, source }));
}

export interface ReviewSite {
  pageUrl: (source: ReviewSource, n: number) => string;
  parse: (doc: Document) => Review[];
  isLoginWall: (page: NonNullable<FetchedPage>) => boolean;
  ratingBreakdown: (doc: Document) => string;
}

// Fetches review pages one at a time (politely spaced). Within each sort order it stops early
// when a page adds nothing new.
export async function collectReviewPages(site: ReviewSite): Promise<MoreReviewsResult> {
  const all: Review[] = [];
  const seen = unseenFilter();
  let pagesRead = 0;
  let ratingBreakdown = "";

  for (const { source, pages } of SAMPLE_PLAN) {
    for (let n = 1; n <= pages; n++) {
      if (pagesRead > 0) await sleep(PAGE_DELAY_MS);
      const page = await fetchPage(site.pageUrl(source, n));
      if (!page) break;
      if (site.isLoginWall(page)) return { reviews: all, pagesRead, blocked: "login", ratingBreakdown };
      pagesRead++;
      ratingBreakdown ||= site.ratingBreakdown(page.doc);
      const fresh = takeNew(site.parse(page.doc), seen, source);
      if (fresh.length === 0) break;
      all.push(...fresh);
    }
  }
  return { reviews: all, pagesRead, blocked: null, ratingBreakdown };
}

export function formatBreakdown(countsByStar: Record<number, number>): string {
  const total = [1, 2, 3, 4, 5].reduce((sum, s) => sum + (countsByStar[s] ?? 0), 0);
  if (!total) return "";
  return [5, 4, 3, 2, 1].map((s) => `${s}★ ${Math.round(((countsByStar[s] ?? 0) / total) * 100)}%`).join(", ");
}

export interface JsonLdProduct {
  name?: string;
  brand?: string;
  price?: string;
  rating?: number | null;
  ratingCount?: string;
  reviews: Review[];
}

type Json = Record<string, unknown>;

function findProductNode(node: unknown): Json | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findProductNode(n);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Json;
    const type = obj["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return obj;
    if (obj["@graph"]) return findProductNode(obj["@graph"]);
  }
  return null;
}

export function readJsonLdProduct(root: ParentNode = document): JsonLdProduct | null {
  for (const script of Array.from(root.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const p = findProductNode(parsed);
    if (!p) continue;

    const offers = (Array.isArray(p.offers) ? p.offers[0] : p.offers) as Json | undefined;
    const agg = p.aggregateRating as Json | undefined;
    const rawReviews = (Array.isArray(p.review) ? p.review : p.review ? [p.review] : []) as Json[];

    const brand = typeof p.brand === "string" ? p.brand : (p.brand as Json | undefined)?.name;
    return {
      name: typeof p.name === "string" ? clean(p.name) : undefined,
      brand: typeof brand === "string" ? clean(brand) : undefined,
      price: offers?.price != null ? `₹${Number(offers.price).toLocaleString("en-IN")}` : undefined,
      rating: agg?.ratingValue != null ? Number(agg.ratingValue) : null,
      ratingCount: agg?.ratingCount != null ? `${agg.ratingCount} ratings` : agg?.reviewCount != null ? `${agg.reviewCount} reviews` : undefined,
      reviews: rawReviews.map((r) => ({
        title: clean(String(r.name ?? "")),
        body: clean(String(r.reviewBody ?? r.description ?? "")),
        rating: parseRating(String((r.reviewRating as Json | undefined)?.ratingValue ?? "")),
        date: clean(String(r.datePublished ?? "")),
        verified: false,
      })),
    };
  }
  return null;
}
