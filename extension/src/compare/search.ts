import type { Listing, Site } from "../types";

// Search pages are fetched from the side panel (an extension page), which host_permissions
// allow to read both sites. Only these origins are ever requested or linked to.
const ORIGIN: Record<Site, string> = {
  amazon: "https://www.amazon.in",
  flipkart: "https://www.flipkart.com",
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const num = (s: string | null | undefined) => {
  const n = Number(clean(s).replace(/[^\d.]/g, ""));
  return clean(s) && Number.isFinite(n) ? n : null;
};

/** Builds a link on the site's own origin from a path; anything else is rejected. */
export function safeUrl(site: Site, path: string): string {
  const url = new URL(path, ORIGIN[site]);
  if (url.origin !== ORIGIN[site]) throw new Error(`Refusing off-site URL: ${url.origin}`);
  return url.href;
}

async function fetchDoc(url: string): Promise<Document> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return new DOMParser().parseFromString(await res.text(), "text/html");
}

type Json = Record<string, unknown>;

function findAll(node: unknown, match: (o: Json) => boolean, out: Json[] = []): Json[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => findAll(n, match, out));
    return out;
  }
  const obj = node as Json;
  if (match(obj)) {
    out.push(obj);
    return out;
  }
  for (const v of Object.values(obj)) findAll(v, match, out);
  return out;
}

export async function searchFlipkart(query: string): Promise<Listing[]> {
  const doc = await fetchDoc(`${ORIGIN.flipkart}/search?q=${encodeURIComponent(query)}`);
  const script = Array.from(doc.querySelectorAll("script")).find((s) =>
    s.textContent?.includes("window.__INITIAL_STATE__")
  );
  if (!script?.textContent) return [];
  const raw = script.textContent;
  const state = JSON.parse(raw.slice(raw.indexOf("=") + 1).trim().replace(/;\s*$/, ""));

  const seen = new Set<string>();
  const listings: Listing[] = [];
  for (const p of findAll(state, (o) => !!o.titles && !!o.pricing && typeof o.id === "string")) {
    const id = p.id as string;
    if (seen.has(id) || typeof p.baseUrl !== "string") continue;
    seen.add(id);
    const titles = p.titles as Json;
    const prices = ((p.pricing as Json).prices as Json[] | undefined) ?? [];
    const rating = (p.rating as Json | undefined) ?? {};
    listings.push({
      site: "flipkart",
      id,
      title: clean(String(titles.title ?? titles.newTitle ?? "")),
      variant: clean(String(titles.subtitle ?? "")),
      brand: clean(String(titles.superTitle ?? "")),
      price: (prices.find((x) => !x.strikeOff)?.value as number | undefined) ?? null,
      mrp: (prices.find((x) => x.strikeOff)?.value as number | undefined) ?? null,
      rating: typeof rating.average === "number" ? rating.average : null,
      ratingCount: typeof rating.count === "number" ? rating.count : null,
      url: safeUrl("flipkart", p.baseUrl),
      sponsored: false,
    });
  }
  return listings;
}

export async function searchAmazon(query: string): Promise<Listing[]> {
  const doc = await fetchDoc(`${ORIGIN.amazon}/s?k=${encodeURIComponent(query)}`);
  const byAsin = new Map<string, Listing>();
  for (const card of Array.from(doc.querySelectorAll('[data-component-type="s-search-result"]'))) {
    const asin = (card as HTMLElement).dataset.asin ?? "";
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    // Some cards split brand and title into two <h2>s; the longest one is the title.
    const h2s = Array.from(card.querySelectorAll("h2"), (h) => clean(h.textContent));
    const title = h2s.reduce((a, b) => (b.length > a.length ? b : a), "");
    const brand = h2s.length > 1 ? h2s.reduce((a, b) => (b.length < a.length ? b : a)) : "";
    const countLabel =
      card.querySelector('[aria-label$="ratings"]')?.getAttribute("aria-label") ??
      clean(card.querySelector(".s-underline-text")?.textContent);
    const listing: Listing = {
      site: "amazon",
      id: asin,
      title,
      variant: "",
      brand,
      price: num(card.querySelector(".a-price:not([data-a-strike]) .a-offscreen")?.textContent),
      mrp: num(card.querySelector(".a-price[data-a-strike] .a-offscreen")?.textContent),
      rating: num(card.querySelector(".a-icon-alt")?.textContent?.split(" ")[0]),
      ratingCount: num(countLabel),
      url: safeUrl("amazon", `/dp/${asin}`),
      sponsored:
        !!card.querySelector(".puis-sponsored-label-text") ||
        /^Sponsored/.test(clean(card.querySelector('[data-cy="title-recipe"]')?.textContent)),
    };
    // The same product often appears twice, as an ad and as an organic result; keep the organic one.
    const existing = byAsin.get(asin);
    if (listing.title && (!existing || (existing.sponsored && !listing.sponsored))) byAsin.set(asin, listing);
  }
  return [...byAsin.values()];
}
