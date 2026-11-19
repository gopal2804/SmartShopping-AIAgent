const ISSUES_URL = "https://github.com/gopal2804/SmartShopping-AIAgent/issues/new";

/**
 * A prefilled GitHub issue for a wrong or missing match. It contains only the two public product links
 * (already canonical, without search terms), and nothing is sent unless the user submits it on GitHub.
 */
export function matchReportUrl(sourceUrl: string, shownUrl: string | null): string {
  const body = [
    `Product: ${sourceUrl}`,
    `Match shown: ${shownUrl ?? "none"}`,
    "",
    "What's wrong? (e.g. the right product is at <link>, or the match is a different model)",
  ].join("\n");
  return `${ISSUES_URL}?${new URLSearchParams({ title: "Wrong or missing match", body })}`;
}
