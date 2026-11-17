import { PARSE_PRICE_MESSAGE } from "./types";
import { parseProductPrice } from "./prices/parse";

// Hidden page used by the background worker, which has no DOMParser, to read a product page's price.
const ALLOWED = ["https://www.amazon.in", "https://www.flipkart.com"];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== PARSE_PRICE_MESSAGE) return;
  const url = new URL(msg.url);
  if (!ALLOWED.includes(url.origin)) {
    sendResponse({ price: null });
    return;
  }
  fetch(url.href, { credentials: "include" })
    .then((res) => (res.ok ? res.text() : ""))
    .then((html) => {
      const doc = html ? new DOMParser().parseFromString(html, "text/html") : null;
      const price = doc ? parseProductPrice(msg.site, doc, url.searchParams.get("pid") ?? "") : null;
      sendResponse({ price });
    })
    .catch(() => sendResponse({ price: null }));
  return true;
});
