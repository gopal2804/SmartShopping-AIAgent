import { useState, type FormEvent } from "react";
import { priceInsight, type DealVerdict, type PriceInsight } from "../prices/insight";
import type { PriceHistory, WatchItem } from "../prices/model";

const VERDICT: Record<DealVerdict, { label: string; tone: string }> = {
  good_deal: { label: "Good time to buy", tone: "good" },
  typical: { label: "Typical price", tone: "neutral" },
  above_usual: { label: "Higher than usual", tone: "bad" },
  not_enough_data: { label: "Not enough history yet", tone: "neutral" },
};

const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const day = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function Sparkline({ history }: { history: PriceHistory }) {
  const pts = history.points.slice(-60);
  if (pts.length < 2) return null;
  const prices = pts.map((p) => p.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const t0 = pts[0].t;
  const tSpan = pts[pts.length - 1].t - t0 || 1;
  const coords = pts.map((p) => `${((p.t - t0) / tSpan) * 100},${30 - ((p.p - min) / span) * 26}`).join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Price history chart">
      <polyline points={coords} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function summaryLine(insight: PriceInsight, since: number): string {
  if (insight.verdict === "not_enough_data") {
    return `Tracking since ${day(since)} (${insight.points} reading${insight.points === 1 ? "" : "s"}). A verdict needs at least 3 readings over 3 days.`;
  }
  return `Lowest ${rupees(insight.lowest)} (${day(insight.lowestAt)}) · usual ${rupees(insight.median)} · highest ${rupees(insight.highest)} · ${insight.points} readings over ${insight.days} days`;
}

export function PriceCard({
  history,
  watching,
  onWatch,
  onUnwatch,
  onCheckNow,
  onReset,
}: {
  history: PriceHistory | null;
  watching: WatchItem | null;
  onWatch: (target: number | null) => Promise<void>;
  onUnwatch: () => Promise<void>;
  onCheckNow: () => Promise<string>;
  onReset: () => Promise<void>;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const insight = history ? priceInsight(history.points, Date.now()) : null;
  if (!history || !insight) {
    return <section className="card muted small">Price tracking starts once the price on this page is read.</section>;
  }
  const verdict = VERDICT[insight.verdict];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setNote("");
    try {
      const result = await action();
      if (typeof result === "string") setNote(result);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(target.replace(/[^\d.]/g, ""));
    void run(() => onWatch(target.trim() && n > 0 ? n : null));
  }

  return (
    <section className="card prices">
      <h3>Price tracker</h3>
      <span className={`trust-badge ${verdict.tone}`}>{verdict.label}</span>
      <Sparkline history={history} />
      <p className="small">{summaryLine(insight, history.points[0].t)}</p>
      {watching ? (
        <div className="watch-row">
          <span className="small">
            🔔 Watching{watching.target ? `: alert at ${rupees(watching.target)} or less` : ": alert on price drops"}
          </span>
          <button className="ghost" disabled={busy} onClick={() => run(onCheckNow)}>Check now</button>
          <button className="ghost" disabled={busy} onClick={() => run(onUnwatch)}>Stop</button>
        </div>
      ) : (
        <form className="watch-row" onSubmit={submit}>
          <input
            inputMode="numeric"
            placeholder={`Target ₹ (optional)`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Target price"
          />
          <button className="primary" type="submit" disabled={busy}>Watch price</button>
        </form>
      )}
      {note && <p className="muted small">{note}</p>}
      <div className="reset-row small">
        {confirmReset ? (
          <>
            <span>Delete all {history.points.length} readings for this product?</span>
            <button
              className="ghost danger"
              disabled={busy}
              onClick={() => run(async () => {
                await onReset();
                setConfirmReset(false);
                return "History reset. The current price is the first reading.";
              })}
            >
              Delete
            </button>
            <button className="ghost" disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</button>
          </>
        ) : (
          <button className="link" onClick={() => setConfirmReset(true)}>Reset history</button>
        )}
      </div>
      <p className="muted tiny">
        History is recorded in this browser only, from when you first viewed the product. Past prices before that aren't
        known, and future prices aren't predicted.
      </p>
    </section>
  );
}
