// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { canonicalProductUrl, pageText } from "./common";

const doc = (body: string) => new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html");

// Header and buy-box lines as they appear on Amazon.in / Flipkart for a signed-in shopper.
const page = doc(`
  <header>
    <span>Hello, gopal</span><span>Account &amp; Lists</span><span>Returns &amp; Orders</span>
    <div>Deliver to gopal - Kanpur 208006</div>
    <div>Delivering to Kanpur 208006</div>
  </header>
  <h1>Honeywell Air Touch P2 Air Purifier</h1>
  <div>Battery and filter life are excellent</div>
  <div>Enter pincode to check delivery</div>
`);

describe("pageText (privacy)", () => {
  it("drops greetings, account menus, delivery addresses and PIN codes but keeps product text", () => {
    const text = pageText(0, page);
    expect(text).toContain("Honeywell Air Touch P2 Air Purifier");
    expect(text).toContain("Battery and filter life are excellent");
    for (const personal of ["gopal", "Kanpur", "208006", "Hello", "Account", "Deliver", "pincode"]) {
      expect(text).not.toContain(personal);
    }
  });

  it("is not sent at all when enough reviews were read", () => {
    expect(pageText(3, page)).toBe("");
  });
});

describe("canonicalProductUrl (privacy)", () => {
  it("strips Amazon tracking parameters", () => {
    const url = new URL("https://www.amazon.in/boAt-Airdopes/dp/B0FC2Y3XGV/ref=sr_1_3?crid=ABC&keywords=gift+for+wife&sr=8-3");
    expect(canonicalProductUrl(url, "B0FC2Y3XGV")).toBe("https://www.amazon.in/dp/B0FC2Y3XGV");
  });

  it("keeps only the pid on Flipkart, dropping the search query", () => {
    const url = new URL("https://www.flipkart.com/honeywell-air-touch-p2/p/itm45a1851cadf21?pid=APFGSPC7BQHCGJ8K&lid=LST&q=air+purifier+for+asthma&srno=s_1_1");
    expect(canonicalProductUrl(url, "APFGSPC7BQHCGJ8K")).toBe(
      "https://www.flipkart.com/honeywell-air-touch-p2/p/itm45a1851cadf21?pid=APFGSPC7BQHCGJ8K"
    );
  });
});
