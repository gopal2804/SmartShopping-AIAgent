import { readAmazonPrice } from "../content/amazon";
import { readJsonLdProduct, textOf } from "../content/common";
import type { Site } from "../types";

/** "₹1,299.00" → 1299. Returns null for empty or non-positive values. */
export function toNumber(price: string | null | undefined): number | null {
  const cleaned = (price ?? "").replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) && n > 0 ? n : null;
}

/** Current selling price from a product page (live or fetched), or null if unavailable. */
export function parseProductPrice(site: Site, doc: Document): number | null {
  if (site === "amazon") {
    if (doc.querySelector("#outOfStock") || /currently unavailable/i.test(textOf(doc.querySelector("#availability")))) {
      return null;
    }
    return toNumber(readAmazonPrice(doc));
  }
  return toNumber(readJsonLdProduct(doc)?.price);
}
