import { CHECK_INTERVAL_MINUTES, PRICE_ALARM, runPriceCheck } from "./prices/check";
import { getWatchlist } from "./prices/store";
import { CHECK_PRICES_MESSAGE, PARSE_PRICE_MESSAGE, type Site } from "./types";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function ensureAlarm() {
  if (!(await chrome.alarms.get(PRICE_ALARM))) {
    await chrome.alarms.create(PRICE_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_INTERVAL_MINUTES });
  }
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: "Read the current price from product pages you chose to watch.",
  });
}

async function fetchPrice(site: Site, url: string): Promise<number | null> {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ type: PARSE_PRICE_MESSAGE, site, url });
  return typeof res?.price === "number" ? res.price : null;
}

let running: Promise<{ checked: number; alerts: number }> | null = null;

function checkNow() {
  running ??= runPriceCheck({
    fetchPrice,
    notify: async (item, message) => {
      await chrome.notifications.create(item.key, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: item.title.slice(0, 60),
        message,
        priority: 1,
      });
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }).finally(() => {
    running = null;
  });
  return running;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PRICE_ALARM) void checkNow();
});

chrome.notifications.onClicked.addListener(async (id) => {
  const item = (await getWatchlist()).find((w) => w.key === id);
  if (item) await chrome.tabs.create({ url: item.url });
  await chrome.notifications.clear(id);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== CHECK_PRICES_MESSAGE) return;
  checkNow().then(sendResponse, () => sendResponse({ checked: 0, alerts: 0 }));
  return true;
});
