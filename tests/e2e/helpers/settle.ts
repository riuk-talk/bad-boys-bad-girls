import type { Page } from "@playwright/test";

/**
 * Waits for the page to be complete before it is measured (axe):
 * - its title: after a client-side navigation Next.js sets the <title> of the new page (from
 *   generateMetadata) a moment after its content (CI n° 118: « document-title » on /admin/vue);
 *   a page that never gets one is still reported by axe, the wait is only bounded;
 * - the finite animations (a dialog fading in, a stamp), so that contrast is measured on the
 *   final rendering, not a frame of a fade. Infinite ones (the neon sign) are left out. The
 *   longest of the site lasts 520 ms: one still running after 5 s is a fault, reported by name
 *   (10e: one wait once ran into the 2-minute limit of a test without saying what it waited for).
 */
export async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => document.title.trim() !== "", undefined, { timeout: 5_000 })
    .catch(() => undefined);
  const stuck = await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    const finished = Promise.all(
      finite.map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => null);
    const late = new Promise<string[]>((resolve) =>
      setTimeout(
        () =>
          resolve(
            finite
              .filter((animation) => animation.playState !== "finished")
              .map((animation) => {
                const target = (animation.effect as KeyframeEffect | null)?.target ?? null;
                const name =
                  "animationName" in animation
                    ? String(animation.animationName)
                    : "transitionProperty" in animation
                      ? String(animation.transitionProperty)
                      : "animation";
                return `${name} (${animation.playState}) on ${target?.tagName.toLowerCase() ?? "?"}.${String(target?.className ?? "")}`;
              }),
          ),
        5_000,
      ),
    );
    return Promise.race([finished, late]);
  });
  if (stuck && stuck.length > 0) {
    throw new Error(`animations still running after 5 s: ${stuck.join("; ")}`);
  }
}
