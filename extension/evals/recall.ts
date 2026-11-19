/**
 * End-to-end recall check for cross-site matching on real, hand-labelled products.
 *
 * For each case it fetches the live product page, runs the extension's own extractor on it, then runs the
 * real compare pipeline (live search → rule filter → AI verifier via a backend → spec veto). Where a
 * match is lost, it reports the stage: not in search results, dropped by the filter, or judged by the AI.
 *
 * Needs a backend with a high match limit, e.g. from backend/:
 *   LIMIT_MATCH_PER_DAY=100000 .venv/bin/uvicorn app.main:app --port 8001
 * Then from extension/:
 *   BACKEND=http://localhost:8001 npx vite-node evals/recall.ts [--only <name substring>]
 *
 * Live sites change, so this is a health check, not a CI test: a failure means "look at this case".
 */
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import type { Comparison, Listing, Product, Site } from "../src/types";

const BACKEND = process.env.BACKEND ?? "http://localhost:8001";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

interface Case {
  name: string;
  site: Site;
  id: string;
  expect: "same" | "variant" | "none";
  accept?: string[];
  colour_ok?: string[];
}

// ---- Browser-like globals so the extension's own code runs unchanged in Node ----
const base = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.amazon.in/" });
const g = globalThis as Record<string, unknown>;
g.DOMParser = base.window.DOMParser;
const realFetch = globalThis.fetch;
g.fetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
  realFetch(input, {
    ...init,
    headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", ...(init.headers as Record<string, string>) },
  });

function useDocument(html: string, url: string) {
  // Real pages have CSS jsdom can't parse; its console noise is not useful here.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  // jsdom lacks layout: these are no-ops or textContent stand-ins.
  w.HTMLElement.prototype.scrollIntoView = () => undefined;
  w.scrollTo = () => undefined;
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
    configurable: true,
  });
  g.window = w;
  g.document = w.document;
  g.location = w.location;
  g.HTMLElement = w.HTMLElement;
  g.Element = w.Element;
  g.Node = w.Node;
  g.NodeFilter = w.NodeFilter;
}

const productUrl = (c: Case) =>
  c.site === "amazon" ? `https://www.amazon.in/dp/${c.id}` : `https://www.flipkart.com/product/p/itm?pid=${c.id}`;

async function loadProduct(c: Case): Promise<Product> {
  const res = await fetch(productUrl(c));
  if (!res.ok) throw new Error(`product page ${res.status}`);
  const html = await res.text();
  let url = new URL(res.url || productUrl(c));
  if (c.site === "flipkart" && !url.searchParams.get("pid")) url = new URL(productUrl(c));
  useDocument(html, url.href);
  // Imported after the globals exist: the content scripts read `document` at call time.
  const { extractAmazon } = await import("../src/content/amazon");
  const { extractFlipkart } = await import("../src/content/flipkart");
  return c.site === "amazon" ? extractAmazon(url) : extractFlipkart(url);
}

let token = "";
async function verify(source: unknown, candidates: unknown[]) {
  if (!token) {
    const r = await realFetch(`${BACKEND}/api/register`, { method: "POST" });
    token = ((await r.json()) as { token: string }).token;
  }
  const r = await realFetch(`${BACKEND}/api/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, candidates }),
  });
  if (!r.ok) throw new Error(`match ${r.status}: ${await r.text()}`);
  return ((await r.json()) as { verdicts: never[] }).verdicts;
}

// found_variant: the right product, shown as "similar listing" (another colour, or not provable from titles).
type Outcome = "found" | "found_variant" | "MISS" | "WRONG_SAME" | "CHECK" | "ok_none" | "ERROR";

function judge(c: Case, cmp: Comparison): Outcome {
  if (cmp.status !== "done") return "ERROR";
  const m = cmp.match;
  const id = m?.listing.id ?? "";
  const accept = c.accept ?? [];
  const colours = c.colour_ok ?? [];
  if (c.expect === "none") return m?.verdict === "same" ? "WRONG_SAME" : "ok_none";
  if (!m) return "MISS";
  if (c.expect === "variant") {
    if (m.verdict === "same") return accept.includes(id) ? "CHECK" : "WRONG_SAME";
    return accept.includes(id) ? "found" : "CHECK";
  }
  if (accept.includes(id)) return m.verdict === "same" ? "found" : "found_variant";
  // Another colour: fine as "variant", and as "same" when the source title doesn't name a colour.
  if (colours.includes(id)) return "found_variant";
  return "CHECK"; // matched a listing we didn't label: inspect by hand
}

/** For a miss, the first stage where an expected listing was lost. */
function lostAt(c: Case, rounds: { results: Listing[]; shortlist: Listing[]; verdicts: { index: number; verdict: string }[] }[]) {
  const wanted = new Set([...(c.accept ?? []), ...(c.colour_ok ?? [])]);
  const inResults = rounds.some((r) => r.results.some((l) => wanted.has(l.id)));
  if (!inResults) return "not in search results";
  const round = rounds.find((r) => r.shortlist.some((l) => wanted.has(l.id)));
  if (!round) return "dropped by rule filter";
  const i = round.shortlist.findIndex((l) => wanted.has(l.id));
  return `AI said "${round.verdicts.find((v) => v.index === i)?.verdict ?? "?"}"`;
}

async function main() {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";
  const { cases } = JSON.parse(readFileSync(new URL("./recall_cases.json", import.meta.url), "utf8")) as { cases: Case[] };
  const { compareProduct } = await import("../src/compare");
  const { searchAmazon, searchFlipkart } = await import("../src/compare/search");
  const tally: Record<string, number> = {};
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const c of cases.filter((x) => !only || x.name.toLowerCase().includes(only.toLowerCase()))) {
    let outcome: Outcome = "ERROR";
    let detail = "";
    try {
      const product = await loadProduct(c);
      const trace = { rounds: [] as never[] } as { rounds: { query: string; results: Listing[]; shortlist: Listing[]; verdicts: { index: number; verdict: string }[] }[] };
      const cmp = await compareProduct(
        product,
        { search: (site, q) => (site === "amazon" ? searchAmazon(q) : searchFlipkart(q)), verify: verify as never },
        trace as never
      );
      outcome = judge(c, cmp);
      const m = cmp.status === "done" ? cmp.match : null;
      detail = [
        `brand="${product.brand}" model="${product.model ?? ""}"`,
        `queries: ${trace.rounds.map((r) => `"${r.query}" (${r.results.length} results, ${r.shortlist.length} shortlisted)`).join(" → ")}`,
        m ? `match: ${m.verdict} ${m.listing.id} ${m.listing.title.slice(0, 70)}` : "match: none",
        outcome === "MISS" ? `lost at: ${lostAt(c, trace.rounds)}` : "",
        cmp.status === "error" ? `error: ${cmp.message}` : "",
      ]
        .filter(Boolean)
        .join("\n      ");
    } catch (err) {
      detail = String(err);
    }
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    await pause(4000); // be gentle: rapid requests trigger Amazon's robot check
    console.log(`${outcome.padEnd(12)} [${c.site}] ${c.name}\n      ${detail}`);
  }

  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const shouldFind = cases.filter((c) => c.expect !== "none" && (!only || c.name.toLowerCase().includes(only.toLowerCase()))).length;
  console.log(`\n${total} cases:`, tally);
  console.log(`recall (found, incl. as variant): ${(tally.found ?? 0) + (tally.found_variant ?? 0)}/${shouldFind}`);
  console.log(`wrong "same" (must be 0): ${tally.WRONG_SAME ?? 0}`);
}

void main();
