import { chromium, type Cookie } from "@playwright/test";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { mkdir, writeFile } from "node:fs/promises";

export const LIGHTHOUSE_CATEGORIES = ["performance", "accessibility", "best-practices"] as const;
export type LighthouseScores = Record<(typeof LIGHTHOUSE_CATEGORIES)[number], number> & {
  lcp: string;
  cls: string;
  tbt: string;
};

/**
 * Lighthouse mobile (SPEC §18) on pages that need a session: a separate Chromium gets the
 * cookies of a signed-in Playwright context, and Lighthouse keeps them (no storage reset).
 * HTML reports in lighthouse-reports/ (ignored by git).
 */
export async function auditSignedIn(
  cookies: Cookie[],
  pages: { name: string; url: string }[],
): Promise<Record<string, LighthouseScores>> {
  const chrome = await launch({
    chromePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium",
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });
  const results: Record<string, LighthouseScores> = {};
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
    await browser.contexts()[0]!.addCookies(cookies);
    await mkdir("lighthouse-reports", { recursive: true });
    for (const { name, url } of pages) {
      const result = await lighthouse(url, {
        port: chrome.port,
        onlyCategories: [...LIGHTHOUSE_CATEGORIES],
        formFactor: "mobile",
        disableStorageReset: true,
        output: "html",
      });
      if (!result) throw new Error(`no Lighthouse result for ${name}`);
      const { lhr, report } = result;
      const score = (id: string) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
      const audit = (id: string) => lhr.audits[id]?.displayValue ?? "n/a";
      results[name] = {
        performance: score("performance"),
        accessibility: score("accessibility"),
        "best-practices": score("best-practices"),
        lcp: audit("largest-contentful-paint"),
        cls: audit("cumulative-layout-shift"),
        tbt: audit("total-blocking-time"),
      };
      await writeFile(`lighthouse-reports/${name}.html`, String(report));
    }
    await browser.close();
  } finally {
    await chrome.kill();
  }
  return results;
}
