import { describe, expect, it } from "vitest";
import { balance, chargeKey, chargeLength, duplicateIndexes, shuffleCharges } from "@/lib/casier";

const line = (length: number) => "x".repeat(length);

describe("balance of the Casier (± 40 % of the mean of the two others)", () => {
  it("does not warn for three lines of the same length", () => {
    expect(balance([line(60), line(60), line(60)])).toEqual([null, null, null]);
  });

  it("warns when a line is more than 40 % longer than the mean of the others", () => {
    // Mean of the others = 50: 71 > 70 (= 1.4 × 50).
    expect(balance([line(71), line(50), line(50)])[0]).toBe("long");
  });

  it("does not warn at exactly 40 % longer (limit case)", () => {
    expect(balance([line(70), line(50), line(50)])[0]).toBeNull();
  });

  it("warns when a line is more than 40 % shorter than the mean of the others", () => {
    // Mean of the others = 50: 29 < 30 (= 0.6 × 50).
    expect(balance([line(29), line(50), line(50)])[0]).toBe("short");
  });

  it("does not warn at exactly 40 % shorter (limit case)", () => {
    expect(balance([line(30), line(50), line(50)])[0]).toBeNull();
  });

  it("compares with the mean of the two others, not with the longest", () => {
    // Others 40 and 80, mean 60: 85 ≤ 84? no → long; 84 = 1.4 × 60 → not.
    expect(balance([line(85), line(40), line(80)])[0]).toBe("long");
    expect(balance([line(84), line(40), line(80)])[0]).toBeNull();
  });

  it("can flag several lines and both directions at once", () => {
    expect(balance([line(120), line(20), line(60)])).toEqual(["long", "short", null]);
  });

  it("counts characters, not UTF-16 units, and ignores surrounding spaces", () => {
    expect(chargeLength("  héhé 🏍️  ")).toBe(Array.from("héhé 🏍️").length);
  });
});

describe("duplicates (mirror of public.charge_key)", () => {
  it("ignores case and spaces", () => {
    expect(chargeKey(" A vu  un OURS ")).toBe("avuunours");
    expect(duplicateIndexes(["A vu un ours", "Autre", "avuunours"])).toEqual([0, 2]);
    expect(duplicateIndexes(["Un", "Deux", "Trois"])).toEqual([]);
  });
});

describe("shuffled order for the Visitors", () => {
  it("keeps track of the true line", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      let state = seed;
      const random = () => (state = (state * 9301 + 49297) % 233280) / 233280;
      const { charges, trueIndex } = shuffleCharges("VRAI", ["faux 1", "faux 2"], random);
      expect(charges[trueIndex - 1]).toBe("VRAI");
      expect([...charges].sort()).toEqual(["VRAI", "faux 1", "faux 2"].sort());
    }
  });
});
