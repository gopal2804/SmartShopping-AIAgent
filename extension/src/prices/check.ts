import type { Site } from "../types";
import { alertFor } from "./alerts";
import type { WatchItem } from "./model";
import { getHistory, getWatchlist, recordPrice, saveWatchlist } from "./store";

export const PRICE_ALARM = "ssa-price-check";
export const CHECK_INTERVAL_MINUTES = 360;
const GAP_BETWEEN_PRODUCTS_MS = 2000;

export interface CheckDeps {
  fetchPrice: (site: Site, url: string) => Promise<number | null>;
  notify: (item: WatchItem, message: string) => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Checks every watched product once, politely spaced, recording prices and sending at most one alert each. */
export async function runPriceCheck(deps: CheckDeps): Promise<{ checked: number; alerts: number }> {
  const items = await getWatchlist();
  const updated = new Map<string, WatchItem>();
  let alerts = 0;

  for (const [i, item] of items.entries()) {
    if (i > 0) await deps.sleep(GAP_BETWEEN_PRODUCTS_MS);
    const now = deps.now();
    const next: WatchItem = { ...item, lastCheckedAt: now };
    const price = await deps.fetchPrice(item.site, item.url).catch(() => null);
    if (price !== null) {
      const before = (await getHistory(item.site, item.id))?.points ?? [];
      const { accepted } = await recordPrice(item, price, now);
      const message = accepted ? alertFor(item, price, before, now) : null;
      if (message) {
        await deps.notify(item, message);
        next.lastNotifiedAt = now;
        next.lastNotifiedPrice = price;
        alerts++;
      }
    }
    updated.set(item.key, next);
  }

  // Re-read so products added or removed while checking aren't lost or resurrected.
  const latest = await getWatchlist();
  await saveWatchlist(latest.map((w) => updated.get(w.key) ?? w));
  return { checked: items.length, alerts };
}
