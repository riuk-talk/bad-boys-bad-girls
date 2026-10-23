import { describe, expect, it } from "vitest";
import { photoBatchAllowed } from "@/lib/photo-batch";

describe("photoBatchAllowed: the batch cut-out, preview only", () => {
  it("on the preview base and a local stack", () => {
    expect(photoBatchAllowed("https://chvnmzmvcjvhxlnfmlvv.supabase.co")).toBe(true);
    expect(photoBatchAllowed("http://127.0.0.1:54321")).toBe(true);
    expect(photoBatchAllowed("http://localhost:54321")).toBe(true);
  });

  it("refused on the production base, and on anything else", () => {
    expect(photoBatchAllowed("https://hmmobtyherwuhrhymfbk.supabase.co")).toBe(false);
    expect(photoBatchAllowed("https://chvnmzmvcjvhxlnfmlvv.supabase.co.evil.example")).toBe(false);
    expect(photoBatchAllowed("http://chvnmzmvcjvhxlnfmlvv.supabase.co")).toBe(false);
    expect(photoBatchAllowed("https://127.0.0.1:54321")).toBe(false);
    expect(photoBatchAllowed("not a url")).toBe(false);
    expect(photoBatchAllowed(undefined)).toBe(false);
  });
});
