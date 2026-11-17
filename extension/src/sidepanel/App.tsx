import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { dedupeReviews } from "../content/common";
import type { ChatMessage, Product, ProductAnalysis, Review, Theme } from "../types";
import { analyzeProduct, BACKEND_URL, getActiveProduct, getMoreReviews, streamChat } from "./api";

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

  // Same product → scan() keeps its state, so a manual rescan forgets the product to force a full refresh.
  function rescan() {
    productKey.current = "";
    moreReviewsRequest.current = null;
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
      await streamChat({ product: full, analysis, messages: history }, append);
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
