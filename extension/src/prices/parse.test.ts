// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseProductPrice } from "./parse";

const doc = (body: string) => new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html");

// Markup shapes seen on Amazon.in product pages (Nov 2026), trimmed to the price block.
const priceToPay = (inner: string) =>
  `<div id="corePriceDisplay_desktop_feature_div">
     <span class="a-price aok-align-center reinventPricePriceToPayMargin priceToPay apex-pricetopay-value">${inner}</span>
     <span class="a-price a-text-price apex-basisprice-value" data-a-strike="true">
       <span class="a-offscreen">₹79,900</span><span aria-hidden="true">₹79,900</span>
     </span>
   </div>`;

describe("parseProductPrice (Amazon)", () => {
  it("reads the screen-reader price when present", () => {
    expect(parseProductPrice("amazon", doc(priceToPay(`<span class="a-offscreen">₹71,890.00</span>`)))).toBe(71890);
  });

  it("falls back to whole + fraction when the screen-reader text is blank, never to the struck M.R.P.", () => {
    const html = priceToPay(
      `<span class="a-offscreen"> </span>
       <span><span class="a-price-symbol">₹</span><span class="a-price-whole">71,890<span class="a-price-decimal">.</span></span><span class="a-price-fraction">00</span></span>`
    );
    expect(parseProductPrice("amazon", doc(html))).toBe(71890);
  });

  it("uses the aria-hidden visible copy when that is the only filled one", () => {
    const html = priceToPay(`<span class="a-offscreen"> </span><span aria-hidden="true">₹1,099</span>`);
    expect(parseProductPrice("amazon", doc(html))).toBe(1099);
  });

  it("reads legacy price blocks", () => {
    expect(parseProductPrice("amazon", doc(`<span id="priceblock_ourprice">₹2,499.00</span>`))).toBe(2499);
  });

  it("returns null when out of stock, even if an old price is on the page", () => {
    const html = `<div id="availability">Currently unavailable.</div>${priceToPay(`<span class="a-offscreen">₹999</span>`)}`;
    expect(parseProductPrice("amazon", doc(html))).toBeNull();
  });

  it("returns null rather than the M.R.P. when only the struck price exists", () => {
    const html = `<div id="corePriceDisplay_desktop_feature_div"><span class="a-price" data-a-strike="true"><span class="a-offscreen">₹79,900</span></span></div>`;
    expect(parseProductPrice("amazon", doc(html))).toBeNull();
  });
});

describe("parseProductPrice (Flipkart)", () => {
  const ld = (sku: string, price: number) =>
    `<script type="application/ld+json">[{"@type":"Product","name":"x","sku":"${sku}","offers":{"@type":"Offer","price":${price}}}]</script>`;
  // Ad banner and a recommendation strip sit above the heading, as on the Honeywell Air Touch P2 page.
  const page = (structured: string) => `
    ${structured}
    <div><span>PHILIPS AC4221/61 Covers Large Rooms</span><div>₹25,887</div></div>
    <div><div>₹9,990</div></div>
    <h1>Honeywell Air Touch P2 5 Stage Filtration</h1>
    <div><div style="text-decoration: line-through">₹32,999</div><div>₹19,498</div></div>
    <div><div>₹18,523</div></div>`;

  it("reads the JSON-LD offer price for this product", () => {
    expect(parseProductPrice("flipkart", doc(page(ld("APFGSPC7BQHCGJ8K", 19498))), "APFGSPC7BQHCGJ8K")).toBe(19498);
  });

  it("ignores stale structured data from another product and never reads the ad above the heading", () => {
    expect(parseProductPrice("flipkart", doc(page(ld("PHILIPSAC4221", 25887))), "APFGSPC7BQHCGJ8K")).toBe(19498);
  });

  it("without structured data, takes the first non-struck price after the heading", () => {
    expect(parseProductPrice("flipkart", doc(page("")), "APFGSPC7BQHCGJ8K")).toBe(19498);
  });

  it("returns null rather than guessing when there is no heading or structured data", () => {
    expect(parseProductPrice("flipkart", doc(`<div>₹25,887</div>`), "X")).toBeNull();
  });
});
