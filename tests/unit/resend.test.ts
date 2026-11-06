import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resendConfig, sendWithResend } = await import("@/lib/email/resend");

const config = {
  apiKey: "re_test",
  from: "ne-pas-repondre@example.test",
  url: "https://fake.test/emails",
};
const email = { subject: "Sujet", text: "Texte", html: "<p>Texte</p>" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resendConfig", () => {
  it("needs the key and the sender, and defaults to the API of Resend", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "a@example.test");
    expect(resendConfig()).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("EMAIL_FROM", "");
    expect(resendConfig()).toBeNull();
    vi.stubEnv("EMAIL_FROM", "a@example.test");
    vi.stubEnv("RESEND_API_URL", undefined);
    expect(resendConfig()).toEqual({
      apiKey: "re_x",
      from: "a@example.test",
      url: "https://api.resend.com/emails",
    });
  });
});

describe("sendWithResend", () => {
  it("posts one e-mail with the key, the sender, an idempotency key and the unsubscribe headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await sendWithResend(config, 42, "to@example.test", email, {
      url: "https://site.test/fr/desinscription?t=a&k=b",
      oneClick: "https://site.test/api/email/unsubscribe?t=a&k=b",
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://fake.test/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["idempotency-key"]).toBe("email-outbox-42");
    expect(headers["user-agent"]).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual({
      from: '"Bad Boys & Bad Girls" <ne-pas-repondre@example.test>',
      to: ["to@example.test"],
      subject: "Sujet",
      text: "Texte",
      html: "<p>Texte</p>",
      headers: {
        "List-Unsubscribe": "<https://site.test/api/email/unsubscribe?t=a&k=b>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });

  it("keeps a sender that already has a name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendWithResend(
      { ...config, from: "Greffe <g@example.test>" },
      1,
      "to@example.test",
      email,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).from).toBe("Greffe <g@example.test>");
  });

  it("is false when Resend refuses (quota, validation) or cannot be reached", async () => {
    for (const status of [401, 422, 429, 500]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      expect(await sendWithResend(config, 1, "to@example.test", email)).toBe(false);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await sendWithResend(config, 1, "to@example.test", email)).toBe(false);
  });
});
