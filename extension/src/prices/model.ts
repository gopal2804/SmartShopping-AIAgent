import type { Site } from "../types";

export interface PricePoint {
  /** epoch ms */
  t: number;
  /** rupees */
  p: number;
}

export interface PriceHistory {
  site: Site;
  id: string;
  title: string;
  url: string;
  points: PricePoint[];
}

export interface WatchItem {
  key: string;
  site: Site;
  id: string;
  title: string;
  url: string;
  /** Alert when the price is at or below this; null = alert on any meaningful drop. */
  target: number | null;
  addedAt: number;
  lastCheckedAt: number | null;
  lastNotifiedAt: number | null;
  lastNotifiedPrice: number | null;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const historyKey = (site: Site, id: string) => `price:${site}:${id}`;

/** A reading this far from the last one is more likely a parsing slip (e.g. an EMI price) than a real change. */
export function isSuspect(price: number, last: number | undefined): boolean {
  return last !== undefined && (price < last / 3 || price > last * 3);
}

/** Appends a reading unless it is suspect, or repeats the last price within 6 hours. Keeps the last 500. */
export function appendPoint(
  points: PricePoint[],
  price: number,
  now: number
): { points: PricePoint[]; accepted: boolean; reason?: "suspect" | "unchanged" } {
  const last = points[points.length - 1];
  if (isSuspect(price, last?.p)) return { points, accepted: false, reason: "suspect" };
  if (last && last.p === price && now - last.t < 6 * HOUR) return { points, accepted: false, reason: "unchanged" };
  return { points: [...points, { t: now, p: price }].slice(-500), accepted: true };
}
