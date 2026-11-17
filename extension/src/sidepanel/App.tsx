import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { compareProduct } from "../compare";
import { dedupeReviews } from "../content/common";
import { priceInsight } from "../prices/insight";
import type { PriceHistory, WatchItem } from "../prices/model";
import { toNumber } from "../prices/parse";
import { getHistory, getWatchlist, recordPrice, unwatch, watch } from "../prices/store";
import { CHECK_PRICES_MESSAGE } from "../types";
import type { ChatMessage, Comparison, Product, ProductAnalysis, Review, Site, Theme, TrustReport } from "../types";
import {
  analyzeProduct,
  BACKEND_URL,
  checkTrust,
  getActiveProduct,
  getMoreReviews,
  streamChat,
  type ComparisonDto,
  type PriceInsightDto,
} from "./api";
import { PriceCard } from "./PriceCard";

const productRef = (p: Product) => ({ site: p.site, id: p.product_id || p.url, title: p.title, url: p.url });

function toPriceDto(history: PriceHistory | null, comparison: ComparisonDto | null): PriceInsightDto | null {
  const insight = history ? priceInsight(history.points, Date.now()) : null;
  if (!history || !insight) return null;
  return {
    site: history.site,
    verdict: insight.verdict,
    current: insight.current,
    lowest: insight.lowest,
    lowest_date: new Date(insight.lowestAt).toISOString().slice(0, 10),
    highest: insight.highest,
    usual: insight.median,
    readings: insight.points,
    days_tracked: insight.days,
    other_site_price: comparison?.verdict === "same" ? comparison.price : null,
  };
}

type TrustState = { key: string; status: "loading" } | { key: string; status: "done"; report: TrustReport } | {
  key: string;
  status: "error";
};

const TRUST_LEVEL: Record<TrustReport["level"], { label: string; tone: string }> = {
  insufficient: { label: "Not enough reviews to check", tone: "neutral" },
  no_concerns: { label: "No unusual patterns", tone: "good" },
  some_concerns: { label: "Some unusual patterns", tone: "warn" },
  notable_concerns: { label: "Notable unusual patterns", tone: "bad" },
};

const SITE_NAME: Record<Site, string> = { amazon: "Amazon.in", flipkart: "Flipkart" };
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function toComparisonDto(c: Comparison | null): ComparisonDto | null {
  if (c?.status !== "done" || !c.match) return null;
  const { listing, verdict, differences } = c.match;
  return {
    site: listing.site,
    verdict,
    title: listing.title,
    price: listing.price,
    rating: listing.rating,
    rating_count: listing.ratingCount,
    differences,
  };
}

interface ExtraData {
  reviews: Review[];
  ratingBreakdown: string;
}

interface ExtraReviews extends ExtraData {
  key: string;
  status: "idle" | "loading" | "done";
  pagesRead: number;
  blocked: "login" | null;
}

const NO_EXTRA: ExtraReviews = { key: "", status: "idle", reviews: [], ratingBreakdown: "", pagesRead: 0, blocked: null };

function mergeExtra(product: Product, extra: ExtraData): Product {
  return {
    ...product,
    rating_breakdown: product.rating_breakdown || extra.ratingBreakdown,
    reviews: extra.reviews.length ? dedupeReviews([...product.reviews, ...extra.reviews]) : product.reviews,
  };
}

type PageState =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "product"; product: Product };

const VERDICT_LABEL: Record<ProductAnalysis["verdict"], string> = {
  recommended: "Recommended",
  consider_alternatives: "Consider alternatives",
  avoid: "Avoid",
};

function backendError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Failed to fetch" ? `Cannot reach the backend at ${BACKEND_URL}. Is it running?` : msg;
}

export default function App() {
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const [analysis, setAnalysis] = useState<ProductAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [extra, setExtra] = useState<ExtraReviews>(NO_EXTRA);
  const [comparison, setComparison] = useState<{ key: string; value: Comparison } | null>(null);
  const [trust, setTrust] = useState<TrustState | null>(null);
  const [prices, setPrices] = useState<{ key: string; history: PriceHistory | null; watching: WatchItem | null } | null>(
    null
  );
  const productKey = useRef("");
  const moreReviewsRequest = useRef<{ key: string; promise: Promise<ExtraData> } | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const scan = useCallback(async () => {
    try {
      const res = await getActiveProduct();
      if (!res.ok) {
        setPage(res.reason.startsWith("extract_failed") ? { kind: "error", message: res.reason } : { kind: "unsupported" });
        productKey.current = "";
        return;
      }
      const key = `${res.product.site}:${res.product.product_id || res.product.url}`;
      if (key !== productKey.current) {
        productKey.current = key;
        setAnalysis(null);
        setAnalysisError("");
        setMessages([]);
        setExtra({ ...NO_EXTRA, key });
        setComparison(null);
        setTrust(null);
        setPrices(null);
        moreReviewsRequest.current = null;
      }
      setPage({ kind: "product", product: res.product });
    } catch (err) {
      setPage({ kind: "error", message: String(err) });
    }
  }, []);

  useEffect(() => {
    scan();
    const onActivated = () => scan();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && info.status === "complete") scan();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [scan]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const pageProduct = page.kind === "product" ? page.product : null;
  const product = useMemo(
    () => (pageProduct && extra.key === productKey.current ? mergeExtra(pageProduct, extra) : pageProduct),
    [pageProduct, extra]
  );

  // Fetches extra review pages once per product; concurrent callers share the same request.
  async function withMoreReviews(): Promise<Product | null> {
    if (!pageProduct) return null;
    const key = productKey.current;
    if (moreReviewsRequest.current?.key !== key) {
      setExtra((prev) => ({ ...prev, key, status: "loading" }));
      const promise = getMoreReviews()
        .then((res): ExtraData => {
          const data = res.ok
            ? { reviews: res.reviews, ratingBreakdown: res.ratingBreakdown }
            : { reviews: [], ratingBreakdown: "" };
          // Retry next time if blocked: the user may sign in meanwhile.
          if (res.ok && res.blocked && moreReviewsRequest.current?.key === key) moreReviewsRequest.current = null;
          if (productKey.current === key) {
            setExtra({
              key,
              status: "done",
              ...data,
              pagesRead: res.ok ? res.pagesRead : 0,
              blocked: res.ok ? res.blocked : null,
            });
          }
          return data;
        })
        .catch((): ExtraData => {
          setExtra((prev) => (prev.key === key ? { ...prev, status: "done" } : prev));
          return { reviews: [], ratingBreakdown: "" };
        });
      moreReviewsRequest.current = { key, promise };
    }
    return mergeExtra(pageProduct, await moreReviewsRequest.current.promise);
  }

  // Start reading review pages as soon as a product is detected, so the first answer doesn't wait on it.
  useEffect(() => {
    if (pageProduct && extra.key === productKey.current && extra.status === "idle") void withMoreReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageProduct, extra.key, extra.status]);

  // Look for the same product on the other site once per product.
  useEffect(() => {
    const key = productKey.current;
    if (!pageProduct || !key || comparison?.key === key) return;
    setComparison({ key, value: { status: "searching", target: pageProduct.site === "amazon" ? "flipkart" : "amazon" } });
    compareProduct(pageProduct).then((value) => {
      if (productKey.current === key) setComparison({ key, value });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageProduct, comparison?.key]);

  // Check review patterns once the background review pages have loaded (it needs the full sample).
  useEffect(() => {
    const key = productKey.current;
    if (!product || extra.key !== key || extra.status !== "done" || trust?.key === key) return;
    setTrust({ key, status: "loading" });
    checkTrust(product)
      .then((report) => productKey.current === key && setTrust({ key, status: "done", report }))
      .catch(() => productKey.current === key && setTrust({ key, status: "error" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, extra.status, extra.key, trust?.key]);

  // Same product → scan() keeps its state, so a manual rescan forgets the product to force a full refresh.
  const loadPrices = useCallback(async (p: Product, key: string) => {
    const ref = productRef(p);
    const [history, list] = await Promise.all([getHistory(ref.site, ref.id), getWatchlist()]);
    const watching = list.find((w) => w.site === ref.site && w.id === ref.id) ?? null;
    if (productKey.current === key) setPrices({ key, history, watching });
  }, []);

  // Every product view adds a price reading (deduped within 6 hours), so history builds up passively.
  useEffect(() => {
    const key = productKey.current;
    if (!pageProduct || !key || prices?.key === key) return;
    const price = toNumber(pageProduct.price);
    (price !== null ? recordPrice(productRef(pageProduct), price) : Promise.resolve())
      .then(() => loadPrices(pageProduct, key))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageProduct, prices?.key]);

  // A confirmed same-product match on the other site gets a reading too, building cross-site history.
  useEffect(() => {
    const c = comparison?.value;
    if (c?.status !== "done" || c.match?.verdict !== "same" || c.match.listing.price === null) return;
    const { site, id, title, url, price } = c.match.listing;
    void recordPrice({ site, id, title, url }, price).catch(() => undefined);
  }, [comparison]);

  async function startWatching(target: number | null) {
    if (!pageProduct) return;
    await watch({ ...productRef(pageProduct), target });
    await loadPrices(pageProduct, productKey.current);
  }

  async function stopWatching() {
    if (!pageProduct) return;
    const ref = productRef(pageProduct);
    await unwatch(ref.site, ref.id);
    await loadPrices(pageProduct, productKey.current);
  }

  async function checkWatchedNow(): Promise<string> {
    const res = await chrome.runtime.sendMessage({ type: CHECK_PRICES_MESSAGE });
    if (pageProduct) await loadPrices(pageProduct, productKey.current);
    return `Checked ${res?.checked ?? 0} watched product${res?.checked === 1 ? "" : "s"}; ${res?.alerts ?? 0} alert${res?.alerts === 1 ? "" : "s"} sent.`;
  }

  function rescan() {
    productKey.current = "";
    moreReviewsRequest.current = null;
    setComparison(null);
    setTrust(null);
    setPrices(null);
    setPage({ kind: "loading" });
    scan();
  }

  async function runAnalysis() {
    if (!product) return;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const full = (await withMoreReviews()) ?? product;
      setAnalysis(await analyzeProduct(full));
    } catch (err) {
      setAnalysisError(backendError(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!product || !text || streaming) return;
    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const append = (chunk: string) =>
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
      });
    try {
      const full = (await withMoreReviews()) ?? product;
      await streamChat(
        {
          product: full,
          analysis,
          comparison: toComparisonDto(comparison?.value ?? null),
          trust: trust?.status === "done" && trust.key === productKey.current ? trust.report : null,
          price_history: toPriceDto(
            prices?.key === productKey.current ? prices.history : null,
            toComparisonDto(comparison?.value ?? null)
          ),
          messages: history,
        },
        append
      );
    } catch (err) {
      append(`[Error: ${backendError(err)}]`);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Smart Shopping Agent</h1>
        <button className="ghost" onClick={rescan} disabled={page.kind === "loading"} title="Re-read the page and reviews">
          Rescan
        </button>
      </header>

      {page.kind === "loading" && <p className="muted">Reading the page…</p>}
      {page.kind === "unsupported" && (
        <div className="card empty">
          <p>Open a product page on <b>Amazon.in</b> or <b>Flipkart</b> to get started.</p>
        </div>
      )}
      {page.kind === "error" && <div className="card error">Could not read this page: {page.message}</div>}

      {product && (
        <>
          <section className="card">
            <div className="site-tag">{product.site === "amazon" ? "Amazon.in" : "Flipkart"}</div>
            <h2 className="product-title">{product.title || "Untitled product"}</h2>
            <div className="meta">
              {product.price && <span className="price">{product.price}</span>}
              {product.rating != null && <span>★ {product.rating}</span>}
              {product.rating_count && <span className="muted">{product.rating_count}</span>}
            </div>
            <p className="muted small">
              {extra.status === "loading"
                ? `Reading more reviews… (${product.reviews.length} so far)`
                : extra.status === "done"
                  ? `${product.reviews.length} reviews read (this page + ${extra.pagesRead} review pages)`
                  : `${product.reviews.length} reviews on this page`}
            </p>
            {extra.blocked === "login" && (
              <p className="hint small">
                Amazon shows its full review list only to signed-in users. Sign in to Amazon in this browser, then ask
                again to include up to ~200 reviews.
              </p>
            )}
            {!analysis && (
              <button className="primary" onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? (extra.status === "loading" ? "Reading reviews…" : "Analyzing reviews…") : "Analyze reviews"}
              </button>
            )}
            {analysisError && <p className="error-text">{analysisError}</p>}
          </section>

          {comparison && comparison.key === productKey.current && (
            <CompareCard comparison={comparison.value} sourcePrice={toNumber(product.price)} sourceSite={product.site} />
          )}

          {prices && prices.key === productKey.current && (
            <PriceCard
              history={prices.history}
              watching={prices.watching}
              onWatch={startWatching}
              onUnwatch={stopWatching}
              onCheckNow={checkWatchedNow}
            />
          )}

          {trust && trust.key === productKey.current && <TrustCard trust={trust} />}

          {analysis && <AnalysisView analysis={analysis} />}

          <section className="card chat">
            <h3>Ask about this product</h3>
            <div className="messages">
              {messages.length === 0 && (
                <p className="muted small">Try: “Is the battery life good?” or “Any complaints about delivery or quality?”</p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form className="composer" onSubmit={sendMessage}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                disabled={streaming}
              />
              <button className="primary" type="submit" disabled={streaming || !input.trim()}>
                Send
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

function CompareCard({
  comparison,
  sourcePrice,
  sourceSite,
}: {
  comparison: Comparison;
  sourcePrice: number | null;
  sourceSite: Site;
}) {
  const other = SITE_NAME[comparison.target];
  if (comparison.status === "searching") {
    return <section className="card compare muted small">Checking {other} for the same product…</section>;
  }
  if (comparison.status === "error") {
    return <section className="card compare muted small">Couldn't check {other} right now.</section>;
  }
  if (!comparison.match) {
    return (
      <section className="card compare">
        <h3>On {other}</h3>
        <p className="muted small">
          No matching listing found{comparison.checked ? ` among ${comparison.checked} search results` : ""}.
        </p>
      </section>
    );
  }

  const { listing, verdict, differences } = comparison.match;
  const diff = listing.price != null && sourcePrice != null ? listing.price - sourcePrice : null;
  const here = SITE_NAME[sourceSite];
  return (
    <section className="card compare">
      <h3>On {other}</h3>
      <span className={`match-badge ${verdict}`}>{verdict === "same" ? "Same product" : "Similar listing: check the variant"}</span>
      <div className="meta">
        {listing.price != null && <span className="price">{rupees(listing.price)}</span>}
        {listing.rating != null && <span>★ {listing.rating}</span>}
        {listing.ratingCount != null && (
          <span className="muted">({listing.ratingCount.toLocaleString("en-IN")} ratings)</span>
        )}
      </div>
      {verdict === "same" && diff != null && (
        <p className={`price-diff ${diff < 0 ? "cheaper" : diff > 0 ? "pricier" : ""}`}>
          {diff === 0
            ? `Same price as ${here}`
            : diff < 0
              ? `${rupees(-diff)} cheaper on ${other}`
              : `${rupees(diff)} cheaper here on ${here}`}
        </p>
      )}
      {differences.length > 0 && <p className="small">Differs: {differences.join(" · ")}</p>}
      <p className="muted small listing-title">{listing.title}{listing.variant ? ` (${listing.variant})` : ""}</p>
      <a className="open-link" href={listing.url} target="_blank" rel="noopener noreferrer">
        Open on {other} ↗
      </a>
      <p className="muted tiny">Listed prices only; coupons, bank offers and sellers may differ.</p>
    </section>
  );
}

function TrustCard({ trust }: { trust: TrustState }) {
  if (trust.status === "loading") return <section className="card muted small">Checking review patterns…</section>;
  if (trust.status === "error") return <section className="card muted small">Couldn't check review patterns right now.</section>;
  const { report } = trust;
  const level = TRUST_LEVEL[report.level];
  return (
    <section className="card trust">
      <h3>Review trust</h3>
      <span className={`trust-badge ${level.tone}`}>{level.label}</span>
      <p>{report.summary}</p>
      {report.signals.map((s) => (
        <div key={s.id} className={`signal ${s.severity}`}>
          <b>{s.title}</b>
          <p className="small">{s.detail}</p>
          {s.examples.length > 0 && (
            <details>
              <summary className="small">See examples</summary>
              {s.examples.map((ex, i) => (
                <blockquote key={i} className="small">{ex}</blockquote>
              ))}
            </details>
          )}
        </div>
      ))}
      {report.checks.length > 0 && (
        <ul className="checks small">
          {report.checks
            .filter((c) => c.status !== "flagged")
            .map((c) => (
              <li key={c.id} className={c.status}>
                {c.status === "passed" ? "✓" : "–"} {c.note}
              </li>
            ))}
        </ul>
      )}
      <p className="muted tiny">
        Based on {report.reviews_checked} reviews read. Patterns are signals, not proof that reviews are fake.
      </p>
    </section>
  );
}

function ThemeList({ items, kind }: { items: Theme[]; kind: "pro" | "con" }) {
  if (items.length === 0) return <p className="muted small">None mentioned.</p>;
  return (
    <ul className={`themes ${kind}`}>
      {items.map((t, i) => (
        <li key={i}>
          <span>{t.point}</span>
          <span className="freq">{t.frequency}</span>
        </li>
      ))}
    </ul>
  );
}

function AnalysisView({ analysis }: { analysis: ProductAnalysis }) {
  return (
    <section className="card">
      <div className={`verdict ${analysis.verdict}`}>{VERDICT_LABEL[analysis.verdict]}</div>
      <p className="small">{analysis.verdict_reason}</p>
      <p>{analysis.summary}</p>
      <h3>Pros</h3>
      <ThemeList items={analysis.pros} kind="pro" />
      <h3>Cons</h3>
      <ThemeList items={analysis.cons} kind="con" />
      {analysis.best_for.length > 0 && (
        <>
          <h3>Best for</h3>
          <div className="chips">
            {analysis.best_for.map((b, i) => (
              <span key={i} className="chip">{b}</span>
            ))}
          </div>
        </>
      )}
      <div className="confidence">
        <span className={`conf-badge ${analysis.confidence}`}>{analysis.confidence} confidence</span>
        <p className="muted small">{analysis.confidence_reason}</p>
      </div>
    </section>
  );
}
