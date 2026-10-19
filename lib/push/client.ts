/**
 * Browser side of Web Push. The service worker is registered only when a member switches
 * notifications on (never on the landing page, never on arrival: SPEC §7 quater).
 */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** iPhone and iPad (iPadOS presents itself as a Mac with a touch screen). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the home screen (the only place where iOS 16.4+ allows Web Push). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type PushSupport = "ok" | "install" | "unsupported";

/** "install": an iPhone in Safari, which must first add the site to the home screen. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !VAPID_PUBLIC_KEY) return "unsupported";
  const capable =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "install";
  return capable ? "ok" : "unsupported";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type BrowserSubscription = { endpoint: string; p256dh: string; auth: string };

/** The subscription of this browser, if notifications are already on (registers nothing). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Asks the browser's permission, then subscribes. Returns null when the member refuses or the
 * browser cannot (the caller treats both as "not now").
 */
export async function subscribeBrowser(): Promise<BrowserSubscription | null> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

/** Unsubscribes this browser; returns the endpoint to revoke on the server, if any. */
export async function unsubscribeBrowser(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
