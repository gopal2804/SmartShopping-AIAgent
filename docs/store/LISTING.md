# Chrome Web Store listing kit

Everything to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) for Smart Shopping Agent. Upload package: `smart-shopping-agent-vX.Y.Z.zip` from the [latest GitHub release](https://github.com/gopal2804/SmartShopping-AIAgent/releases/latest) (manifest at the zip root).

## Store listing tab

**Name** (from manifest): Smart Shopping Agent

**Summary** (manifest description, ≤132 characters):
> Neutral shopping assistant for Amazon.in and Flipkart: review analysis, cross-site prices, review trust and price alerts.

**Category:** Shopping  **Language:** English

**Description:** (on each release, change "NEW IN VERSION x.y.z" to the new version and its changes)

```
Shop on Amazon.in and Flipkart with a second opinion that works for you, not the store.

WHAT IT DOES
Open the side panel on any Amazon.in or Flipkart product page:

✔ Review analysis: reads a balanced sample of helpful, critical and recent reviews and gives a clear verdict with pros, cons, who it's best for and how confident it is.
✔ Ask about the product: "Is the battery good?", "Should I order M or L?" Answers cite what reviewers actually said.
✔ Compare prices across stores: finds the same product on the other site and shows the price difference. Close-but-different variants are clearly labelled.
✔ Review trust check: flags unusual patterns such as bursts of 5-star reviews, copy-pasted wording or many unverified buyers. Signals, never accusations.
✔ Price tracking and alerts: builds a price history as you browse, tells you when a price is genuinely good, and notifies you when a watched product drops.

NEW IN VERSION 0.6.1
• Reads up to ~300 reviews (was ~200) for a more complete picture.
• Smarter store matching: uses the manufacturer's model number from both stores, handles brands the stores name differently (like Mi and Xiaomi), and only says "same product" when the model and specs match.
• New "Report it" button on the comparison card: flag a wrong or missing match in one tap.
• "Analyze reviews" now waits until all reviews are read, so the verdict always uses the full sample.
• Clearer message when a store temporarily blocks a search, instead of "no match found".

PRIVATE BY DESIGN
Price history and your watchlist stay in your browser. No account, no ads, no tracking. Prices, counts and verdicts are computed by code, not invented by AI, and it never predicts future prices.

Works on www.amazon.in and www.flipkart.com product pages.
Open source: https://github.com/gopal2804/SmartShopping-AIAgent
```

**Graphics** (in [`docs/store/`](.)):

| Asset | File | Size |
|---|---|---|
| Store icon | `extension/public/icons/icon128.png` | 128×128 |
| Screenshots (upload in this order) | `screenshot-1-analysis.png` … `screenshot-5-chat.png` | 1280×800 |
| Small promo tile | `promo-small.png` | 440×280 |

**Official URL / Homepage:** https://github.com/gopal2804/SmartShopping-AIAgent
**Support URL:** https://github.com/gopal2804/SmartShopping-AIAgent/issues

## Privacy practices tab

**Single purpose:**
> Help shoppers evaluate a product on Amazon.in or Flipkart by analysing its reviews, comparing its price on the other store, flagging unusual review patterns and tracking its price.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `sidePanel` | The extension's whole interface is a side panel shown next to the product page. |
| `scripting` | If a product tab was open before the extension was installed or updated, the content script is injected into that Amazon.in/Flipkart tab so the side panel can read the product. |
| `storage` | Stores the user's price history, watchlist and an anonymous install token locally on the device. |
| `alarms` | Re-checks prices of products the user chose to watch every 6 hours. |
| `notifications` | Notifies the user when a watched product's price drops or reaches their target. |
| `offscreen` | The background price check needs a DOM parser to read the price from a watched product's page; an offscreen document provides it. |
| Host `https://www.amazon.in/*` | Reads the product page the user is viewing, loads its review pages and searches Amazon.in for the same product (cross-store comparison). |
| Host `https://www.flipkart.com/*` | Same as above, for Flipkart. |
| Host `https://smart-shopping-agent-api.onrender.com/*` | The extension's own backend, which generates the review analysis, answers and comparisons. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package; the backend returns JSON/text only.)

**Data usage:** declare what is collected:

- ☑ **Website content**: product details and public reviews from Amazon.in/Flipkart product pages.
- ☑ **User activity**: questions the user types into the side-panel chat.
- ☐ Everything else (personally identifiable information, health, financial, authentication, personal communications, location, web history): not collected. Personal lines (name, delivery address, PIN) are removed from page text in the browser before anything is sent.

**Certifications** (tick all three):
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/gopal2804/SmartShopping-AIAgent/blob/main/docs/PRIVACY.md

## Distribution tab

- **Visibility:** Public
- **Regions:** India (the extension only supports Amazon.in and Flipkart), or all regions.
- **Pricing:** Free

## Notes for review (optional "test instructions" field)

```
No account is needed. Open any product page on www.amazon.in or www.flipkart.com (for example a pair of earbuds), click the extension's toolbar icon to open the side panel, then click "Analyze reviews" or ask a question in the chat. The backend runs on a free hosting plan, so the very first request can take up to a minute while it wakes up; the panel says "Waking up the server…" meanwhile.
```
