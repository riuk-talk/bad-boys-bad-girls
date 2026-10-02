import { describe, expect, it } from "vitest";
import { truncateIp } from "@/lib/net/ip";

describe("truncateIp", () => {
  it.each([
    ["203.0.113.42", "203.0.113.0"],
    ["203.0.113.42, 10.0.0.1", "203.0.113.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3::"],
    ["2001:0db8:0000::1", "2001:db8:0::"],
    ["::1", "0:0:0::"],
    ["999.1.1.1", null],
    ["not-an-ip", null],
    [null, null],
  ])("%s → %s", (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });
});
