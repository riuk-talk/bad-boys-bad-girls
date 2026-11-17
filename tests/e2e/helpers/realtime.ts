import type { Page } from "@playwright/test";

/**
 * Collects the subscriptions Realtime refused on a page (the « system » message with status
 * « error » of a postgres_changes channel). The Parloir joined its channel before the member's
 * token was read: Realtime checked it as anon, refused the filter, and the messages only came by
 * the slow safety read (CI n° 44102433042). The client still reports SUBSCRIBED in that case, so
 * the refusal is only seen on the socket.
 */
export function watchRealtimeRefusals(page: Page, into: string[]): void {
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const text = String(payload);
      if (!text.includes('"system"') || !text.includes('"postgres_changes"')) return;
      try {
        const [, , topic, event, body] = JSON.parse(text) as [
          unknown,
          unknown,
          string,
          string,
          { status?: string; message?: string; extension?: string },
        ];
        if (event === "system" && body.extension === "postgres_changes" && body.status === "error")
          into.push(`${topic}: ${body.message ?? "refused"}`);
      } catch {
        // Not a JSON frame of the Phoenix protocol: not ours to read.
      }
    });
  });
}
