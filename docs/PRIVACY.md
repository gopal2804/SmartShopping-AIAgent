# Privacy Policy: Smart Shopping Agent

_Effective 19 November 2026_

Smart Shopping Agent is a Chrome extension that helps you evaluate products on **Amazon.in** and **Flipkart**: it summarises reviews, compares the price on the other store, flags unusual review patterns and tracks prices. This policy explains what data it handles and why. It has no accounts, no ads, no analytics or tracking, and it never sells data.

## What stays in your browser

Stored only in Chrome's local extension storage on your device, never uploaded:

- **Price history** of products you view, and your **watchlist** with any target prices.
- An **anonymous install token** (a random identifier, explained below).

Removing the extension deletes this data. "Reset history" in the side panel deletes a product's price history.

## What is sent to our server, and when

Only while the side panel is open on an Amazon.in or Flipkart product page, and only to provide the feature you're using. Requests go to our backend at `smart-shopping-agent-api.onrender.com` over HTTPS:

| Data | When | Why |
|---|---|---|
| Product details: title, brand, manufacturer model number, price, rating, rating breakdown, feature bullets, and the product's public customer reviews | Review analysis, chat, review-pattern check | To generate the analysis, answers and checks |
| A short fallback of the page's visible text | Only when fewer than 3 reviews could be read | So the analysis still works on unusual pages. Lines that could identify you (greetings such as "Hello, …", account menus, delivery address and PIN code) are removed in your browser before sending |
| Product URL | With the above | Reduced to the product identifier, without search terms or tracking parameters |
| Product titles from the other store's search results | Cross-store comparison | To decide whether a listing is the same product |
| Your chat messages, and price numbers from your local history | When you ask a question | To answer it |
| The anonymous install token | Every request | To apply fair-use limits per installation |

We do **not** send your name, address, account details, order history, browsing history, or any page outside Amazon.in and Flipkart product pages.

## Reporting a wrong or missing match

The comparison card has a "Wrong or missing match? Report it" link. It opens a GitHub issue form, prefilled with the two public product links only. Nothing is sent unless you choose to submit it on GitHub, under your own GitHub account and GitHub's terms.

## Processing by OpenAI

To generate summaries, comparisons and answers, our server sends the data above to **OpenAI's API**. OpenAI processes it under its API data-usage policies; API data is not used to train OpenAI's models by default.

## What our server keeps

- **Usage counters:** the number of requests per install token and per day, the number of new installs per network address per day (to prevent abuse), and the month's total AI cost. These contain no product content.
- **Short-lived caches** of analysis results, held in memory and cleared when the server restarts.
- **Hosting logs:** our host (Render) records standard request logs such as IP address, time and path for operations and security.

We don't keep the product content or chat messages you send beyond what's needed to answer the request.

## Requests the extension makes to the stores

To compare prices and read more reviews, the extension loads Amazon.in and Flipkart pages (search results, review pages, product pages for watched items) **from your browser**, the same way you would by browsing. That information is used as described above and is not sent anywhere else.

## Your choices

- Use the extension only when you want: nothing is sent unless the side panel is open on a product page (watched-price checks only load the store pages, locally).
- Stop watching a product or reset its history at any time in the side panel.
- Uninstall the extension to delete all local data.

## Children

The extension is not directed at children under 13.

## Changes and contact

We'll update this page if the extension's data handling changes, with a new effective date. For questions or requests, open an issue at <https://github.com/gopal2804/SmartShopping-AIAgent/issues>.

## Chrome Web Store User Data Policy

The use of information received from this extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements: data is used only to provide the extension's single purpose, is not sold, is not used for advertising, and is not used to determine creditworthiness or for lending.
