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

/** "111W" and "111 W" are the same spec; split a number from its unit so both sides tokenize alike. */
const JOINED_SPEC_RE = new RegExp(`(\\d)(${SPEC_UNITS.join("|")})\\b`, "g");

export function tokens(s: string): string[] {
  return normalize(s)
    .replace(JOINED_SPEC_RE, "$1 $2")
    .split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Tokens that look like model identifiers: "219", "ce6", "wh1000xm5", "s24". Years and the numbers of
 * specs ("111" in "111 W", "1000" in "1000 ml") are excluded.
 */
export function modelTokens(title: string): Set<string> {
  const specNumbers = new Set(Array.from(normalize(title).matchAll(SPEC_RE), (m) => m[1]));
  return new Set(
    tokens(title).filter(
      (t) => /\d/.test(t) && !/^20\d\d$/.test(t) && !specNumbers.has(t) && !/^\d+(h|hrs?|hz|x|mp|k|p)$/.test(t)
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

/** Letters and digits only, so "WH-1000XM5", "WH 1000XM5" and "wh1000xm5" compare equal. */
export function compact(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

/**
 * The comparable part of a manufacturer model: "WH1000XM5/LMIN" -> "wh1000xm5", "PIC 20" -> "pic20".
 * Needs a digit and 4+ characters; names like "XM Series" are too vague to use.
 */
export function modelCode(model: string | undefined): string {
  // Spec tables sometimes put a description after the code: "HD9252/90 with Touch Panel, …".
  const head = normalize((model ?? "").split(/[/,|(]|\swith\s/i)[0]);
  const words = head.split(" ").filter(Boolean);
  // A short value is the code itself ("PIC 20", "WH 1000XM5"); in a longer one, take the word with digits.
  const code = words.length <= 2 ? compact(head) : compact(words.find((w) => /[a-z]/.test(w) && /\d/.test(w)) ?? "");
  return code.length >= 4 && /\d/.test(code) ? code : "";
}

/**
 * True when the candidate names a different code from the same model family as the source's known model,
 * e.g. source "HL7756/01" and candidate "… HL7707/01 …", or "WH1000XM5" vs "WH-1000XM6". Such a pair can
 * never be the "same" product, whatever the AI says.
 */
export function modelConflict(sourceModel: string | undefined, candidateText: string): boolean {
  const code = modelCode(sourceModel);
  const prefix = code.match(/^[a-z]{2,}/)?.[0];
  if (!code || !prefix) return false;
  const found = Array.from(
    normalize(candidateText).matchAll(new RegExp(`\\b${prefix}\\s?(\\d[a-z0-9]*)`, "g")),
    (m) => prefix + m[1]
  );
  return found.length > 0 && !found.some((c) => c.startsWith(code) || code.startsWith(c));
}

// The stores sometimes name the same brand differently (Flipkart "Mi", Amazon "Xiaomi").
// Each group lists names that count as one brand. Keep it to true aliases, not sub-brands.
const BRAND_ALIASES: string[][] = [["xiaomi", "mi"]];

/**
 * Every name that counts as this brand. Stores write some brands as "X by Y"
 * ("Mijia by Xiaomi", "PHILIPS by Phlips", "BAJAJ by Bajaj"), so each side of "by" counts too.
 */
function brandNames(brand: string): string[] {
  const parts = brand.split(/\s+by\s+/).filter(Boolean);
  const names = new Set([brand, ...parts]);
  for (const part of parts) {
    const group = BRAND_ALIASES.find((g) => g.some((name) => part.split(" ").includes(name)));
    group?.forEach((name) => names.add(name));
  }
  return [...names];
}

export function brandMatches(sourceBrand: string, sourceTitle: string, candidateText: string): boolean {
  const brand = brandOf(sourceTitle, sourceBrand);
  if (!brand) return false;
  const hay = ` ${normalize(candidateText)} `;
  return brandNames(brand).some((name) => name.split(" ").every((part) => hay.includes(` ${part} `)));
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

// When no candidate shares a model identifier, the closest few still go to the AI check if they share
// enough words. The AI and the spec veto guard against a wrong "same", so this only adds recall.
const SOFT_LIMIT = 3;
const SOFT_MIN_SIMILARITY = 0.5;

/**
 * Keeps candidates with the same brand and overlapping model identifiers, best first. `model` is the
 * source's manufacturer model from its spec table; a candidate whose title contains it ranks first.
 */
export function preFilter<T extends { title: string; variant: string; brand: string }>(
  sourceTitle: string,
  sourceBrand: string,
  candidates: T[],
  limit = 6,
  model = ""
): Scored<T>[] {
  const srcTokens = new Set(tokens(sourceTitle));
  const srcModels = modelTokens(sourceTitle);
  const code = modelCode(model);
  const scored = candidates
    .filter((c) => brandMatches(sourceBrand, sourceTitle, `${c.brand} ${c.title}`))
    .map((c) => {
      const text = `${c.title} ${c.variant}`;
      // Amazon search cards often show the brand apart from the title.
      const candTokens = new Set(tokens(`${c.brand} ${text}`));
      const candModels = modelTokens(text);
      const candCompact = compact(text);
      // Share of the source's words the candidate has; long candidate titles aren't penalised for extra words.
      const coverage = [...srcTokens].filter((t) => candTokens.has(t)).length / (srcTokens.size || 1);
      // A listing with a different capacity, size or model code is at best a variant: rank it lower.
      const mismatch = specConflicts(sourceTitle, text).length > 0 || modelConflict(model, text);
      // Long identifiers also match across spacing and hyphens ("WH-1000XM5" vs "WH1000XM5").
      const modelHits = [...srcModels].filter(
        (t) => candModels.has(t) || candTokens.has(t) || (t.length >= 4 && candCompact.includes(compact(t)))
      ).length;
      const codeHit = code !== "" && candCompact.includes(code);
      const score = coverage + modelHits + (codeHit ? 2 : 0) - (mismatch ? 1 : 0);
      return { item: c, score, coverage, strict: codeHit || modelHits > 0 };
    })
    .sort((a, b) => b.score - a.score);
  const strict = scored.filter((s) => srcModels.size === 0 || s.strict);
  const kept = strict.length
    ? strict.slice(0, limit)
    : scored.filter((s) => s.coverage >= SOFT_MIN_SIMILARITY).slice(0, SOFT_LIMIT);
  return kept.map(({ item, score }) => ({ item, score }));
}

/**
 * Search queries to try, best first: the title-based query, then one built from the manufacturer model
 * (or a shorter title query when there is none). Duplicates are dropped.
 */
export function searchQueries(title: string, brand: string, model = ""): string[] {
  const primary = buildQuery(title, brand);
  const brandWord = (brand || title.split(/\s+/)[0] || "").split(/\s+by\s+/i)[0];
  const modelPart = model.split(/[/,|(]|\swith\s/i)[0].trim();
  const second = modelCode(model)
    ? `${brandWord} ${modelPart}`
    : primary.split(/\s+/).slice(0, 5).join(" ");
  return [...new Set([primary, second.trim()].filter(Boolean))];
}
