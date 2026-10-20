import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Real Core Web Vitals (SPEC §18, Phase 8b), LOCAL STACK ONLY (scripts/ci/local-env.mjs): a page
// view sends its measures when the page is hidden, and only daily counts reach the database.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const enabled =
  process.env.E2E_LOCAL_STACK === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) &&
  secret !== "";

test.describe("web vitals: measured on the landing, counted without identifier (local stack)", () => {
  test.skip(!enabled, "local stack environment not set (scripts/ci/local-env.mjs)");

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  async function landingSamples(metric: string): Promise<number> {
    const { data, error } = await admin
      .from("web_vitals_daily")
      .select("samples")
      .eq("page", "landing")
      .eq("metric", metric);
    if (error) throw error;
    return (data ?? []).reduce((sum, row) => sum + row.samples, 0);
  }

  test("the LCP and CLS of a visit reach the daily histogram", async ({ page, browserName }) => {
    // LCP and CLS come from Chromium's performance APIs; WebKit does not report both.
    test.skip(browserName !== "chromium", "LCP and CLS are measured by Chromium");
    const before = { LCP: await landingSamples("LCP"), CLS: await landingSamples("CLS") };
    const beacon = page.waitForRequest(
      (request) => request.url().endsWith("/api/vitals") && request.method() === "POST",
    );
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // An input ends the LCP; then the page is hidden, as when the visitor leaves.
    await page.mouse.click(5, 5);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await beacon;
    await expect.poll(() => landingSamples("LCP")).toBe(before.LCP + 1);
    await expect.poll(() => landingSamples("CLS")).toBe(before.CLS + 1);
  });
});
