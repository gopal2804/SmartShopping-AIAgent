import { DAY, type PricePoint, type WatchItem } from "./model";

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Decides whether a fresh reading deserves a notification. `before` is the history *before* this
 * reading. Rules, most specific first:
 *  1. Target set and price at/below it → alert, unless we already alerted at this price or lower.
 *  2. No target: price ≥5% below the previous reading → alert, at most once a day…
 *  3. …unless it is also a new lowest price, which always alerts.
 */
export function alertFor(item: WatchItem, price: number, before: PricePoint[], now: number): string | null {
  const alreadyAt = item.lastNotifiedPrice;
  if (item.target !== null) {
    if (price <= item.target && (alreadyAt === null || price < alreadyAt)) {
      return `Now ${rupees(price)}, at or below your target of ${rupees(item.target)}.`;
    }
    return null;
  }
  const prev = before[before.length - 1]?.p;
  if (prev === undefined || price > prev * 0.95) return null;
  const lowestBefore = Math.min(...before.map((x) => x.p));
  const newLow = before.length >= 3 && price < lowestBefore;
  const quiet = item.lastNotifiedAt === null || now - item.lastNotifiedAt >= DAY;
  if (!newLow && !quiet) return null;
  return newLow
    ? `Dropped from ${rupees(prev)} to ${rupees(price)}: the lowest price seen since you started tracking.`
    : `Dropped from ${rupees(prev)} to ${rupees(price)}.`;
}
