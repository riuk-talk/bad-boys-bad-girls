import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const createAdminClient = vi.fn(() => {
  throw new Error("the database must not be reached");
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const SECRET = "s".repeat(48);

describe("withSmallSizes", () => {
  it("adds the small size of each pending photo, once", async () => {
    const { withSmallSizes } = await import("@/lib/cleanup/files");
    expect(withSmallSizes(["u/a.webp", "u/a.webp", "u/b-s.webp"])).toEqual([
      "u/a.webp",
      "u/a-s.webp",
      "u/b-s.webp",
    ]);
  });
});

describe("POST /api/cron/cleanup", () => {
  beforeEach(() => {
    vi.stubEnv("PUSH_CRON_SECRET", SECRET);
    createAdminClient.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function call(auth: string) {
    const { POST } = await import("@/app/api/cron/cleanup/route");
    return POST(
      new NextRequest("http://localhost/api/cron/cleanup", {
        method: "POST",
        headers: { authorization: auth },
      }),
    );
  }

  it("refuses a call without the secret, before reaching the database", async () => {
    for (const auth of ["", "Bearer nope", `Bearer ${SECRET}x`]) {
      const response = await call(auth);
      expect(response.status).toBe(401);
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
