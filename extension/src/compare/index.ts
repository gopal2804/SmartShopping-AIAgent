import type { Comparison, Listing, MatchResult, Product, Site } from "../types";
import { verifyMatches, type MatchVerdictDto } from "../sidepanel/api";
import { modelConflict, preFilter, searchQueries, specConflicts } from "./rules";
import { searchAmazon, searchFlipkart } from "./search";

const OTHER: Record<Site, Site> = { amazon: "flipkart", flipkart: "amazon" };

/** What the pipeline needs from the outside world; swapped for live helpers in the recall eval. */
export interface CompareDeps {
  search: (site: Site, query: string) => Promise<Listing[]>;
  verify: typeof verifyMatches;
}

const defaultDeps: CompareDeps = {
  search: (site, query) => (site === "flipkart" ? searchFlipkart(query) : searchAmazon(query)),
  verify: verifyMatches,
};

/** Every intermediate step, so the recall eval can tell which stage lost a match. */
export interface CompareTrace {
  rounds: { query: string; results: Listing[]; shortlist: Listing[]; verdicts: MatchVerdictDto[] }[];
}

/**
 * Finds the product on the other site. Each round: search → rule pre-filter → AI verifier (titles only,
 * no prices) → rule veto on conflicting specs. "same" requires both the AI and the rules to agree;
 * anything uncertain is downgraded to "variant" or dropped. If the first query finds no "same", a second
 * query (from the manufacturer model when known) is tried on listings not checked yet.
 */
export async function compareProduct(
  product: Product,
  deps: CompareDeps = defaultDeps,
  trace?: CompareTrace
): Promise<Comparison> {
  const target = OTHER[product.site];
  try {
    const seen = new Set<string>();
    let checked = 0;
    let best: MatchResult | null = null;
    for (const query of searchQueries(product.title, product.brand, product.model)) {
      const results = (await deps.search(target, query)).filter((r) => !seen.has(r.id));
      results.forEach((r) => seen.add(r.id));
      checked += results.length;
      const shortlist = preFilter(product.title, product.brand, results, 6, product.model).map((s) => s.item);
      const round = { query, results, shortlist, verdicts: [] as MatchVerdictDto[] };
      trace?.rounds.push(round);
      if (shortlist.length === 0) continue;

      round.verdicts = await deps.verify(
        // The spec-table model goes in `variant` so the AI can compare model codes, not just names.
        { site: product.site, title: product.title, brand: product.brand, variant: product.model ? `Model: ${product.model}` : "" },
        shortlist.map((c) => ({ title: c.title, variant: c.variant, brand: c.brand }))
      );

      const ranked: MatchResult[] = [];
      shortlist.forEach((listing: Listing, i) => {
        const v = round.verdicts.find((x) => x.index === i);
        const text = `${listing.title} ${listing.variant}`;
        // A different model code from the same family (HL7756 vs HL7707) is a different product.
        if (!v || v.verdict === "different" || modelConflict(product.model, text)) return;
        const conflicts = specConflicts(product.title, text);
        ranked.push({
          listing,
          verdict: v.verdict === "same" && conflicts.length === 0 ? "same" : "variant",
          differences: [...new Set([...conflicts, ...v.differences])].slice(0, 3),
          reason: v.reason,
        });
      });
      // Shortlist order is the rule score, so the first "same" is also the closest listing.
      const same = ranked.find((r) => r.verdict === "same");
      if (same) return { status: "done", target, match: same, checked };
      best ??= ranked[0] ?? null;
    }
    return { status: "done", target, match: best, checked };
  } catch (err) {
    return { status: "error", target, message: err instanceof Error ? err.message : String(err) };
  }
}
