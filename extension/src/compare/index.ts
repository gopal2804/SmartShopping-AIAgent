import type { Comparison, Listing, MatchResult, Product, Site } from "../types";
import { verifyMatches } from "../sidepanel/api";
import { buildQuery, preFilter, specConflicts } from "./rules";
import { searchAmazon, searchFlipkart } from "./search";

const OTHER: Record<Site, Site> = { amazon: "flipkart", flipkart: "amazon" };

/**
 * Finds the product on the other site. Pipeline: search → rule pre-filter → AI verifier (titles only,
 * no prices) → rule veto on conflicting specs. "same" requires both the AI and the rules to agree;
 * anything uncertain is downgraded to "variant" or dropped.
 */
export async function compareProduct(product: Product): Promise<Comparison> {
  const target = OTHER[product.site];
  try {
    const query = buildQuery(product.title, product.brand);
    const results = await (target === "flipkart" ? searchFlipkart(query) : searchAmazon(query));
    const shortlist = preFilter(product.title, product.brand, results).map((s) => s.item);
    if (shortlist.length === 0) return { status: "done", target, match: null, checked: results.length };

    const verdicts = await verifyMatches(
      { site: product.site, title: product.title, brand: product.brand },
      shortlist.map((c) => ({ title: c.title, variant: c.variant, brand: c.brand }))
    );

    const ranked: MatchResult[] = [];
    shortlist.forEach((listing: Listing, i) => {
      const v = verdicts.find((x) => x.index === i);
      if (!v || v.verdict === "different") return;
      const conflicts = specConflicts(product.title, `${listing.title} ${listing.variant}`);
      ranked.push({
        listing,
        verdict: v.verdict === "same" && conflicts.length === 0 ? "same" : "variant",
        differences: [...new Set([...conflicts, ...v.differences])].slice(0, 3),
        reason: v.reason,
      });
    });
    // Shortlist order is the rule score, so the first "same" is also the closest listing.
    const match = ranked.find((r) => r.verdict === "same") ?? ranked[0] ?? null;
    return { status: "done", target, match, checked: results.length };
  } catch (err) {
    return { status: "error", target, message: err instanceof Error ? err.message : String(err) };
  }
}
