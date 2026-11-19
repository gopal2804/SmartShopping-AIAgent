import { describe, expect, it } from "vitest";
import { truncate } from "../content/common";
import { matchReportUrl } from "./report";
import { brandMatches, buildQuery, modelCode, modelConflict, modelTokens, preFilter, searchQueries, specConflicts } from "./rules";

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

  it("accepts either side of 'X by Y' brands (Flipkart's 'PHILIPS by Phlips', 'BAJAJ by Bajaj')", () => {
    expect(brandMatches("PHILIPS by Phlips", "", "Philips HL7756 Mixer Grinder 750W")).toBe(true);
    expect(brandMatches("Mijia by Xiaomi", "", "Mi Smart Air Purifier 4 Lite")).toBe(true);
    expect(brandMatches("PHILIPS by Phlips", "", "Bajaj GX-8 Mixer Grinder")).toBe(false);
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

describe("modelCode", () => {
  it("keeps the comparable part of a spec-table model", () => {
    expect(modelCode("WH1000XM5/LMIN")).toBe("wh1000xm5");
    expect(modelCode("PIC 20")).toBe("pic20");
    expect(modelCode("HD9252/90 with Touch Panel, uses up to 90% less fat")).toBe("hd9252");
    expect(modelCode("M331 Silent Plus, 1000 DPI Optical Tracking")).toBe("m331");
  });

  it("ignores names without a usable code", () => {
    expect(modelCode("XM Series")).toBe("");
    expect(modelCode("Car Power Quard")).toBe("");
    expect(modelCode("")).toBe("");
  });
});

describe("modelConflict", () => {
  it("flags a different code from the same model family", () => {
    expect(modelConflict("HL7756/01", "Stainless Steel Mixer Grinder HL7707/01, 750W, 4 Jars")).toBe(true);
    expect(modelConflict("WH1000XM5/LMIN", "SONY WH-1000XM6 Wireless Noise Cancellation")).toBe(true);
  });

  it("accepts the same code written differently, or no code at all", () => {
    expect(modelConflict("WH1000XM5/LMIN", "SONY WH-1000XM5 Wireless Noise Cancellation")).toBe(false);
    expect(modelConflict("HL7756/00", "PHILIPS Daily Collection 750 W Mixer Grinder | HL7756/01 | 3 Jars")).toBe(false);
    expect(modelConflict("HL7756/01", "Philips Daily Collection 750 W Mixer Grinder")).toBe(false);
    expect(modelConflict("", "anything HL7707")).toBe(false);
  });
});

describe("searchQueries", () => {
  it("adds a model-number query when the spec table has one", () => {
    expect(searchQueries("PHILIPS by Phlips Daily Collection 750 W Mixer Grinder", "PHILIPS", "HL7756/01")).toEqual([
      "PHILIPS by Phlips Daily Collection 750 W Mixer",
      "PHILIPS HL7756",
    ]);
  });

  it("otherwise retries with a shorter title query", () => {
    expect(searchQueries("Portronics 111 W Turbo Car Charger (Black)", "Portronics")).toEqual([
      "Portronics 111 W Turbo Car Charger",
      "Portronics 111 W Turbo Car",
    ]);
  });
});

describe("preFilter ranking (real titles)", () => {
  it("puts the matching capacity above other sizes of the same line", () => {
    const out = preFilter("MILTON Thermosteel Flip Lid 1000 ml Stainless Steel Flask", "MILTON", [
      listing("Thermosteel Duo 750 ml Stainless Steel Flask", "", "Milton"),
      listing("Thermosteel Duo 500 ml Stainless Steel Flask", "", "Milton"),
      listing("Flip Lid 1000 Thermosteel Water Bottle 1 LTR, 24 Hr Hot and Cold I Leak Proof Lid, ISI Certified I Vacuum Insulated", "", "Milton"),
    ]);
    expect(out[0].item.title).toMatch(/^Flip Lid 1000/);
  });

  it("ranks a candidate containing the source's model number first", () => {
    const out = preFilter("PHILIPS by Phlips Daily Collection 750 W Mixer Grinder", "PHILIPS", [
      listing("Stainless Steel Mixer Grinder HL7707/01, 750W, 4 Jars", "", "Philips"),
      listing("HL7756 Mixer Grinder 750W, with 3 Stainless Steel Jars", "", "Philips"),
    ], 6, "HL7756/01");
    expect(out[0].item.title).toMatch(/^HL7756/);
  });

  it("still sends the closest listings to the AI when none share a model identifier", () => {
    const out = preFilter("boAt Airdopes 219, 40H Battery", "boAt", [
      listing("boAt Airdopes Two-One-Nine 40H Battery Earbuds", "", "boAt"),
      listing("boAt Stone 350 Speaker", "", "boAt"),
    ]);
    expect(out.map((s) => s.item.title)).toEqual(["boAt Airdopes Two-One-Nine 40H Battery Earbuds"]);
  });
});

describe("matchReportUrl", () => {
  it("prefills a GitHub issue with only the two product links", () => {
    const url = new URL(matchReportUrl("https://www.flipkart.com/x/p/itm?pid=P1", "https://www.amazon.in/dp/B000000001"));
    expect(url.origin + url.pathname).toBe("https://github.com/gopal2804/SmartShopping-AIAgent/issues/new");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("Product: https://www.flipkart.com/x/p/itm?pid=P1");
    expect(body).toContain("Match shown: https://www.amazon.in/dp/B000000001");
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
