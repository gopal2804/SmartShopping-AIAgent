# Smart Shopping Agent: project context

Read this first in a new session. Full chronological history: [docs/PROJECT_LOG.md](docs/PROJECT_LOG.md). User-facing docs: [README.md](README.md).

## What this is and why

A Chrome extension (side panel) for **Amazon.in and Flipkart** plus a **FastAPI backend** that calls OpenAI. It is a *neutral* shopping assistant: review analysis, cross-site price comparison, review-trust signals, price tracking with alerts. The owner (Gopal, GitHub `gopal2804`) is building it as an **interview portfolio project**; the product angle is "what the stores' own AI assistants (Rufus, Flippi) won't do: compare across stores, flag review patterns, track prices".

- Repo: https://github.com/gopal2804/SmartShopping-AIAgent (branch `main`, public)
- Local path: `/Users/gopalgupta/Desktop/AI Projects/smart-shopping-agent`

## Current status (2026-11-17)

- **Features are frozen** after Phase 4. The user asked to stop adding features.
- **Next: deployment** so anyone can install the extension, driven step by step by the user's requirements. See "Deployment" in README. Don't start new features unless asked.
- **Deployment decisions:** own OpenAI key behind per-install limits + monthly cap; **public** Chrome Web Store listing; backend on **Render**. Latest progress is at the bottom of docs/PROJECT_LOG.md.
- **Deployment steps 1 (CI + releases) and 2 (API protection) are done**; v0.4.0 released. **Step 3 done:** backend live on Render (free plan) at **https://smart-shopping-agent-api.onrender.com**, auto-deploys from `main` after CI passes. **Step 4 done:** `npm run build` targets Render (`extension/.env.production`), `npm run build:local` targets localhost. **Step 5 (Chrome Web Store) materials are ready** (`docs/PRIVACY.md`, `docs/store/`), v0.5.1 **submitted for review on 2026-11-17** (store item ID `glgigibfcofhkkekbeahefhkiljneknm`; dashboard Account has a verified contact email). If rejected, read Google's reason and adjust. Then step 6 (daily scraping health check).
- **Privacy rule:** anything sent to the backend must match `docs/PRIVACY.md`. Page text only as a fallback (<3 reviews) with personal lines stripped; canonical product URLs. Update the policy if data handling changes.
- Free plan: the service sleeps after 15 min idle (first request ~30–60 s) and usage counters reset on sleep; the OpenAI project budget is the real cap until upgrading to Starter + disk.

## API protection (backend)

- AI routes use `Depends(guarded("<bucket>"))` in `main.py`: valid HMAC install token (`security.py`), monthly budget left, per-install daily limit (`usage.py`, SQLite). New AI routes must use it too.
- Every OpenAI call must report cost: `usage.store().record_spend(response.usage, "<kind>")` in `llm.py`.
- Errors to clients are `{code, message}` (`auth`, `limit`, `budget`, `upstream`, `no_data`); never put exception text in responses.
- Settings come from env (`app/config.py`, documented in `backend/.env.example`). Tests: `backend/tests` (pytest, fakes for the model).
- Extension: all backend calls go through `apiFetch` in `sidepanel/api.ts` (adds the token, re-registers on 401). Backend URL = `VITE_BACKEND_URL` at build time.

## CI / releases

- `.github/workflows/ci.yml` must stay green: extension `npm test` + `npm run build`; backend import check + `python -m evals.trust_eval --no-llm` on Python 3.10 and 3.12.
- Release: bump `version` in `extension/public/manifest.json` and `extension/package.json` (must match), commit, `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`. `release.yml` attaches the zip.
- Check CI with `gh run list --workflow ci.yml --limit 1` / `gh run view <id> --log-failed`.

## Layout

```
backend/app/main.py      FastAPI routes: /health /api/analyze /api/chat (stream) /api/match /api/trust
backend/app/llm.py       All prompts + OpenAI calls (Responses API), guardrail rules, caches, validators
backend/app/trust.py     Deterministic review-pattern signals (no LLM)
backend/app/schemas.py   Pydantic models (request size limits live here)
backend/evals/           guardrail_eval, match_eval, trust_eval, model_bench (real OpenAI calls)
extension/src/content/   Content script: extract product/reviews; amazon.ts, flipkart.ts, common.ts
extension/src/compare/   Cross-site search + rule pre-filter + AI verify
extension/src/prices/    Price parse/store (chrome.storage.local)/insight/alerts/background check
extension/src/sidepanel/ React UI (App.tsx, PriceCard.tsx, api.ts)
extension/src/background.ts + offscreen.ts  chrome.alarms price checks; offscreen doc parses HTML
```

## Run / test

```bash
# backend (needs backend/.env with OPENAI_API_KEY; never print or commit it)
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
# extension: build, then chrome://extensions → Load unpacked → extension/dist
cd extension && npm run build:local && npm test    # local backend; `npm run build` targets Render. 37 vitest tests
cd backend && .venv/bin/python -m pytest tests          # 10 API-protection tests (needs requirements-dev.txt)
cd backend && .venv/bin/python -m evals.guardrail_eval   # 22 chat checks
cd backend && .venv/bin/python -m evals.match_eval --runs 3
cd backend && .venv/bin/python -m evals.trust_eval
```

Model: `gpt-6-luna` (chosen by `evals/model_bench.py`), chat reasoning effort `none`, analysis/match `low`. Configurable via `.env`.

## Design rules (keep these)

1. **Code computes, the model narrates.** Prices, counts, verdicts, trust signals and alert decisions are deterministic code. The model only judges identity (titles only, never prices) or rephrases computed numbers.
2. **Validate model output** against schemas and evidence; fall back to a template if it adds numbers or accusatory words.
3. **Conservative by default.** A wrong "same product", a false "fake reviews" signal, or a predicted price is worse than saying nothing. Thresholds and minimum-data rules exist for this.
4. **Scraped text is untrusted** (prompt-injection). It's fenced in prompts; evals include injection cases.
5. **Privacy:** price history and watchlist stay in `chrome.storage.local`. When adding user screenshots to the README, **blur name/address/PIN/cart** first (done with Pillow in a scratch venv).
6. Every behaviour change gets a test or an eval case; README results tables are kept current.

## Hard-won gotchas (site behaviour, Nov 2026)

- **Amazon reviews pagination** ignores `?pageNumber=`; use the "Show more" ajax POST with `nextPageToken` from `[data-hook=show-more-button]` + `anti-csrftoken-a2z` from `#cr-state-object`. Review list needs sign-in.
- **Amazon price**: `.priceToPay .a-offscreen` is often blank → read aria-hidden copy or `.a-price-whole`+fraction; never `[data-a-strike]` (M.R.P.). See `readAmazonPrice`.
- **Amazon star breakdown** labels differ signed-in ("5 stars represent 60% of ratings") vs signed-out ("60 percent of reviews have 5 stars").
- **Flipkart** class names are obfuscated: use JSON-LD and `window.__INITIAL_STATE__`. Pages change in place (SPA): JSON-LD can be stale or late → only trust it if `sku === pid`, wait up to 3 s, fallback = first non-struck ₹ after `<h1>` (ads sit above it). Review stars in server HTML are empty placeholders; ratings come from `__INITIAL_STATE__`.
- Dedupe reviews by site review ID (not text) so copy-paste reviews survive for the trust check.
- Truncate strings without splitting emoji surrogate pairs (`truncate()`), or the backend rejects the JSON.
- `scrollIntoView()` returns a Promise in new Chrome: never return it from a React effect.
- If the backend "hangs" on port 8000, it was likely suspended with Ctrl+Z: `kill -9` the uvicorn PIDs; stop servers with Ctrl+C.

## Working with the user

- Explains things simply; prefers plain-language updates and step-by-step instructions for anything they must do (reloading the extension, running commands).
- Commit and push to `main` after each completed change (they've been fine with this); scan staged files for secrets first.
- Ask before decisions that cost money, need their accounts (OpenAI, Chrome Web Store, hosting), or publish things publicly.
