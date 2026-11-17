# Chrome Web Store listing kit

Everything to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) for Smart Shopping Agent. Upload package: `smart-shopping-agent-vX.Y.Z.zip` from the [latest GitHub release](https://github.com/gopal2804/SmartShopping-AIAgent/releases/latest) (manifest at the zip root).

## Store listing tab

**Name** (from manifest): Smart Shopping Agent

**Summary** (manifest description, ≤132 characters):
> Neutral shopping assistant for Amazon.in and Flipkart: review analysis, cross-site prices, review trust and price alerts.

**Category:** Shopping  **Language:** English

**Description:**

```
Shop on Amazon.in and Flipkart with a second opinion that works for you, not the store.

Open the side panel on any product page and Smart Shopping Agent:

• Reads the reviews for you: a balanced sample of helpful, critical and recent reviews (up to ~200) becomes a clear verdict with pros, cons, who it's best for and how confident it is.
• Answers your questions: "Is the battery good?", "Should I order M or L?" Answers cite what reviewers actually said, and it sticks to the product.
• Compares stores: finds the same product on the other site and shows the price difference. It only says "same product" when the model numbers and specs match; close-but-different variants are labelled as such.
• Checks the reviews themselves: flags unusual patterns such as bursts of 5-star reviews, copy-pasted wording, many unverified buyers, or reviewers describing rewards for ratings. These are signals, never accusations.
• Tracks prices: builds a price history as you browse, tells you when a price is genuinely good compared with what it has seen, and sends a notification when a watched product drops.

Private by design: price history and your watchlist stay in your browser. No account, no ads, no tracking. Numbers like prices, counts and verdicts are computed by code, not invented by AI, and the assistant never predicts future prices.

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
