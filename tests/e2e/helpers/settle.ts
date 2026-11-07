import type { Page } from "@playwright/test";

/**
 * Waits for the page to be complete before it is measured (axe):
 * - its title: after a client-side navigation Next.js sets the <title> of the new page (from
 *   generateMetadata) a moment after its content (CI n° 118: « document-title » on /admin/vue);
 *   a page that never gets one is still reported by axe, the wait is only bounded;
 * - the finite animations (a dialog fading in, a stamp), so that contrast is measured on the
 *   final rendering, not a frame of a fade. Infinite ones (the neon sign) are left out.
 */
export async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => document.title.trim() !== "", undefined, { timeout: 5_000 })
    .catch(() => undefined);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
