# Smart Shopping Agent

A Chrome extension that analyzes product reviews on **Amazon.in** and **Flipkart** with an LLM and lets you chat about the product in a side panel.

**Phase 1 (this version):** review summary (verdict, pros/cons with frequency, best-for, confidence) + streaming product Q&A.

## Screenshots

| Verdict: Recommended | Verdict: Consider alternatives |
|---|---|
| ![Side panel recommending Clovia active shorts on Amazon.in: 4.2★, 60 reviews read, pros with how often reviewers mention them](docs/screenshots/review-analysis-recommended.png) | ![Side panel suggesting alternatives for a Xiaomi air purifier: cleans air well but reviewers report reliability and spare-part issues](docs/screenshots/review-analysis-consider-alternatives.png) |
| Most reviewers praise fit and comfort, so it's recommended with the sizing caveat. | Air quality is praised, but repeated reports of failures after warranty push it to "consider alternatives". |

**Cons, confidence and evidence-based chat.** The answer leads with a verdict, then backs it with counts from each review sample ("5 of 8 on-page reviews praise comfort…") and says what the reviews can't tell you.

![Side panel showing cons with frequency, a medium-confidence badge, and a chat answer about comfort citing review counts](docs/screenshots/chat-and-confidence.png)

## Architecture

```
Amazon.in / Flipkart page
   │  content script (src/content) reads title, price, rating, reviews
   ▼
Side panel (React, src/sidepanel) ──HTTP──▶ FastAPI backend (backend/app)
                                              │  holds the OpenAI key
                                              ▼
                                           OpenAI Responses API
                                           (structured output + streaming)
```

- **Extraction:** Amazon uses `data-hook` selectors (and scrolls lazy-loaded reviews into view). Flipkart's class names are obfuscated, so it uses JSON-LD structured data plus visible-text patterns. When fewer than 3 reviews are found, raw page text is sent so the model can still recover.
- **Security:** the API key never ships in the extension; CORS only allows `chrome-extension://` origins; scraped page text is fenced as untrusted data in prompts (prompt-injection defense).
- **Cost:** analysis runs only when you click **Analyze**, and results are cached in memory by product + review count.

## Setup

### 1. Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then put your OpenAI key in .env
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Check it: <http://localhost:8000/health>. Change `OPENAI_MODEL` in `.env` to use another model.

### 2. Extension

```bash
cd extension
npm install
npm run build
```

Then in Chrome: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/dist` folder. After each rebuild, click the reload icon on the extension card.

### 3. Use it

1. Open a product page on Amazon.in or Flipkart.
2. Click the extension icon to open the side panel.
3. Click **Analyze reviews**, then ask questions in the chat.

When you analyze or ask, the extension also fetches up to 20 review pages in the background (~200 reviews, ~10–15 s), using your own browser session. Because "most helpful" sorting skews positive, the pages are split into a balanced sample: 10 most-helpful, 6 critical (lowest-rated first) and 4 most-recent. Each review is tagged with its `source`, and the product's overall star breakdown is sent too, so the model judges *what* goes wrong from critical reviews and *how often* from the real rating distribution. Flipkart works signed-out; Amazon only serves its review list to signed-in users, so sign in to Amazon for the deeper read. The page limit is `MAX_REVIEW_PAGES` in `extension/src/content/common.ts`.

## Guardrails and evals

Chat is scoped to the product: off-topic questions get a fixed decline message, mixed questions get only the product part answered. Review text is treated as untrusted data (a review saying "ignore all previous instructions" is in the eval fixture). Run the eval (makes ~14 small OpenAI calls):

```bash
cd backend && .venv/bin/python -m evals.guardrail_eval
```

Compare models on this app's real workload (latency with ~200 reviews, guardrail and sizing-answer quality):

```bash
cd backend && .venv/bin/python -m evals.model_bench gpt-6-luna gpt-5-mini --runs 5
```

`gpt-6-luna` was chosen from that benchmark (5 runs each). Time to first word is the same (median 0.7 s for both), but it finishes sooner (2.0 s vs 2.7 s median) because answers are shorter, its sizing answer followed the review evidence 5/5 times vs 2/5, and it is cheaper. Both passed 60/60 guardrail checks with 0 leaks. An explicit prompt rule for either/or questions ("name the option the reviews point to") later raised both models to 10/10 on the choice checks.

## Roadmap

1. ~~Review summary + product chat~~
2. Fake-review detection (rule signals + LLM scoring)
3. Price tracking with history charts and drop alerts (`chrome.alarms`, Postgres)
4. Cross-site comparison (matching the same product on Amazon and Flipkart)
5. Agent actions (watch price, add to wishlist/cart with confirmation)
