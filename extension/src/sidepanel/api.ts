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
  type TrustReport,
} from "../types";

// Set VITE_BACKEND_URL at build time for a hosted backend; local development uses localhost.
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
const SUPPORTED_HOSTS = ["www.amazon.in", "www.flipkart.com"];
const TOKEN_KEY = "installToken";

let tokenRequest: Promise<string> | null = null;

/** The hosted backend sleeps when idle; pinging /health on panel open starts the wake-up early. */
export async function warmUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(90_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Anonymous install token from POST /api/register, kept in chrome.storage.local. */
function installToken(): Promise<string> {
  tokenRequest ??= (async () => {
    const stored = (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY];
    if (typeof stored === "string" && stored) return stored;
    const res = await fetch(`${BACKEND_URL}/api/register`, { method: "POST" });
    if (!res.ok) throw new Error(await errorDetail(res));
    const { token } = await res.json();
    await chrome.storage.local.set({ [TOKEN_KEY]: token });
    return token as string;
  })().catch((err) => {
    tokenRequest = null; // allow a retry on the next request
    throw err;
  });
  return tokenRequest;
}

/** fetch() to the backend with the install token; re-registers once if the server no longer knows it. */
async function apiFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
  const token = await installToken();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && retry) {
    await chrome.storage.local.remove(TOKEN_KEY);
    tokenRequest = null;
    return apiFetch(path, init, false);
  }
  return res;
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

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

/** The server sends {detail: {code, message}} for limits, budget and auth; show its message as-is. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (typeof data.detail?.message === "string") return data.detail.message;
    return `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}

export async function analyzeProduct(product: Product): Promise<ProductAnalysis> {
  const res = await apiFetch("/api/analyze", jsonPost(product));
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json();
}

export async function checkTrust(product: Product): Promise<TrustReport> {
  const res = await apiFetch("/api/trust", jsonPost(product));
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
  source: { site: Site; title: string; brand: string; variant?: string },
  candidates: { title: string; variant: string; brand: string }[]
): Promise<MatchVerdictDto[]> {
  const res = await apiFetch("/api/match", jsonPost({ source, candidates }));
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

/** Observed price history for the chat; every number comes from recorded readings. */
export interface PriceInsightDto {
  site: Site;
  verdict: "good_deal" | "typical" | "above_usual" | "not_enough_data";
  current: number;
  lowest: number;
  lowest_date: string;
  highest: number;
  usual: number;
  readings: number;
  days_tracked: number;
  other_site_price: number | null;
}

export async function streamChat(
  body: {
    product: Product;
    analysis: ProductAnalysis | null;
    comparison: ComparisonDto | null;
    trust: TrustReport | null;
    price_history: PriceInsightDto | null;
    messages: ChatMessage[];
  },
  onChunk: (text: string) => void
): Promise<void> {
  const res = await apiFetch("/api/chat", jsonPost(body));
  if (!res.ok || !res.body) throw new Error(await errorDetail(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
