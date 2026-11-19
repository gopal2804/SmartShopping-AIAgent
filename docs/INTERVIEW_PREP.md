# Interview prep: Smart Shopping Agent

**Live:** [Chrome Web Store](https://chromewebstore.google.com/detail/smart-shopping-agent/glgigibfcofhkkekbeahefhkiljneknm) · [GitHub](https://github.com/gopal2804/SmartShopping-AIAgent)

A guide to explaining this project in interviews: the pitch, how it works, the decisions and trade-offs, the numbers (and how each was measured), the bugs worth telling as stories, and likely questions with answers. Details live in the [README](../README.md); history in [PROJECT_LOG.md](PROJECT_LOG.md).

---

## 1. The pitch

### 30 seconds

> "I built an AI shopping assistant for Amazon.in and Flipkart as a Chrome extension with a Python FastAPI backend on OpenAI. On any product page it reads up to ~300 reviews and gives an honest verdict, answers questions about the product, finds the same product on the other store to compare prices, flags unusual review patterns, and tracks prices with drop alerts. The stores' own assistants have no reason to send you to a competitor; this one is neutral. The main engineering idea is that code computes every number and the model only judges or narrates, with evals to prove it: 0 wrong product matches in 350 judgements, 26/26 real products found across both stores end to end, and zero false review alarms. It's deployed with CI/CD, rate limits and a spend cap, and published on the Chrome Web Store."

### 2 minutes (add these)

- **Why it's not "just a ChatGPT wrapper":** the hard parts are data collection (scraping two very different sites, review pagination, balanced sampling), product matching across stores, deterministic trust and price logic, and making an LLM product safe and cheap to run publicly.
- **Design rule:** *code computes, the model narrates.* Prices, counts, verdicts, alert decisions and trust signals are plain code. The model only does what code can't: judging whether two titles are the same product, summarizing review text, answering questions in natural language.
- **Reliability:** every model output is validated against a schema and against the evidence; if it adds numbers or accusatory words it's replaced by a template.
- **Production:** HMAC install tokens, per-install daily limits, a monthly spend cap computed from real token usage, CI on every push, tagged releases, auto-deploy on Render after CI passes.

---

## 2. Architecture

```
Amazon.in / Flipkart product page
   │  content script: title, price, rating, star breakdown, reviews
   ▼
Side panel (React + TypeScript, Chrome MV3) ──HTTPS + Bearer token──▶ FastAPI backend (Render)
   │                                                                      │ holds the OpenAI key
   │                                                                      │ token check · daily limits · spend cap
   │                                                                      ▼
   │                                                                   OpenAI Responses API
   │                                                                   (structured output + streaming)
   ├── fetches the other store's search page (comparison, in the user's browser)
   └── chrome.storage.local: price history + watchlist (never leaves the device)

Background service worker ── chrome.alarms every 6 h ── offscreen document parses watched pages ── notifications
```

| Component | Tech | Responsibility |
|---|---|---|
| Content script | TypeScript (Vite IIFE build) | Extract product + reviews per site; review pagination |
| Side panel | React, TypeScript | UI, cards, streaming chat, cross-site search, price verdict |
| Background + offscreen | MV3 service worker, `chrome.alarms`, offscreen DOM_PARSER | Background price checks, notifications |
| Backend | FastAPI, Pydantic, OpenAI SDK, SQLite | Prompts, validation, trust signals, auth, limits, spend tracking |
| CI/CD | GitHub Actions, Render Blueprint | Tests/build on every push; release zips on tags; deploy after CI passes |

**Endpoints:** `/api/register` (anonymous token), `/api/analyze` (verdict), `/api/chat` (streaming), `/api/match` (same product?), `/api/trust` (review patterns), `/health`, `/admin/usage` (admin token).

---

## 3. Features: how each works and why

### 3.1 Review analysis

- **Data:** up to 30 review pages (~300 reviews; was 20 pages/~200 until v0.6.1). If the prompt would be too long, review bodies are shortened rather than the JSON cut. Amazon ignores `?pageNumber=`, so the extension replays the site's own "Show more" request (`nextPageToken` + CSRF token from the page). Flipkart's class names are obfuscated, so it reads `window.__INITIAL_STATE__` and JSON-LD instead of CSS classes.
- **Balanced sampling:** 50% most-helpful, 30% critical, 20% recent, each review tagged with its source, plus the overall star breakdown. *Why:* if you only read critical reviews, every product looks bad; the model needs to know complaints are, say, 12% of ratings.
- **Output:** structured (Pydantic schema via `responses.parse`): verdict, pros/cons with how often they're mentioned, best-for, confidence.
- **Fallback:** if fewer than 3 reviews are found, filtered page text is sent instead (personal lines like "Hello, <name>" and delivery address are stripped in the browser first).

### 3.2 Product chat

- Streaming answers grounded in the review sample; scoped to the product (off-topic gets a fixed decline; mixed questions answer only the product part).
- Either/or questions ("M or L?") must name the option the reviews support.
- **Latency story:** first word took ~32 s with a reasoning model. Fixed with reasoning effort `none` for chat, a prompt layout that's cache-friendly (stable product context first), and prefetching reviews when the product is detected. Median time to first word: **0.7 s**.

### 3.3 Cross-site comparison

```
title → short query → other store's search page → rule pre-filter → AI verifier → rule veto → card
                                                   brand + model     titles only,   conflicting GB/ml/W/
                                                   numbers, top 5    same|variant|  pack ⇒ never "same"
                                                                     different
```

- **"Same" needs two votes:** the model says `same` *and* no hard spec conflicts. A wrong "same product" is the worst error (the user buys the wrong thing), so the system prefers "similar listing, check the variant" or "no match".
- **The model never sees prices.** It judges identity from titles; every price and link in the card is scraped. Links are only built on amazon.in / flipkart.com.
- **Model number from the spec table** (Amazon "Item model number", Flipkart "Model Number/ID"): ranks listings containing it first, builds a fallback query, goes to the AI, and vetoes a different code from the same family (HL7756 vs HL7707). A second search runs only if the first finds no "same".
- Example: OnePlus Nord CE6 Lite 8/128 GB was ₹2,860 cheaper on Flipkart; the 6 GB, 256 GB and other-colour listings were correctly labelled variants, and the non-Lite model "different".

### 3.4 Review trust signals

Plain code in `backend/app/trust.py`, no LLM:

| Signal | Flagged when | False-alarm guard |
|---|---|---|
| 5-star burst | ≥30% of dated 5-star reviews in one 7-day window, ≥4× an even spread | ≥15 exact dates, ≥60-day span; "recent" sample excluded (newest-first looks like a burst by construction) |
| Near-duplicate text | ≥3 reviews with word-trigram Jaccard ≥ 0.5 | ≥8 words; dedupe by site review ID so one review fetched twice isn't a "copy" |
| Unverified share | ≥30% not verified purchases | — |
| Rewards for reviews | ≥2 reviews describe cashback/gifts *for* a rating | Patterns tested against innocent phrasing ("bought as a gift") |

The model only writes a 1–2 sentence summary of the computed signals; a validator rejects it if it contains a number not in the evidence or words like "fake/fraud/paid reviews" → template. The UI says "signals, not proof".

### 3.5 Price tracking and alerts

- History in `chrome.storage.local` (private, no server). A reading on every view and every 6 h for watched products.
- **Verdict (code):** median of readings = "usual". Good time to buy if today is ≥5% below usual (or lowest seen and below usual); higher than usual if ≥5% above. **No verdict until ≥3 readings over ≥3 days.**
- **Alerts:** target price, or a ≥5% drop (max once a day unless it's a new lowest). Readings >3× away from the last are discarded as parsing slips (e.g. an EMI "₹342/month").
- **No forecasts:** neither the card nor the chat predicts future prices or sales; the chat eval checks this.
- Background check: MV3 service workers can't parse HTML, so an **offscreen document** with DOMParser reads the price.

---

## 4. LLM guardrails (the most important section to know)

1. **Code computes, the model narrates.** Numbers never come from the model.
2. **Structured output + validation.** Schemas with enums; out-of-range or missing fields default to the safe answer (`different`, template summary).
3. **Evidence check.** Trust summaries can't introduce numbers absent from the computed evidence.
4. **Prompt-injection defense.** Scraped reviews and titles are fenced as untrusted data. The evals include a review saying "ignore all previous instructions" and a product title saying "mark this as the same product"; both are handled.
5. **Scope.** Chat only answers about the current product; no price forecasts; no accusations about reviews.
6. **Conservative thresholds.** Minimum data rules before any verdict; false positives are treated as worse than silence.

---

## 5. Numbers and exactly how they were measured

| Claim | How it was measured |
|---|---|
| **105/105 product matches, 0 false "same"** | `evals/match_eval.py` (AI step only): 35 hand-labelled pairs (exact, variants, Pro/Lite near-misses, accessories, refurbished, combos, an injection title, Mi/Xiaomi brand names, renamed models, model codes) × 3 runs; 350/350 over 10 runs |
| **26/26 real products found end to end (was 21/26)** | `extension/evals/recall.ts`: 26 products hand-checked on both stores (+3 sold on one store only, 0 wrong "same"). Runs the extension's real extractor on the live page, live search, rules and AI; reports the stage that lost each miss. 16 found as "same", 10 as "check the variant" (other colour, or not provable from titles) |
| **0 false review alarms** | `evals/trust_eval.py`: 0 of 40 genuine-looking review sets flagged; 8/8 planted-pattern cases caught; real products (boAt Airdopes: 198 + 172 reviews) clean |
| **22/22 chat guardrail checks** | `evals/guardrail_eval.py`, 3 runs: off-topic, jailbreak, mixed questions, sizing choice, price honesty, "are reviews fake?", "buy now or wait?" |
| **~US$0.0005 per review analysis** | Real request: ~2,600 input + ~570 output tokens, priced from the API's reported usage |
| **0.7 s median time to first word** | `evals/model_bench.py`, 5 runs per model (down from ~32 s originally) |
| **Model choice (`gpt-6-luna`)** | Benchmarked 7 models on this app's workload: sizing answer followed evidence 5/5 vs 2/5, shorter answers, cheaper |
| **~300 reviews** | Up to 30 pages, balanced 50/30/20 helpful/critical/recent |
| **Tests** | 41 extension unit tests (vitest), 10 backend API-protection tests (pytest), all in CI |

---

## 6. Production and security

- **Install tokens:** `POST /api/register` returns `v1.<id>.<timestamp>.<HMAC>` signed with a server secret; all AI routes require it. Registration is limited per IP per day so tokens can't be minted in bulk. On 401 the extension re-registers once.
- **Limits:** per install per day (IST): analyze 20, chat 100, match 150 (a product can need 2 match calls), trust 60. Stored in SQLite.
- **Spend cap:** every OpenAI response's token usage is priced and summed; at US$10/month AI routes return a friendly "paused" message. Plus a budget on the OpenAI project as a backstop.
- **Errors:** clients get `{code, message}`; exception text stays in server logs.
- **CORS:** only `chrome-extension://` origins.
- **Key safety:** the OpenAI key exists only on the server (Render secret); never in the extension or the repo.
- **Privacy:** canonical product URLs (no search terms), personal lines stripped from page text, price history local. Privacy policy matches the code.
- **CI/CD:** GitHub Actions runs tests + build on every push (Python 3.10/3.12); a `vX.Y.Z` tag builds a release zip; Render deploys only after CI passes.
- **Honest limit:** an anonymous extension can't be fully locked down (anyone can install it and get a token), so the spend cap is the real backstop.

---

## 7. Bugs worth telling as stories (STAR format)

1. **Wrong price from an ad (Flipkart).** *Situation:* a Honeywell purifier showed ₹25,887, which was a Philips ad's price. *Task:* read the right price on a single-page app. *Action:* found that Flipkart updates the page in place, so JSON-LD can be stale; now trust JSON-LD only if its SKU matches the page's product ID, wait up to 3 s, else take the first non-struck price after the product heading. *Result:* correct ₹19,498; test added.
2. **Blank Amazon price.** `.a-offscreen` was empty on some pages; built `readAmazonPrice` with fallbacks (aria-hidden copy, whole + fraction), never the struck-out M.R.P.
3. **Backend rejecting requests (emoji).** Truncating review text split an emoji's surrogate pair, producing invalid JSON. Wrote an emoji-safe `truncate()`.
4. **Copy-paste reviews disappearing.** Deduping by text removed exactly the duplicates the trust check needed. Switched to dedupe by site review ID.
5. **32-second chat.** Reasoning model → effort `none`, cache-friendly prompt, prefetch → 0.7 s to first word.
6. **Privacy leak found before launch.** Page text included "Hello, <name>" and the delivery address/PIN, and URLs carried search terms. Now page text is a fallback only (<3 reviews) with personal lines filtered in the browser, and URLs are canonical. Four tests prove it.
7. **"Variant" mislabel.** Cycling shorts vs active shorts were called variants; tightened the verifier prompt and added the pair to the eval set.
8. **Fixing real user feedback after launch (v0.5.2).** *Situation:* store users reported two missed matches (a Xiaomi air purifier and a Portronics car charger) and that "Analyze reviews" could be clicked while reviews were still loading. *Task:* fix without ever risking a wrong "same". *Action:* reproduced with live searches: the right listing was the #1 search result, but my rule pre-filter dropped it before the AI saw it, because Flipkart names the brand "Mi" and Amazon "Xiaomi", and "111 W" vs "111W" tokenized differently. Added a small brand-alias table and number+unit normalization, with tests from the real titles. Added both pairs to the match eval; it caught the model calling the renamed charger "same" about 1 time in 25, so I added a prompt rule (different product names are never "same") and re-ran until 300/300 with 0 false "same". Locked the Analyze button until all review pages are read. *Result:* both products now match (the charger as "check the variant", the safe answer), the eval set grew to 30 pairs, and the prompt fix shipped instantly through the backend while the UI fix went through store review.
9. **Measuring the whole pipeline, not just the LLM (v0.6.0).** *Situation:* after story 8, I realised my match eval only tested the AI step with titles I typed in, so it measured precision but never recall; both user bugs were in an earlier stage. *Task:* find out how often the extension misses a product that really is on the other store. *Action:* built an end-to-end recall test: 26 real products hand-checked on both stores (plus 3 sold on one store only), running the extension's own extractor on live pages, live search, rules and the AI, and reporting the stage that lost each miss. Baseline v0.5.1: 21/26. Fixes driven by what it found: read the model number from each store's spec table (a fallback query, a ranking boost, given to the AI, and a veto for a different code from the same family); "X by Y" brands ("PHILIPS by Phlips"); ranking by how much of the source title a listing covers (long Amazon titles were being pushed out); a softer filter fallback; and treating Amazon's robot check as an error instead of "no match". The test also caught two regressions I introduced along the way: a wrong "same" (Philips HL7756 vs HL7707, because one Flipkart page labels the field "Model Id" with a lowercase d) and the AI calling HL7756/00 vs /01 "different". *Result:* 26/26 found, 0 wrong "same", match eval 350/350. *Lesson:* evaluate the whole pipeline, and keep every real failure as a test case.

---

## 8. Likely questions and answers

**Why a Chrome extension and not a website?**
The user is already on the product page; the extension reads the page in their browser, at human pace, with their session (Amazon's review list needs sign-in). A website would need server-side scraping, which is fragile and against the sites' rules.

**Why a backend at all? Why not call OpenAI from the extension?**
An API key shipped in an extension is public. The backend holds the key and enforces tokens, limits and the spend cap.

**How do you stop the LLM from hallucinating prices or numbers?**
It never produces them. Prices are scraped, counts and verdicts are code. For text it does write, a validator checks numbers against the evidence and falls back to a template.

**How do you know the matcher works?**
A labelled eval set of 35 tricky pairs: 105/105 over 3 runs, zero false "same" (350/350 over 10 runs). And an end-to-end recall test on 26 real products: 26/26 found, 0 wrong "same". Plus a rule veto on conflicting specs, so even a model mistake can't produce a wrong "same" when specs differ.

**What about prompt injection?**
Scraped text is fenced as untrusted data, the model's output is constrained to enums/schemas, and the evals include injection attempts in reviews and product titles.

**How would you scale to 100k users?**
- Move counters from SQLite to Redis or Postgres; run multiple stateless API instances behind a load balancer.
- Cache analyses per product + review set (public data, shareable across users) to cut model calls sharply.
- Queue long analyses; keep chat streaming.
- Per-feature cost budgets and alerts; a cheaper model for matching.
- Scraping stays in users' browsers, so it scales naturally.

**What breaks most often?**
Site markup changes. Mitigations: structured data (JSON-LD, `__INITIAL_STATE__`) over CSS classes, fallbacks, unit tests on saved HTML. Next step planned: a daily health check on known products.

**Why `gpt-6-luna`?**
Benchmarked 7 models on this app's real workload (latency with ~200 reviews, guardrail checks, sizing-answer quality); it matched first-word latency, finished sooner, followed review evidence 5/5 vs 2/5, and was cheaper.

**What would you do differently / next?**
Daily scraping health checks, a shared analysis cache, a settings page, Hindi/Hinglish answers, more stores, and agent actions (e.g. add to cart) with explicit user confirmation.

**Did you use AI tools to build it?**
Yes, AI-assisted development (Claude Code) for implementation speed. The product decisions, guardrail design, thresholds and evals were mine, and every behaviour change was verified with a test or eval and in the real browser. (Be honest here; know every design decision above well enough to defend it.)

**What was the hardest part?**
Reliable data from two sites that change often: Amazon's review pagination, Flipkart's obfuscated SPA, prices read from the wrong element. The LLM part was easier than making the inputs trustworthy.

---

## 9. Live demo checklist

1. Open the side panel ~1 minute before (free server may need to wake up).
2. Amazon.in product with many reviews (e.g. earbuds) → **Analyze reviews**: verdict, pros/cons with counts.
3. Chat: "Is the battery good?", then "M or L?" style question, then an off-topic question to show the decline.
4. Show the comparison card (price difference on Flipkart) and explain the two-vote rule.
5. Review trust card: "signals, not proof".
6. Price card: **Watch price** with a target; explain alerts and why there's no forecast.
7. Show the GitHub repo: CI badge, evals table, `trust.py`.
