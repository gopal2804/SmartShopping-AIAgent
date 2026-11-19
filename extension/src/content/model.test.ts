// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { amazonModelNumber } from "./amazon";
import { flipkartModelNumber } from "./flipkart";

const doc = (html: string) => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");

describe("amazonModelNumber", () => {
  it("reads the model number from the tech-spec table, preferring it over the model name", () => {
    const d = doc(`<table id="productDetails_techSpec_section_1">
      <tr><th>Model Name</th><td>XM Series</td></tr>
      <tr><th>Item model number</th><td>‎WH1000XM5/LMIN</td></tr></table>`);
    expect(amazonModelNumber(d)).toBe("WH1000XM5/LMIN");
  });

  it("reads 'Label : Value' detail bullets", () => {
    const d = doc(`<div id="detailBullets_feature_div"><ul>
      <li><span class="a-text-bold">Item model number ‏ : ‎</span><span>HL7756/00</span></li></ul></div>`);
    expect(amazonModelNumber(d)).toBe("HL7756/00");
  });

  it("returns empty when the page has no model", () => {
    expect(amazonModelNumber(doc("<p>nothing</p>"))).toBe("");
  });
});

describe("flipkartModelNumber", () => {
  // Shape of Flipkart's spec rows inside window.__INITIAL_STATE__ (real pages say "Model ID" or "Model Id").
  const row = (label: string, value: string) => ({
    value: { label_0: { value: { text: label } }, label_1: { value: { text: [value] } } },
  });
  const page = (pid: string, rows: object[]) =>
    doc(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({ pid, specs: rows })};</script>`);

  it("reads the model, matching the label case-insensitively", () => {
    const d = page("MIXEJ9YXZ9PAU6JU", [row("Total Jars", "3"), row("Model Id", "HL7756/01")]);
    expect(flipkartModelNumber(d, "MIXEJ9YXZ9PAU6JU")).toBe("HL7756/01");
  });

  it("prefers the model number over the model name", () => {
    const d = page("P1", [row("Model Name", "Galaxy M35 5G"), row("Model Number", "SM-M356B")]);
    expect(flipkartModelNumber(d, "P1")).toBe("SM-M356B");
  });

  it("ignores state left over from another product (Flipkart swaps pages in place)", () => {
    const d = page("OTHERPID", [row("Model ID", "WH-1000XM5")]);
    expect(flipkartModelNumber(d, "MIXEJ9YXZ9PAU6JU")).toBe("");
  });
});
