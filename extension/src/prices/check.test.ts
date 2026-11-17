import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPriceCheck } from "./check";
import { DAY } from "./model";
import { clearHistory, getHistory, getWatchlist, recordPrice, watch } from "./store";

// In-memory stand-in for chrome.storage.local.
let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items: Record<string, unknown>) => Object.assign(store, structuredClone(items)),
        remove: async (key: string) => void delete store[key],
      },
    },
  });
});

const T0 = Date.UTC(2026, 10, 1);
const product = { site: "amazon" as const, id: "B0TEST", title: "Earbuds", url: "https://www.amazon.in/dp/B0TEST" };

function deps(prices: (number | null)[], now: number) {
  const notified: string[] = [];
  let i = 0;
  return {
    notified,
    deps: {
      fetchPrice: async () => prices[i++] ?? null,
      notify: async (_item: unknown, msg: string) => void notified.push(msg),
      now: () => now,
      sleep: async () => undefined,
    },
  };
}

describe("runPriceCheck", () => {
  it("records the price and alerts once the target is reached", async () => {
    await recordPrice(product, 1299, T0);
    await watch({ ...product, target: 1100 });

    const first = deps([1199], T0 + DAY);
    expect(await runPriceCheck(first.deps)).toEqual({ checked: 1, alerts: 0 });

    const second = deps([1099], T0 + 2 * DAY);
    expect(await runPriceCheck(second.deps)).toEqual({ checked: 1, alerts: 1 });
    expect(second.notified[0]).toMatch(/₹1,099.*target of ₹1,100/);
    expect((await getHistory("amazon", "B0TEST"))!.points.map((p) => p.p)).toEqual([1299, 1199, 1099]);

    // Same price next time: no repeat alert.
    const third = deps([1099], T0 + 3 * DAY);
    expect((await runPriceCheck(third.deps)).alerts).toBe(0);
  });

  it("ignores a suspect reading instead of alerting on it", async () => {
    await recordPrice(product, 30999, T0);
    await watch({ ...product, target: null });
    const run = deps([342], T0 + DAY); // e.g. an EMI price picked up by mistake
    expect((await runPriceCheck(run.deps)).alerts).toBe(0);
    expect((await getHistory("amazon", "B0TEST"))!.points).toHaveLength(1);
  });

  it("keeps products added while a check is running", async () => {
    await watch({ ...product, target: null });
    const run = deps([999], T0 + DAY);
    const slowFetch = run.deps.fetchPrice;
    run.deps.fetchPrice = async () => {
      await watch({ site: "flipkart", id: "PID1", title: "Phone", url: "https://www.flipkart.com/x/p/itm1?pid=PID1", target: null });
      return slowFetch();
    };
    await runPriceCheck(run.deps);
    const list = await getWatchlist();
    expect(list.map((w) => w.id).sort()).toEqual(["B0TEST", "PID1"]);
    expect(list.find((w) => w.id === "B0TEST")!.lastCheckedAt).toBe(T0 + DAY);
  });

  it("resetting history removes bad readings but keeps the product watched", async () => {
    await recordPrice(product, 25887, T0); // e.g. an ad's price read by mistake
    await recordPrice(product, 19498, T0 + DAY);
    await watch({ ...product, target: 19000 });
    await clearHistory("amazon", "B0TEST");
    expect(await getHistory("amazon", "B0TEST")).toBeNull();
    expect((await getWatchlist()).map((w) => w.target)).toEqual([19000]);
    await recordPrice(product, 19498, T0 + 2 * DAY);
    expect((await getHistory("amazon", "B0TEST"))!.points.map((p) => p.p)).toEqual([19498]);
  });

  it("caps the watchlist size", async () => {
    for (let i = 0; i < 20; i++) await watch({ ...product, id: `ID${i}`, target: null });
    await expect(watch({ ...product, id: "ONE_MORE", target: null })).rejects.toThrow(/up to 20/);
  });
});
