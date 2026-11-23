import { describe, expect, it } from "vitest";
import { padCik } from "@/lib/sec/cik";

describe("padCik", () => {
  it("pads a numeric CIK to 10 digits", () => {
    expect(padCik(104169)).toBe("0000104169"); // Walmart
  });

  it("pads a string CIK to 10 digits", () => {
    expect(padCik("320193")).toBe("0000320193");
  });

  it("leaves an already padded CIK unchanged", () => {
    expect(padCik("0000909832")).toBe("0000909832"); // Costco
  });

  it("ignores surrounding whitespace", () => {
    expect(padCik("  27419 ")).toBe("0000027419"); // Target
  });

  it.each([
    ["", "empty"],
    ["abc", "letters"],
    ["-5", "negative"],
    ["12.5", "decimal"],
    ["12345678901", "more than 10 digits"],
    ["0", "zero"],
  ])("rejects %j (%s)", (input) => {
    expect(() => padCik(input)).toThrow(/Invalid CIK/);
  });
});
