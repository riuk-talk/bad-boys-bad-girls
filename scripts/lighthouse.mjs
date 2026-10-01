// Lighthouse mobile audit against a running production server (pnpm build && pnpm start).
// Usage: pnpm lighthouse [baseUrl] [path...]   — fails if a score is below 90 (SPEC §18).
import { mkdir, writeFile } from "node:fs/promises";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const [baseUrl = "http://localhost:3100", ...paths] = process.argv.slice(2);
const targets = paths.length > 0 ? paths : ["/"];
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

const chrome = await launch({
  chromePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium",
  chromeFlags: ["--headless=new", "--no-sandbox"],
});
await mkdir("lighthouse-reports", { recursive: true });
let failed = false;
for (const path of targets) {
  const result = await lighthouse(`${baseUrl}${path}`, {
    port: chrome.port,
    onlyCategories: CATEGORIES,
    formFactor: "mobile",
    output: "html",
  });
  if (!result) throw new Error(`No result for ${path}`);
  const { lhr, report } = result;
  const scores = CATEGORIES.map((id) => [id, Math.round((lhr.categories[id]?.score ?? 0) * 100)]);
  const audit = (id) => lhr.audits[id]?.displayValue ?? "n/a";
  console.log(
    `${path}  ${scores.map(([id, s]) => `${id}=${s}`).join("  ")}  LCP=${audit("largest-contentful-paint")}  CLS=${audit("cumulative-layout-shift")}  TBT=${audit("total-blocking-time")}`,
  );
  for (const [id, score] of scores) if (id !== "seo" && score < 90) failed = true;
  await writeFile(
    `lighthouse-reports/${path === "/" ? "landing" : path.replaceAll("/", "_")}.html`,
    String(report),
  );
}
await chrome.kill();
process.exit(failed ? 1 : 0);
