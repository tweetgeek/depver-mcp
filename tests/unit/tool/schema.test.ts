import { describe, expect, it } from "vitest";
import { CheckPackagesInput, formatEnvelopeError } from "../../../src/tool/schema.js";

function fail(input: unknown): string {
  const result = CheckPackagesInput.safeParse(input);
  if (result.success) throw new Error("expected validation to fail");
  return formatEnvelopeError(result.error);
}

describe("CheckPackagesInput", () => {
  it("accepts a batch of one item without a version", () => {
    const result = CheckPackagesInput.safeParse({
      packages: [{ ecosystem: "npm", name: "react" }],
    });
    expect(result.success).toBe(true);
  });

  it("trims ecosystem, name and version", () => {
    const result = CheckPackagesInput.parse({
      packages: [{ ecosystem: " npm ", name: " react ", version: " ^18 " }],
    });
    expect(result.packages[0]).toEqual({ ecosystem: "npm", name: "react", version: "^18" });
  });

  it("leaves version absent when not given", () => {
    const result = CheckPackagesInput.parse({ packages: [{ ecosystem: "npm", name: "react" }] });
    expect("version" in (result.packages[0] ?? {})).toBe(false);
  });

  it("rejects an empty batch naming the limit", () => {
    expect(fail({ packages: [] })).toBe("packages must contain between 1 and 100 items (got 0)");
  });

  it("rejects 101 items naming the count", () => {
    const packages = Array.from({ length: 101 }, () => ({ ecosystem: "npm", name: "x" }));
    expect(fail({ packages })).toBe("packages must contain between 1 and 100 items (got 101)");
  });

  it("accepts exactly 100 items", () => {
    const packages = Array.from({ length: 100 }, () => ({ ecosystem: "npm", name: "x" }));
    expect(CheckPackagesInput.safeParse({ packages }).success).toBe(true);
  });

  it.each(["", "   "])("rejects an empty name %j", (name) => {
    expect(fail({ packages: [{ ecosystem: "npm", name }] })).toBe(
      "packages[0].name must be a non-empty string",
    );
  });

  it("rejects a non-string ecosystem", () => {
    expect(fail({ packages: [{ ecosystem: 7, name: "x" }] })).toBe(
      "packages[0].ecosystem must be a string",
    );
  });

  it("rejects a missing packages array", () => {
    expect(fail({})).toMatch(/^packages must be an array/);
  });

  it("rejects unknown keys on an item", () => {
    expect(fail({ packages: [{ ecosystem: "npm", name: "x", extra: 1 }] })).toMatch(/extra/);
  });
});
