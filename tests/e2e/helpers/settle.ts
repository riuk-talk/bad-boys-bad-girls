import type { Page } from "@playwright/test";

/**
 * Waits for the finite animations of the page (a dialog fading in, a stamp) to end, so that what
 * is measured next (axe contrast) is the final rendering, not a frame of a fade. Infinite ones
 * (the neon sign) never end and are left out.
 */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
