import type { Site } from "../types";
import { appendPoint, historyKey, type PriceHistory, type WatchItem } from "./model";

// Everything lives in chrome.storage.local: price history and the watchlist never leave the browser.

const WATCHLIST = "watchlist";
export const MAX_WATCHED = 20;

export async function getHistory(site: Site, id: string): Promise<PriceHistory | null> {
  const key = historyKey(site, id);
  return ((await chrome.storage.local.get(key))[key] as PriceHistory | undefined) ?? null;
}

export async function recordPrice(
  meta: { site: Site; id: string; title: string; url: string },
  price: number,
  now = Date.now()
): Promise<{ history: PriceHistory; accepted: boolean; reason?: string }> {
  const existing = await getHistory(meta.site, meta.id);
  const base: PriceHistory = existing ?? { ...meta, points: [] };
  const { points, accepted, reason } = appendPoint(base.points, price, now);
  const history = { ...base, title: meta.title || base.title, url: meta.url || base.url, points };
  if (accepted) await chrome.storage.local.set({ [historyKey(meta.site, meta.id)]: history });
  return { history, accepted, reason };
}

export async function getWatchlist(): Promise<WatchItem[]> {
  return ((await chrome.storage.local.get(WATCHLIST))[WATCHLIST] as WatchItem[] | undefined) ?? [];
}

export async function saveWatchlist(items: WatchItem[]): Promise<void> {
  await chrome.storage.local.set({ [WATCHLIST]: items });
}

export async function watch(item: Omit<WatchItem, "key" | "addedAt" | "lastCheckedAt" | "lastNotifiedAt" | "lastNotifiedPrice">) {
  const list = await getWatchlist();
  const key = historyKey(item.site, item.id);
  const others = list.filter((w) => w.key !== key);
  if (others.length >= MAX_WATCHED) throw new Error(`You can watch up to ${MAX_WATCHED} products.`);
  const existing = list.find((w) => w.key === key);
  const next: WatchItem = {
    ...item,
    key,
    addedAt: existing?.addedAt ?? Date.now(),
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    lastNotifiedAt: null,
    lastNotifiedPrice: null,
  };
  await saveWatchlist([...others, next]);
  return next;
}

export async function unwatch(site: Site, id: string): Promise<void> {
  const key = historyKey(site, id);
  await saveWatchlist((await getWatchlist()).filter((w) => w.key !== key));
}
