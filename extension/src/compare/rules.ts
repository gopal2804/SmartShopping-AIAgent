// Deterministic matching rules. They run before and after the AI verifier:
// before, to keep only plausible candidates; after, to veto "same" when hard specs conflict.

const STOPWORDS = new Set(
  "a an and the for with of in on to by from at as or is new latest launch edition version pack set combo".split(" ")
);

// Units whose values distinguish variants (storage, capacity, size, pack count…).
const SPEC_UNITS = ["tb", "gb", "mah", "ml", "l", "kg", "g", "w", "inch", "cm", "mm", "ton", "pcs"];
const SPEC_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s?(${SPEC_UNITS.join("|")})\\b`, "gi");

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Tokens that look like model identifiers: "219", "ce6", "wh1000xm5", "s24". Specs and years excluded. */
export function modelTokens(title: string): Set<string> {
  const specs = new Set(Array.from(normalize(title).matchAll(SPEC_RE), (m) => normalize(m[0]).replace(/\s/g, "")));
  return new Set(
    tokens(title).filter(
      (t) => /\d/.test(t) && !/^20\d\d$/.test(t) && !specs.has(t) && !/^\d+(h|hrs?|hz|x|mp|k|p)$/.test(t)
    )
  );
}

/** Variant-defining specs keyed by unit, e.g. { gb: ["8", "128"], ml: ["500"] }. */
export function specs(title: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of normalize(title).matchAll(SPEC_RE)) {
    const unit = m[2].toLowerCase();
    if (!out.has(unit)) out.set(unit, new Set());
    out.get(unit)!.add(String(Number(m[1])));
  }
  return out;
}

/** Specs present on both sides with different values ⇒ cannot be the exact same listing. */
export function specConflicts(a: string, b: string): string[] {
  const sa = specs(a);
  const sb = specs(b);
  const conflicts: string[] = [];
  for (const [unit, va] of sa) {
    const vb = sb.get(unit);
    if (vb && ![...va].every((v) => vb.has(v)) && ![...vb].every((v) => va.has(v))) {
      conflicts.push(`${[...va].join("/")} ${unit} vs ${[...vb].join("/")} ${unit}`);
    }
  }
  return conflicts;
}

function brandOf(title: string, brand: string): string {
  return normalize(brand || title.split(/\s+/)[0] || "");
}

export function brandMatches(sourceBrand: string, sourceTitle: string, candidateText: string): boolean {
  const brand = brandOf(sourceTitle, sourceBrand);
  if (!brand) return false;
  const hay = ` ${normalize(candidateText)} `;
  return brand.split(" ").every((part) => hay.includes(` ${part} `));
}

/** Short search query: the title before the first separator, plus storage/RAM-style specs. */
export function buildQuery(title: string, brand: string): string {
  const head = title.split(/\s*(?:[,|(\[–:]|\s-\s)\s*/)[0];
  const words = head.split(/\s+/).filter(Boolean).slice(0, 8);
  while (words.length > 2 && STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  let query = words.join(" ");
  if (brand && !normalize(query).includes(normalize(brand))) query = `${brand} ${query}`;
  for (const m of title.matchAll(/\b\d+\s?(GB|TB)\b/gi)) {
    if (!normalize(query).includes(normalize(m[0]).replace(/\s/g, ""))) query += ` ${m[0].replace(/\s/g, "")}`;
  }
  return query.trim();
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Keeps candidates with the same brand and overlapping model identifiers, best first. */
export function preFilter<T extends { title: string; variant: string; brand: string }>(
  sourceTitle: string,
  sourceBrand: string,
  candidates: T[],
  limit = 5
): Scored<T>[] {
  const srcTokens = new Set(tokens(sourceTitle));
  const srcModels = modelTokens(sourceTitle);
  return candidates
    .filter((c) => brandMatches(sourceBrand, sourceTitle, `${c.brand} ${c.title}`))
    .map((c) => {
      const text = `${c.title} ${c.variant}`;
      const candTokens = new Set(tokens(text));
      const candModels = modelTokens(text);
      const shared = [...srcTokens].filter((t) => candTokens.has(t)).length;
      const jaccard = shared / (srcTokens.size + candTokens.size - shared || 1);
      const modelHits = [...srcModels].filter((t) => candModels.has(t) || candTokens.has(t)).length;
      return { item: c, score: jaccard + modelHits, modelHits };
    })
    .filter((s) => srcModels.size === 0 || s.modelHits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}
