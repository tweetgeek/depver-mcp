import { describe, expect, it } from "vitest";
import { UnparseableRange } from "../../../src/core/errors.js";
import {
  compareSemver,
  compareWithBuildTieBreak,
  isSemverPrerelease,
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
