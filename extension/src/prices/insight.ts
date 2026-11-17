import { DAY, type PricePoint } from "./model";

export type DealVerdict = "good_deal" | "typical" | "above_usual" | "not_enough_data";

export interface PriceInsight {
  verdict: DealVerdict;
  current: number;
  lowest: number;
  lowestAt: number;
  highest: number;
  median: number;
  points: number;
  days: number;
}

export const MIN_POINTS = 3;
export const MIN_DAYS = 3;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Deterministic "is this a good price?" from observed history. No verdict until there are at least
 * 3 readings over 3 days: a short history can't tell a sale from the normal price.
 */
export function priceInsight(points: PricePoint[], now: number): PriceInsight | null {
  if (points.length === 0) return null;
  const prices = points.map((x) => x.p);
  const current = prices[prices.length - 1];
  const lowest = Math.min(...prices);
  const lowestAt = points.find((x) => x.p === lowest)!.t;
  const med = median(prices);
  const days = Math.floor((now - points[0].t) / DAY);
  let verdict: DealVerdict = "typical";
  if (points.length < MIN_POINTS || days < MIN_DAYS) verdict = "not_enough_data";
  else if (current <= lowest && current < med) verdict = "good_deal";
  else if (current <= med * 0.95) verdict = "good_deal";
  else if (current >= med * 1.05) verdict = "above_usual";
  return { verdict, current, lowest, lowestAt, highest: Math.max(...prices), median: med, points: points.length, days };
}
