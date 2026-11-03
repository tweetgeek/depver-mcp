import { describe, expect, it } from "vitest";
import { UnparseableRange } from "../../../src/core/errors.js";
import {
  compareSemver,
  compareWithBuildTieBreak,
  isSemverPrerelease,
  parseSemverCheck,
} from "../../../src/versions/semver-range.js";

describe("compareSemver", () => {
  it("orders numerically, not lexically", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("sorts a pre-release before its final version", () => {
    expect(compareSemver("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
  });

  it("compares numeric pre-release identifiers numerically", () => {
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
  });

  it("accepts a loose leading v", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });

  it("throws UnparseableRange on an invalid version", () => {
    expect(() => compareSemver("latest", "1.0.0")).toThrow(UnparseableRange);
    expect(() => compareSemver("1.0.0", "1.x")).toThrow(UnparseableRange);
  });
});

describe("isSemverPrerelease", () => {
  it("is true for a pre-release", () => {
    expect(isSemverPrerelease("1.0.0-beta.1")).toBe(true);
  });

  it("is false for a final version", () => {
    expect(isSemverPrerelease("1.0.0")).toBe(false);
  });

  it("is false when only build metadata is present", () => {
    expect(isSemverPrerelease("1.0.0+build")).toBe(false);
  });
});

describe("compareWithBuildTieBreak", () => {
  it("orders build metadata ascending on an otherwise equal version", () => {
    expect(compareWithBuildTieBreak("1.2.3+2", "1.2.3+1")).toBeGreaterThan(0);
  });

  it("compares numeric build identifiers numerically", () => {
    expect(compareWithBuildTieBreak("1.2.3+10", "1.2.3+9")).toBeGreaterThan(0);
  });

  it("sorts a version without build metadata first", () => {
    expect(compareWithBuildTieBreak("1.2.3", "1.2.3+1")).toBeLessThan(0);
  });

  it("lets semver order win before the tie-break", () => {
    expect(compareWithBuildTieBreak("1.2.4", "1.2.3+9")).toBeGreaterThan(0);
  });

  it("returns 0 for identical build metadata", () => {
    expect(compareWithBuildTieBreak("1.2.3+1", "1.2.3+1")).toBe(0);
  });
});

interface RangeCase {
  input: string;
  matches: string[];
  rejects: string[];
}

function expectRange(input: string, dialect: "npm" | "pub") {
  const check = parseSemverCheck(input, { dialect });
  expect(check.kind).toBe("range");
  if (check.kind !== "range") throw new Error("unreachable");
  return check;
}

describe("parseSemverCheck (npm)", () => {
  it.each([
    ["18.2.0", "18.2.0"],
    ["v18.2.0", "v18.2.0"],
    ["  18.2.0  ", "18.2.0"],
    ["1.0.0-beta.1", "1.0.0-beta.1"],
  ])("treats %j as the exact version %j", (input, version) => {
    expect(parseSemverCheck(input, { dialect: "npm" })).toEqual({ kind: "exact", version });
  });

  const ranges: RangeCase[] = [
    { input: "^18", matches: ["18.3.1", "18.0.0"], rejects: ["19.0.0", "18.0.0-beta.1", "17.9.9"] },
    { input: "~1.2", matches: ["1.2.9", "1.2.0"], rejects: ["1.3.0", "1.1.9"] },
    { input: "1.x", matches: ["1.0.0", "1.99.99"], rejects: ["2.0.0", "0.9.9"] },
    { input: ">=1 <2", matches: ["1.0.0", "1.9.9"], rejects: ["2.0.0", "0.9.9"] },
    { input: "1.0.0 - 1.5.0", matches: ["1.0.0", "1.5.0", "1.2.3"], rejects: ["1.5.1", "0.9.9"] },
    { input: "^1 || ^2", matches: ["1.4.0", "2.7.0"], rejects: ["3.0.0", "0.9.0"] },
    { input: "*", matches: ["0.0.1", "9.9.9"], rejects: ["1.0.0-beta"] },
    { input: ">=1.0.0-alpha", matches: ["1.0.0-beta", "1.0.0", "2.0.0"], rejects: ["2.0.0-rc.1"] },
  ];

  it.each(ranges)("parses $input as a range", ({ input, matches, rejects }) => {
    const check = expectRange(input, "npm");
    for (const v of matches) expect(check.matches(v), `${input} should match ${v}`).toBe(true);
    for (const v of rejects) expect(check.matches(v), `${input} should reject ${v}`).toBe(false);
  });

  it.each(["latest", ">>=1", "", "   ", "^1 ||| ^2"])("throws UnparseableRange on %j", (input) => {
    expect(() => parseSemverCheck(input, { dialect: "npm" })).toThrow(UnparseableRange);
    expect(() => parseSemverCheck(input, { dialect: "npm" })).toThrow(
      `cannot parse npm version or range "${input.trim()}"`,
    );
  });
});

describe("parseSemverCheck (pub)", () => {
  it.each([
    ["1.0.0", "1.0.0"],
    ["1.0.0-beta.1", "1.0.0-beta.1"],
    ["1.2.3+4", "1.2.3+4"],
  ])("treats %j as the exact version %j", (input, version) => {
    expect(parseSemverCheck(input, { dialect: "pub" })).toEqual({ kind: "exact", version });
  });

  const ranges: RangeCase[] = [
    { input: "any", matches: ["0.0.1", "9.9.9"], rejects: ["1.0.0-beta"] },
    { input: "^1.0.0", matches: ["1.5.0", "1.0.0"], rejects: ["2.0.0", "0.9.9", "1.0.0-beta"] },
    { input: "^0.1.2", matches: ["0.1.9", "0.1.2"], rejects: ["0.2.0", "0.1.1"] },
    { input: ">=0.13.0 <1.0.0", matches: ["0.13.6", "0.13.0"], rejects: ["1.0.0", "0.12.9"] },
    { input: ">=1.0.0", matches: ["1.0.0", "4.0.0"], rejects: ["0.9.9", "2.0.0-beta"] },
    { input: "<2.0.0", matches: ["1.9.9"], rejects: ["2.0.0", "2.0.0-beta"] },
    { input: ">1.0.0 <=1.5.0", matches: ["1.0.1", "1.5.0"], rejects: ["1.0.0", "1.5.1"] },
    { input: "  any  ", matches: ["3.0.0"], rejects: [] },
    { input: ">=1.0.0-alpha", matches: ["1.0.0-beta", "1.0.0"], rejects: ["2.0.0-rc.1"] },
  ];

  it.each(ranges)("parses $input as a constraint", ({ input, matches, rejects }) => {
    const check = expectRange(input, "pub");
    for (const v of matches) expect(check.matches(v), `${input} should match ${v}`).toBe(true);
    for (const v of rejects) expect(check.matches(v), `${input} should reject ${v}`).toBe(false);
  });

  it.each([
    "~1.2",
    "~1.2.0",
    "1.x",
    "1.*",
    "*",
    "1.0.0 - 2.0.0",
    "^1 || ^2",
    "^1.0.0 || ^2.0.0",
    "||",
    "^1",
    "^1.2",
    ">=1",
    ">=1.0",
    "latest",
    "",
    ">=1.0.0  <2.0.0",
    ">= 1.0.0",
    "ANY",
  ])("throws UnparseableRange on %j", (input) => {
    expect(() => parseSemverCheck(input, { dialect: "pub" })).toThrow(UnparseableRange);
    expect(() => parseSemverCheck(input, { dialect: "pub" })).toThrow(
      `cannot parse pub.dev version constraint "${input.trim()}"`,
    );
  });
});
