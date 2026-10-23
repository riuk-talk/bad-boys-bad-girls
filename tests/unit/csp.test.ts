import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "@/lib/security/csp";

describe("csp", () => {
  const prod = buildCsp("abc", { isDev: false, supabaseUrl: "https://x.supabase.co", https: true });

  it("uses a nonce with strict-dynamic and never unsafe-inline/eval for scripts in production", () => {
    const scriptSrc = prod.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).toContain("'nonce-abc'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("forbids framing and plugins, allows Supabase and Turnstile", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("connect-src 'self' https://x.supabase.co wss://x.supabase.co");
    expect(prod).toContain("frame-src https://challenges.cloudflare.com");
  });

  it("allows the Realtime socket of a local stack (ws:// next to http://)", () => {
    const local = buildCsp("abc", { isDev: false, supabaseUrl: "http://127.0.0.1:54321" });
    expect(local).toContain("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
  });

  it("upgrades insecure requests only over https", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(buildCsp("abc", { isDev: false, https: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  it("generates distinct base64 nonces", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});

describe("WebAssembly for the in-browser cut-out (2026-10-23)", () => {
  it("never on a page: neither WebAssembly nor JS eval", async () => {
    const { buildCsp } = await import("@/lib/security/csp");
    const page = buildCsp("n0nce", { isDev: false, supabaseUrl: "https://x.supabase.co" });
    expect(page).not.toContain("wasm-unsafe-eval");
    expect(page).not.toMatch(/'unsafe-eval'/);
    expect(page).toMatch(/worker-src 'self' blob:/);
  });

  it("the worker alone: WebAssembly, scripts and requests from the site only", async () => {
    const { CUTOUT_WORKER_CSP } = await import("@/lib/security/csp");
    expect(CUTOUT_WORKER_CSP).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CUTOUT_WORKER_CSP).toContain("connect-src 'self'");
    expect(CUTOUT_WORKER_CSP).toContain("default-src 'none'");
    expect(CUTOUT_WORKER_CSP).not.toMatch(/'unsafe-eval'|https?:|\*/);
  });
});
