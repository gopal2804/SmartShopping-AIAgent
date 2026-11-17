# Project log

Chronological record of what was built, why, and what was learned. Newest phase last. Context and rules for working on the project: [CLAUDE.md](../CLAUDE.md).

## 0. Idea (2026-11-17)

- Goal: an AI project for interviews under `~/Desktop/AI Projects/`. Generic chatbots were rejected as "ChatGPT can already do that"; the user chose a **browser extension**, then the **Smart Shopping Agent** for **Amazon.in + Flipkart**, with **OpenAI** as the LLM provider and a Python FastAPI backend.

## 1. Phase 1: review analysis + product chat

- MV3 extension: React side panel, content script extracts title/price/rating/reviews; background sets side-panel behaviour. Backend `/api/analyze` (structured output: verdict, pros/cons with frequency, best-for, confidence) and `/api/chat` (streaming).
- Fixes along the way: blank side panel on chat (effect returned `scrollIntoView` Promise); Amazon lazy-loaded reviews; screen-reader hint text in review bodies; Flipkart obfuscated markup → JSON-LD + text patterns.
- Reading more reviews: background fetch of review pages. Flipkart reviews come from `__INITIAL_STATE__` (stars are empty placeholders in HTML). Amazon review list needs sign-in, ignores `pageNumber` → implemented the "Show more" ajax with `nextPageToken` (inspected in the user's Chrome). Limit raised to 20 pages (~200 reviews).
- **Balanced sampling**: 50% most-helpful, 30% critical, 20% recent pages, each review tagged with `source`, plus the overall star breakdown so the model doesn't over-count complaints. Fixed Amazon breakdown labels for signed-in users.
- Performance: chat took ~32 s to first word (reasoning model) → reasoning effort `none`/`minimal`, prompt-cache-friendly context, review prefetch on product detection. Rescan made a full refresh.
- Guardrails: product-only chat scope (off-topic decline, mixed questions answer only the product part), either/or questions name the option the reviews support. Evals in `guardrail_eval.py`.
- Model choice: benchmarked 7 models over 5 runs (`model_bench.py`); `gpt-6-luna` won on answer quality (sizing 5/5 vs 2/5), length, analysis speed and price.
- Repo created and pushed; screenshots added to README (personal info blurred).

## 2. Phase 2: cross-site comparison

- Pipeline: build short query → search the other site (Flipkart `__INITIAL_STATE__`, Amazon search cards) → rule pre-filter (brand + model numbers, top 5) → AI verifier (titles only, `same|variant|different`, validated) → rule veto on conflicting specs (GB, ml, W, pack…). "Same" requires both.
- Prices in the card are scraped, never generated; links only on amazon.in/flipkart.com. Chat gets the comparison numbers with a price-honesty rule.
- Evals: 27 labelled pairs incl. injection → 81/81, 0 false "same". Live: OnePlus Nord CE6 Lite ₹2,860 cheaper on Flipkart. Fixed: cycling vs active shorts called "variant"; Amazon ad duplicates.
- Later: variant matches also show a neutral, caveated price difference.

## 3. Phase 3: review trust signals

- `backend/app/trust.py` (no LLM): 5-star bursts (excludes "recent" sample, needs ≥15 exact dates, ≥60-day span), near-duplicate wording (trigram Jaccard ≥ 0.5), unverified share ≥ 30%, reward-for-review mentions (patterns tested against innocent phrasings).
- Model writes a 1–2 sentence summary; validator rejects new numbers or accusatory words → template fallback. Card says "signals, not proof".
- Fixes: dedupe by review ID so copy-paste reviews survive; emoji-safe truncation (split surrogate made the backend reject requests).
- Evals: 8/8 planted/edge cases, 0/40 false alarms, real products clean. Chat answers "are these reviews fake?" without accusations.

## 4. Phase 4: price tracking + alerts

- History in `chrome.storage.local` (every product view + confirmed cross-site match), deterministic verdict (≥3 readings over ≥3 days), watchlist (≤20) re-checked every 6 h via `chrome.alarms` + offscreen document, Chrome notifications with anti-spam rules, suspect-reading filter (>3× jump), Reset history.
- Chat "buy now or wait?" uses recorded numbers only, no forecasts (eval handles hedges like "can't tell whether it will fall").
- Price-reading bugs fixed after real use: Amazon blank `.a-offscreen` (MacBook Neo) → `readAmazonPrice`; Flipkart read an ad's price (Philips ₹25,887 instead of Honeywell ₹19,498) → sku-matched JSON-LD + first non-struck price after `<h1>`.
- Tests: 37 extension unit tests; chat eval 22/22.

## 5. Next: deployment (started 2026-11-17)

- User froze features and wants the extension installable by anyone. Plan is in README → "Deployment". Decisions are made with the user step by step; record them here as they're made.
- Added `CLAUDE.md` (context for new sessions) and this log.
- **Decided:** OpenAI cost = project's own key with per-install limits + monthly cap · install = **public** Chrome Web Store listing · backend host = **Render**.
- **Pending:** limit values and cap, backend domain, store listing assets.
- **Step 1 done: CI + releases.** `.github/workflows/ci.yml` (extension tests/build; backend imports + `trust_eval --no-llm`, which now exits non-zero on failure) and `release.yml` (tag `vX.Y.Z` must match manifest → zip attached to a GitHub Release). Python 3.9 isn't available on GitHub runners any more, so CI uses 3.10 + 3.12 (local is still 3.9). Released **v0.4.0**: https://github.com/gopal2804/SmartShopping-AIAgent/releases/tag/v0.4.0. README has CI/release badges and "install from release" instructions.
- **Step 2 done: API protection.** `app/config.py` (env settings), `app/security.py` (HMAC install tokens, `POST /api/register` limited per IP), `app/usage.py` (SQLite counters per install per IST day, monthly spend from real token usage, budget check), `main.py` (`guarded(bucket)` dependency on all AI routes, `{code, message}` errors with no internals, `GET /admin/usage`). Extension `api.ts`: `apiFetch` registers once, stores the token, adds `Authorization`, re-registers on 401; backend URL from `VITE_BACKEND_URL` at build time (default localhost). Cards show limit/budget messages. 10 pytest tests (`backend/tests`, no OpenAI) run in CI. E2E on a local server: 401 without/forged token, limit 2 → 200,200,429, real analysis recorded at $0.0005.
- **Default limits chosen by me (configurable):** analyze 20, chat 100, match 60, trust 60 per install/day; 10 registrations per IP/day; $10/month cap. User should confirm or change these, and set an OpenAI project budget as backstop.
- **Step 3 (in progress): Render.** User chose **free plan now, upgrade later** (Starter + 1 GB disk before sharing widely). Added `render.yaml` Blueprint: python runtime, `rootDir: backend`, Singapore, `/health`, `autoDeployTrigger: checksPass`, `PYTHON_VERSION=3.12.8`, `APP_SECRET`/`ADMIN_TOKEN` generated, `OPENAI_API_KEY` `sync: false`, `TRUST_PROXY=1`, budget $10; disk block commented for the upgrade. Start command checked locally with a clean environment.
- **Step 3 done.** User applied the Blueprint (Render workspace "Gopal's workspace", Blueprint "SmartShooping AI Agent", sync of d7fa210). Live: **https://smart-shopping-agent-api.onrender.com**. Verified live: health ok; register 200; no/forged token 401; trust 0.3 s; real analysis 10.4 s; chat 4.3 s (evidence-based); off-topic declined; `/admin/usage` 403 without token (ADMIN_TOKEN generated); CORS preflight allows extension origins and `Authorization`. `autoDeployTrigger: checksPass` accepted by Render.
- **Next: step 4**, build the extension against the hosted URL (`VITE_BACKEND_URL`, `host_permissions`), release it, and test in Chrome without the local backend.
