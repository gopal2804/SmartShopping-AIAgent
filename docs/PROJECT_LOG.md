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
- Added a `GET /` description (bare URL returned 404); Render auto-deployed it ~75 s after CI passed, confirming the deploy pipeline.
- **Step 4 done; user confirmed it works in Chrome with the local backend stopped** (the "waking up" note didn't show because the server was already awake; it appears only after 15+ min idle). `extension/.env.production` sets `VITE_BACKEND_URL=https://smart-shopping-agent-api.onrender.com` for `npm run build`/releases; `npm run build:local` for localhost. Manifest `host_permissions`: Render host added, localhost removed (store-friendlier; local dev relies on CORS). Side panel pings `/health` on open, shows "Waking up the server…" after 3 s, or "can't reach the server". Plain-language connection error. Version **0.5.0** released. README now has "Install (no setup needed)" vs "Development setup".
- **Step 5 (in progress): Chrome Web Store.** Found and fixed a privacy issue first: every request sent `page_text` (body innerText) which included "Hello, <name>" and "Deliver to <name> – <city> <PIN>"; now `pageText(reviewsFound)` returns "" when ≥3 reviews and filters personal lines (greetings, account menus, deliver/delivering to, pincode, 6-digit numbers), and `mergeExtra` clears it once reviews ≥3. Product URLs are canonical (`/dp/ASIN`, Flipkart path + `?pid=`), dropping search terms. 4 privacy tests (41 total). Wrote `docs/PRIVACY.md` (matches code), `docs/store/LISTING.md` (description, single purpose, permission justifications, data-use: website content + user activity, certifications, review notes), 5 screenshots 1280×800 + 440×280 promo tile. Manifest 0.5.1 with `minimum_chrome_version: 116` and `homepage_url`. **Waiting on the user:** developer account (US$5), upload the v0.5.1 zip, fill the listing from the kit, submit. Reminder: upgrade Render to Starter + disk before the public listing goes live.
- **Step 5: submitted.** User registered the developer account, uploaded the v0.5.1 zip, filled the listing from the kit (Official URL left empty: needs Search Console ownership; one host-permission justification covering all three hosts; data usage = Website content + User activity; Location not ticked: IP is only used transiently for registration rate limiting and hosting logs, disclosed in PRIVACY.md), verified the publisher contact email, and submitted for review. Item ID `glgigibfcofhkkekbeahefhkiljneknm`. Next: wait for review; upgrade Render to Starter + disk before/at publish; then step 6.
- **Step 5 done: published.** Google approved the listing on 2026-11-18 (about a day after submitting); status "Published - public". Store page: https://chromewebstore.google.com/detail/smart-shopping-agent/glgigibfcofhkkekbeahefhkiljneknm. README has the store badge and an "Add to Chrome" link. Next: upgrade Render to Starter + disk as real users arrive; step 6.
- **v0.5.2: first user feedback fixed (2026-11-19).** (1) "Analyze reviews" is disabled ("Reading all reviews first…") while review pages load; analysis already awaited them, but the enabled button looked like it would use a partial sample. (2) Flipkart "Mi Smart Air Purifier 4 Lite" found no Amazon match (and the reverse): the item was the #1 Amazon search result but `preFilter` dropped it on brand (Flipkart "Mi" vs Amazon "Xiaomi"); added `BRAND_ALIASES` in `compare/rules.ts`. (3) Flipkart "Portronics 111 W Turbo Car Charger" found no Amazon match: "111 W" tokenized as model token "111" vs Amazon "111W"; `tokens()` now joins a number to its unit. Match prompt: brand aliases are not a brand difference; different product names are never "same" (the eval caught 1 false "same" in ~25 runs on the renamed charger before this rule). Match eval now 30 pairs: 90/90 ×3, 300/300 over 10 runs, 0 false "same". The eval now lists misses from every run. 44 extension tests.
