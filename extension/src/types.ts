export type Site = "amazon" | "flipkart";

export interface Review {
  title: string;
  body: string;
  rating: number | null;
  date: string;
  verified: boolean;
  /** How the review was sampled: top = most helpful, critical = lowest-rated first, recent = newest. */
  source?: ReviewSource;
}

export type ReviewSource = "top" | "critical" | "recent";

export interface Product {
  site: Site;
  url: string;
  product_id: string;
  title: string;
  brand: string;
  price: string;
  rating: number | null;
  rating_count: string;
  /** Share of all ratings per star, e.g. "5★ 52%, 4★ 21%, 3★ 8%, 2★ 4%, 1★ 15%". */
  rating_breakdown: string;
  features: string[];
  reviews: Review[];
  page_text: string;
}

export interface Theme {
  point: string;
  frequency: "most" | "many" | "some" | "few";
}

export interface ProductAnalysis {
  verdict: "recommended" | "consider_alternatives" | "avoid";
  verdict_reason: string;
  summary: string;
  pros: Theme[];
  cons: Theme[];
  best_for: string[];
  confidence: "high" | "medium" | "low";
  confidence_reason: string;
}

/** A search-result listing on the other site. Prices and ratings are scraped, never model-generated. */
export interface Listing {
  site: Site;
  id: string;
  title: string;
  /** Variant details shown separately by the site, e.g. Flipkart's "Carbon Black, True Wireless". */
  variant: string;
  brand: string;
  price: number | null;
  mrp: number | null;
  rating: number | null;
  ratingCount: number | null;
  url: string;
  sponsored: boolean;
}

export type MatchVerdict = "same" | "variant" | "different";

export interface MatchResult {
  listing: Listing;
  verdict: Exclude<MatchVerdict, "different">;
  differences: string[];
  reason: string;
}

export type Comparison =
  | { status: "searching"; target: Site }
  | { status: "done"; target: Site; match: MatchResult | null; checked: number }
  | { status: "error"; target: Site; message: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ExtractResponse = { ok: true; product: Product } | { ok: false; reason: string };

export type MoreReviewsResponse =
  | { ok: true; reviews: Review[]; pagesRead: number; blocked: "login" | null; ratingBreakdown: string }
  | { ok: false; reason: string };

export const EXTRACT_MESSAGE = "SSA_EXTRACT_PRODUCT";
export const MORE_REVIEWS_MESSAGE = "SSA_FETCH_MORE_REVIEWS";
