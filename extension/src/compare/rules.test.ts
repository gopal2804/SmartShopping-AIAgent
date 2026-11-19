import { describe, expect, it } from "vitest";
import { truncate } from "../content/common";
import { brandMatches, buildQuery, modelTokens, preFilter, specConflicts } from "./rules";

const listing = (title: string, variant = "", brand = "") => ({ title, variant, brand });

describe("buildQuery", () => {
  it("keeps the product name before the first separator", () => {
    expect(buildQuery("boAt Airdopes 219, 4Mics ENx, 40H Battery, Best in Segment", "boAt")).toBe("boAt Airdopes 219");
  });

  it("adds storage/RAM specs that follow the separator", () => {
    expect(buildQuery("OnePlus Nord CE6 Lite | 8GB+128GB | Vivid Mint", "OnePlus")).toBe(
      "OnePlus Nord CE6 Lite 8GB 128GB"
    );
  });

  it("prefixes the brand when the title omits it", () => {
    expect(buildQuery("Women Active Shorts– High-Rise", "Clovia")).toMatch(/^Clovia Women Active Shorts/);
  });
});

describe("modelTokens", () => {
  it("keeps model identifiers but not specs, battery hours or years", () => {
    expect([...modelTokens("boAt 2026 Launch Airdopes 219 40H Battery 8GB")]).toEqual(["219"]);
    expect(modelTokens("OnePlus Nord CE6 Lite 5G").has("ce6")).toBe(true);
  });
});

describe("specConflicts", () => {
  it("flags different storage", () => {
    expect(specConflicts("Nord CE6 Lite 8GB 128GB", "Nord CE6 Lite (256 GB) (8 GB RAM)")).toHaveLength(1);
  });

  it("ignores specs present on only one side", () => {
    expect(specConflicts("Nord CE6 Lite 8GB 128GB", "OnePlus Nord CE6 Lite 5G (Vivid Mint)")).toEqual([]);
  });

  it("accepts the same specs written differently", () => {
    expect(specConflicts("8GB+128GB", "(128 GB) (8 GB RAM)")).toEqual([]);
  });
});

describe("brandMatches", () => {
  it("is case and punctuation insensitive", () => {
    expect(brandMatches("boAt", "", "BOAT Airdopes 219")).toBe(true);
    expect(brandMatches("boAt", "", "Noise Buds N1")).toBe(false);
  });

  it("treats store-specific brand names as one brand (Flipkart 'Mi', Amazon 'Xiaomi')", () => {
    expect(brandMatches("Mi", "", "Xiaomi Air Purifier 4 Lite for home|360 m3/hr CADR")).toBe(true);
    expect(brandMatches("Xiaomi", "", "Mi Smart Air Purifier 4 Lite for home360 m3/hr CADR")).toBe(true);
    expect(brandMatches("Mi", "", "Honeywell Air Touch V2")).toBe(false);
  });

  it("falls back to the first word of the title", () => {
    expect(brandMatches("", "Clovia Women Active Shorts", "Clovia High-Rise Shorts")).toBe(true);
  });
});

describe("preFilter", () => {
  const src = "boAt Airdopes 219, 4Mics ENx, 40H Battery (Carbon Black)";

  it("drops other brands and other models, keeps the exact model first", () => {
    const out = preFilter(src, "boAt", [
      listing("Noise Buds N1 Truly Wireless Earbuds", "", "Noise"),
      listing("boAt Airdopes 141 ANC Earbuds", "Black", "boAt"),
      listing("boAt Airdopes 219, 40H Battery, Free Music Streaming", "Carbon Black, True Wireless", "boAt"),
    ]);
    expect(out.map((s) => s.item.title)).toEqual(["boAt Airdopes 219, 40H Battery, Free Music Streaming"]);
  });

  // Real titles from user feedback (Nov 2026): both listings were dropped before the AI check.
  it("keeps the Xiaomi listing for a Flipkart 'Mi' product", () => {
    const out = preFilter(
      "Mi Smart Air Purifier 4 Lite for home360 m3/hr CADR covers 640 sq.ft.3Stage HighEfficiencyFilter",
      "Mi",
      [
        listing("Xiaomi Air Purifier 4 Lite for home|360 m3/hr CADR covers 640 sq.ft.|3Stage HighEfficiencyFilter"),
        listing("Honeywell Air Purifier for Home, 4 Stage Filtration, Covers 388 sq.ft", "", "Honeywell"),
      ]
    );
    expect(out.map((s) => s.item.title)).toEqual([
      "Xiaomi Air Purifier 4 Lite for home|360 m3/hr CADR covers 640 sq.ft.|3Stage HighEfficiencyFilter",
    ]);
  });

  it("matches '111 W' with '111W'", () => {
    const out = preFilter("Portronics 111 W Turbo Car Charger (Black)", "", [
      listing("Car Power Quard 111W Car Charger, 4 Ports Fast Car Charger, Dual 33W Type-C PD", "", "Portronics"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("returns at most the requested number of candidates", () => {
    const many = Array.from({ length: 9 }, (_, i) => listing(`boAt Airdopes 219 colour ${i}`, "", "boAt"));
    expect(preFilter(src, "boAt", many, 5)).toHaveLength(5);
  });
});

describe("truncate", () => {
  it("never leaves half of an emoji", () => {
    const s = "great 👍";
    expect(truncate(s, 7)).toBe("great ");
    expect(() => encodeURIComponent(truncate(s, 7))).not.toThrow();
    expect(truncate(s, 8)).toBe(s);
  });
});
