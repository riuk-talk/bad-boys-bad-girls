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
