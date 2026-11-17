import { EXTRACT_MESSAGE, MORE_REVIEWS_MESSAGE, type ExtractResponse, type MoreReviewsResponse } from "../types";
import { extractAmazon, fetchMoreAmazonReviews, isAmazonProductPage } from "./amazon";
import { extractFlipkart, fetchMoreFlipkartReviews, isFlipkartProductPage } from "./flipkart";

async function extract(): Promise<ExtractResponse> {
  const url = new URL(location.href);
  try {
    if (isAmazonProductPage(url)) return { ok: true, product: await extractAmazon(url) };
    if (isFlipkartProductPage(url)) return { ok: true, product: await extractFlipkart(url) };
    return { ok: false, reason: "not_product_page" };
  } catch (err) {
    return { ok: false, reason: `extract_failed: ${String(err)}` };
  }
}

async function fetchMoreReviews(): Promise<MoreReviewsResponse> {
  const url = new URL(location.href);
  try {
    if (isAmazonProductPage(url)) return { ok: true, ...(await fetchMoreAmazonReviews(url)) };
    if (isFlipkartProductPage(url)) return { ok: true, ...(await fetchMoreFlipkartReviews(url)) };
    return { ok: false, reason: "not_product_page" };
  } catch (err) {
    return { ok: false, reason: `fetch_failed: ${String(err)}` };
  }
}

const w = window as unknown as { __ssaContentLoaded?: boolean };
if (!w.__ssaContentLoaded) {
  w.__ssaContentLoaded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === EXTRACT_MESSAGE) {
      extract().then(sendResponse);
      return true; // keep the channel open for the async response
    }
    if (msg?.type === MORE_REVIEWS_MESSAGE) {
      fetchMoreReviews().then(sendResponse);
      return true;
    }
  });
}
