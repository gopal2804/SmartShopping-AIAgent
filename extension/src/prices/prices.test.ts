import { describe, expect, it } from "vitest";
import { alertFor } from "./alerts";
import { priceInsight } from "./insight";
import { appendPoint, DAY, HOUR, type PricePoint, type WatchItem } from "./model";
import { toNumber } from "./parse";

const T0 = Date.UTC(2026, 10, 1);
const pts = (...prices: number[]): PricePoint[] => prices.map((p, i) => ({ t: T0 + i * DAY, p }));
const item = (over: Partial<WatchItem> = {}): WatchItem => ({
  key: "price:amazon:X", site: "amazon", id: "X", title: "t", url: "u", target: null,
  addedAt: T0, lastCheckedAt: null, lastNotifiedAt: null, lastNotifiedPrice: null, ...over,
});

describe("toNumber", () => {
  it("parses Indian price formats", () => {
    expect(toNumber("₹1,299.00")).toBe(1299);
    expect(toNumber("₹28,139")).toBe(28139);
    expect(toNumber("")).toBeNull();
  });
});

describe("appendPoint", () => {
  it("rejects a reading over 3x away from the last one as suspect", () => {
    expect(appendPoint(pts(30999), 342, T0 + DAY).reason).toBe("suspect");
    expect(appendPoint(pts(342), 30999, T0 + DAY).reason).toBe("suspect");
  });

  it("skips an unchanged price within 6 hours but records it later", () => {
    expect(appendPoint(pts(299), 299, T0 + 2 * HOUR).reason).toBe("unchanged");
    expect(appendPoint(pts(299), 299, T0 + 7 * HOUR).accepted).toBe(true);
  });
});

describe("priceInsight", () => {
  it("withholds a verdict until there are 3 readings over 3 days", () => {
    expect(priceInsight(pts(299, 279), T0 + 5 * DAY)?.verdict).toBe("not_enough_data");
    expect(priceInsight(pts(299, 299, 279), T0 + 2 * DAY)?.verdict).toBe("not_enough_data");
  });

  it("calls a new low below the median a good deal", () => {
    expect(priceInsight(pts(299, 309, 299, 279), T0 + 5 * DAY)?.verdict).toBe("good_deal");
  });

  it("flags prices well above the median", () => {
    expect(priceInsight(pts(299, 299, 299, 349), T0 + 5 * DAY)?.verdict).toBe("above_usual");
  });

  it("treats a flat price as typical", () => {
    const insight = priceInsight(pts(299, 299, 299, 299), T0 + 5 * DAY)!;
    expect(insight.verdict).toBe("typical");
    expect(insight).toMatchObject({ lowest: 299, highest: 299, median: 299, points: 4 });
  });
});

describe("alertFor", () => {
  it("alerts once when a target is reached, again only at a lower price", () => {
    const watched = item({ target: 280 });
    expect(alertFor(watched, 279, pts(299), T0 + DAY)).toMatch(/target/);
    expect(alertFor({ ...watched, lastNotifiedPrice: 279 }, 279, pts(299, 279), T0 + 2 * DAY)).toBeNull();
    expect(alertFor({ ...watched, lastNotifiedPrice: 279 }, 269, pts(299, 279), T0 + 2 * DAY)).toMatch(/269/);
    expect(alertFor(watched, 285, pts(299), T0 + DAY)).toBeNull();
  });

  it("without a target, alerts on a 5% drop at most once a day", () => {
    expect(alertFor(item(), 290, pts(299), T0 + DAY)).toBeNull();
    expect(alertFor(item(), 279, pts(299), T0 + DAY)).toMatch(/Dropped/);
    expect(alertFor(item({ lastNotifiedAt: T0 + DAY }), 259, pts(299, 279), T0 + DAY + HOUR)).toBeNull();
  });

  it("always alerts on a new lowest price", () => {
    const recent = item({ lastNotifiedAt: T0 + 3 * DAY });
    expect(alertFor(recent, 249, pts(299, 289, 279, 269), T0 + 3 * DAY + HOUR)).toMatch(/lowest/);
  });
});
