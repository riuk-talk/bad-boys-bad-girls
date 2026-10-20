import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn(async () => ({ data: true, error: null }));
const createAdminClient = vi.fn(() => ({ rpc }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

describe("vitalPage", () => {
  it("keeps the template of the page, never an id", async () => {
    const { vitalPage } = await import("@/lib/vitals");
    expect(vitalPage("/")).toBe("landing");
    expect(vitalPage("/en")).toBe("landing");
    expect(vitalPage("/promenade")).toBe("promenade");
    expect(vitalPage("/en/decouverte/")).toBe("decouverte");
    expect(vitalPage("/fiche/BB-7Q2K")).toBe("fiche");
    expect(vitalPage("/courrier")).toBe("courrier");
    expect(vitalPage("/courrier/0b6c1f9e")).toBe("courrier");
    expect(vitalPage("/courrier/0b6c1f9e/heures")).toBe("other");
    expect(vitalPage("/visites/parloir/42")).toBe("parloir");
    expect(vitalPage("/admin/membres/42")).toBe("other");
    expect(vitalPage("/english")).toBe("other");
  });
});

describe("POST /api/vitals", () => {
  beforeEach(() => {
    rpc.mockClear();
    createAdminClient.mockClear();
  });

  async function call(body: string, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/vitals/route");
    return POST(
      new NextRequest("http://localhost/api/vitals", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      }),
    );
  }

  it("records each plausible measure", async () => {
    const response = await call(
      JSON.stringify([
        { page: "promenade", metric: "LCP", value: 1800 },
        { page: "promenade", metric: "CLS", value: 0.04 },
        { page: "promenade", metric: "INP", value: 900_000 },
      ]),
      { origin: "http://localhost" },
    );
    expect(response.status).toBe(204);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("record_web_vital", {
      p_page: "promenade",
      p_metric: "LCP",
      p_value: 1800,
    });
  });

  it("refuses another site, a malformed body or an unknown page, before the database", async () => {
    const ok = JSON.stringify([{ page: "landing", metric: "LCP", value: 1 }]);
    expect((await call(ok, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await call("not json")).status).toBe(400);
    expect(
      (await call(JSON.stringify([{ page: "fiche/42", metric: "LCP", value: 1 }]))).status,
    ).toBe(400);
    expect((await call(JSON.stringify([]))).status).toBe(400);
    expect((await call(" ".repeat(2000))).status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
