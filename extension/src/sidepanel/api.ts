import {
  EXTRACT_MESSAGE,
  MORE_REVIEWS_MESSAGE,
  type ChatMessage,
  type ExtractResponse,
  type MatchVerdict,
  type MoreReviewsResponse,
  type Product,
  type ProductAnalysis,
  type Site,
} from "../types";

export const BACKEND_URL = "http://localhost:8000";
const SUPPORTED_HOSTS = ["www.amazon.in", "www.flipkart.com"];

async function sendToActiveTab<T>(type: string): Promise<T | { ok: false; reason: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !SUPPORTED_HOSTS.includes(new URL(tab.url).hostname)) {
    return { ok: false, reason: "unsupported_site" };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    // Tabs opened before the extension was installed have no content script yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tab.id, { type });
  }
}

export function getActiveProduct(): Promise<ExtractResponse> {
  return sendToActiveTab<ExtractResponse>(EXTRACT_MESSAGE);
}

export function getMoreReviews(): Promise<MoreReviewsResponse> {
  return sendToActiveTab<MoreReviewsResponse>(MORE_REVIEWS_MESSAGE);
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function analyzeProduct(product: Product): Promise<ProductAnalysis> {
  const res = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

export interface MatchVerdictDto {
  index: number;
  verdict: MatchVerdict;
  differences: string[];
  reason: string;
}

export async function verifyMatches(
  source: { site: Site; title: string; brand: string },
  candidates: { title: string; variant: string; brand: string }[]
): Promise<MatchVerdictDto[]> {
  const res = await fetch(`${BACKEND_URL}/api/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, candidates }),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return (await res.json()).verdicts;
}

export interface ComparisonDto {
  site: Site;
  verdict: "same" | "variant";
  title: string;
  price: number | null;
  rating: number | null;
  rating_count: number | null;
  differences: string[];
}

export async function streamChat(
  body: { product: Product; analysis: ProductAnalysis | null; comparison: ComparisonDto | null; messages: ChatMessage[] },
  onChunk: (text: string) => void
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(await errorDetail(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
