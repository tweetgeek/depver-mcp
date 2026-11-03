import { describe, expect, it } from "vitest";
import { UnparseableRange } from "../../../src/core/errors.js";
import {
  compareComposer,
  formatComposer,
  isComposerPrerelease,
  normalizeComposer,
  parseComposerCheck,
  type ComposerStability,
} from "../../../src/versions/composer.js";

type Components = [number, number, number, number];

describe("normalizeComposer", () => {
  const tagged: Array<[string, Components, ComposerStability, number]> = [
    ["v1.2.3", [1, 2, 3, 0], "stable", 0],
    ["V1.2.3", [1, 2, 3, 0], "stable", 0],
    ["1.2", [1, 2, 0, 0], "stable", 0],
    ["1", [1, 0, 0, 0], "stable", 0],
    ["1.2.3.4", [1, 2, 3, 4], "stable", 0],
    ["10.20.30.40", [10, 20, 30, 40], "stable", 0],
    ["1.0.0-beta1", [1, 0, 0, 0], "beta", 1],
    ["1.0.0-RC2", [1, 0, 0, 0], "RC", 2],
    ["1.0.0-rc2", [1, 0, 0, 0], "RC", 2],
    ["1.0.0-alpha.3", [1, 0, 0, 0], "alpha", 3],
    ["1.0.0-Alpha3", [1, 0, 0, 0], "alpha", 3],
    ["1.0.0-a1", [1, 0, 0, 0], "alpha", 1],
    ["1.0.0-b2", [1, 0, 0, 0], "beta", 2],
    ["1.0.0-beta", [1, 0, 0, 0], "beta", 0],
    ["1.0.0RC1", [1, 0, 0, 0], "RC", 1],
    ["1.0.0_rc1", [1, 0, 0, 0], "RC", 1],
    ["1.0.0.rc1", [1, 0, 0, 0], "RC", 1],
    ["1.0.0-p1", [1, 0, 0, 0], "patch", 1],
    ["1.0.0-patch1", [1, 0, 0, 0], "patch", 1],
    ["1.0.0-pl1", [1, 0, 0, 0], "patch", 1],
    ["1.0.0-dev", [1, 0, 0, 0], "dev", 0],
    ["1.0.0.dev", [1, 0, 0, 0], "dev", 0],
    ["1.0.0-stable", [1, 0, 0, 0], "stable", 0],
    ["1.0.0+build.7", [1, 0, 0, 0], "stable", 0],
    [" 1.0.0 ", [1, 0, 0, 0], "stable", 0],
  ];

  it.each(tagged)("parses %s as a tagged version", (input, components, stability, n) => {
    const v = normalizeComposer(input);
    expect(v).not.toBeNull();
    expect(v?.components).toEqual(components);
    expect(v?.stability).toBe(stability);
    expect(v?.stabilityNumber).toBe(n);
    expect(v?.branch).toBe(false);
    expect(v?.raw).toBe(input);
  });

  const branches: Array<[string, Components]> = [
    ["dev-main", [0, 0, 0, 0]],
    ["dev-master", [0, 0, 0, 0]],
    ["dev-feature/foo", [0, 0, 0, 0]],
    ["2.x-dev", [2, 0, 0, 0]],
    ["2.1.x-dev", [2, 1, 0, 0]],
    ["v3.x-dev", [3, 0, 0, 0]],
    ["2.*-dev", [2, 0, 0, 0]],
  ];

  it.each(branches)("parses %s as a branch version", (input, components) => {
    const v = normalizeComposer(input);
    expect(v).not.toBeNull();
    expect(v?.branch).toBe(true);
    expect(v?.stability).toBe("dev");
    expect(v?.components).toEqual(components);
    expect(isComposerPrerelease(input)).toBe(true);
  });

  const invalid = [
    "",
    "   ",
    "latest",
    "^1.0",
    "1.0.*",
    "1.0.0-foo",
    "1.0.0-",
    "v",
    "dev-",
    "1.2.3.4.5",
    "1.0.0-beta1x",
    "x.y.z",
  ];

  it.each(invalid)("returns null for %j", (input) => {
    expect(normalizeComposer(input)).toBeNull();
  });
});

describe("compareComposer", () => {
  const ascending = [
    "1.0.0-dev",
    "1.0.0-alpha1",
    "1.0.0-alpha2",
    "1.0.0-beta1",
    "1.0.0-RC1",
    "1.0.0-RC2",
    "1.0.0",
    "1.0.0-patch1",
    "1.0.1",
  ];

  it("orders stability dev < alpha < beta < RC < stable < patch, then the next release", () => {
    for (let i = 0; i < ascending.length - 1; i++) {
      const lower = ascending[i] as string;
      const higher = ascending[i + 1] as string;
      expect(compareComposer(lower, higher), `${lower} < ${higher}`).toBeLessThan(0);
      expect(compareComposer(higher, lower), `${higher} > ${lower}`).toBeGreaterThan(0);
    }
  });

  const pairs: Array<[string, string, -1 | 0 | 1]> = [
    ["1.2", "1.2.0.0", 0],
    ["v1.2.3", "1.2.3", 0],
    ["1.0.0-RC1", "1.0.0-rc1", 0],
    ["1.0.0-p1", "1.0.0-patch1", 0],
    ["1.0.0-a1", "1.0.0-alpha.1", 0],
    ["v2.0.0", "1.9.9", 1],
    ["10.0.0", "9.0.0", 1],
    ["1.0.0-beta1", "1.0.0-beta2", -1],
    ["1.0.0-RC10", "1.0.0-RC9", 1],
    ["1.0.0-beta", "1.0.0-beta1", -1],
    ["1.0.0.1", "1.0.0", 1],
    ["1.0.0-patch1", "1.0.0-patch2", -1],
    ["1.0.0-patch1", "1.0.0.1", -1],
  ];

  it.each(pairs)("compareComposer(%s, %s) has sign %i", (a, b, sign) => {
    const reversed = sign === 0 ? 0 : -sign;
    expect(Math.sign(compareComposer(a, b))).toBe(sign);
    expect(Math.sign(compareComposer(b, a))).toBe(reversed);
  });

  it("sorts a branch below every tagged version with the same numeric prefix", () => {
    for (const tagged of ["2.0.0-dev", "2.0.0-alpha1", "2.0.0", "2.0.0-patch1", "2.0.1"]) {
      expect(compareComposer("2.x-dev", tagged), `2.x-dev < ${tagged}`).toBeLessThan(0);
    }
    expect(compareComposer("2.x-dev", "1.9.9")).toBeGreaterThan(0);
    expect(compareComposer("dev-main", "0.0.1-dev")).toBeLessThan(0);
  });

  it("accepts parsed versions as well as strings", () => {
    const a = normalizeComposer("1.0.0");
    const b = normalizeComposer("1.0.1");
    if (a === null || b === null) throw new Error("fixture did not parse");
    expect(compareComposer(a, b)).toBeLessThan(0);
    expect(compareComposer(a, "1.0.0")).toBe(0);
  });

  it("sorts a list correctly when used as a comparator", () => {
    const shuffled = ["1.0.0", "1.0.0-RC1", "0.9.0", "1.0.0-dev", "1.0.1", "1.0.0-patch1"];
    expect([...shuffled].sort(compareComposer)).toEqual([
      "0.9.0",
      "1.0.0-dev",
      "1.0.0-RC1",
      "1.0.0",
      "1.0.0-patch1",
      "1.0.1",
    ]);
  });

  it("throws UnparseableRange when a string does not parse", () => {
    expect(() => compareComposer("latest", "1.0.0")).toThrow(UnparseableRange);
    expect(() => compareComposer("1.0.0", "^1.0")).toThrow(UnparseableRange);
    expect(() => compareComposer("1.0.0", "1.0.0-foo")).toThrow(/1\.0\.0-foo/);
  });
});

describe("isComposerPrerelease", () => {
  const cases: Array<[string, boolean]> = [
    ["1.0.0-dev", true],
    ["1.0.0-alpha1", true],
    ["1.0.0-beta2", true],
    ["1.0.0-RC1", true],
    ["dev-main", true],
    ["2.x-dev", true],
    ["1.0.0", false],
    ["v1.2", false],
    ["1.0.0-patch1", false],
    ["1.0.0-p1", false],
    ["1.0.0-stable", false],
  ];

  it.each(cases)("isComposerPrerelease(%s) is %s", (input, expected) => {
    expect(isComposerPrerelease(input)).toBe(expected);
    const parsed = normalizeComposer(input);
    if (parsed === null) throw new Error("fixture did not parse");
    expect(isComposerPrerelease(parsed)).toBe(expected);
  });

  it("throws UnparseableRange for an invalid string", () => {
    expect(() => isComposerPrerelease("latest")).toThrow(UnparseableRange);
  });
});

describe("formatComposer", () => {
  it.each(["v1.2.3", "1.0.0-RC2", "dev-main", "2.x-dev"])(
    "returns the raw input for %s",
    (input) => {
      const v = normalizeComposer(input);
      if (v === null) throw new Error("fixture did not parse");
      expect(formatComposer(v)).toBe(input);
    },
  );
});

describe("parseComposerCheck", () => {
  const exact: Array<[string, string]> = [
    ["1.2.3", "1.2.3"],
    ["=1.2.3", "1.2.3"],
    ["==1.2.3", "1.2.3"],
    ["v1.2.3", "v1.2.3"],
    ["1.0.0-beta1", "1.0.0-beta1"],
    [" 1.2.3 ", "1.2.3"],
    ["= 1.2.3", "1.2.3"],
  ];

  it.each(exact)("parses %j as the exact version %s", (input, version) => {
    expect(parseComposerCheck(input)).toEqual({ kind: "exact", version });
  });

  function range(input: string): (version: string) => boolean {
    const check = parseComposerCheck(input);
    if (check.kind !== "range") throw new Error(`${input} did not parse as a range`);
    return check.matches;
  }

  const ranges: Array<[string, string[], string[]]> = [
    ["1.0.*", ["1.0.0", "1.0.9", "v1.0.3"], ["0.9.9", "1.1.0", "2.0.0"]],
    ["1.*", ["1.0.0", "1.9.9"], ["0.9.9", "2.0.0"]],
    ["1.0.x", ["1.0.9"], ["1.1.0"]],
    ["1.0.X", ["1.0.9"], ["1.1.0"]],
    [">=1.0 <2.0", ["1.0.0", "1.5.0", "1.9.9"], ["0.9.9", "2.0.0", "2.1.0"]],
    [">=1.0,<2.0", ["1.0.0", "1.5.0"], ["0.9.9", "2.0.0"]],
    [">=1.0, <2.0", ["1.5.0"], ["2.0.0"]],
    [">1.0", ["1.0.1", "2.0.0"], ["1.0.0", "0.9.0"]],
    ["<=1.0", ["1.0.0", "0.9.0"], ["1.0.1"]],
    ["<>1.0.0", ["0.9.9", "1.0.1"], ["1.0.0"]],
    ["!=1.0.0", ["0.9.9", "1.0.1", "1.0.0.1"], ["1.0.0", "v1.0.0"]],
    ["1.0 - 2.0", ["1.0.0", "1.5.0", "2.0.0", "2.0.9"], ["0.9.9", "2.1.0"]],
    ["1.0.0 - 2.1.0", ["1.0.0", "2.0.9", "2.1.0"], ["0.9.9", "2.1.1"]],
    ["1 - 2", ["1.0.0", "2.9.9"], ["0.9.9", "3.0.0"]],
    ["~1", ["1.0.0", "1.9.9"], ["0.9.9", "2.0.0"]],
    ["~1.2", ["1.2.0", "1.9.0"], ["1.1.9", "2.0.0"]],
    ["~1.2.3", ["1.2.3", "1.2.9"], ["1.2.2", "1.3.0"]],
    ["~10.0", ["10.0.0", "10.48.29"], ["9.9.9", "11.0.0"]],
    ["~1.2.3.4", ["1.2.3.4", "1.2.3.9"], ["1.2.3.3", "1.2.4"]],
    ["^1.2.3", ["1.2.3", "1.9.9"], ["1.2.2", "2.0.0"]],
    ["^1.2", ["1.2.0", "1.9.9"], ["1.1.9", "2.0.0"]],
    ["^1.0", ["1.0.0", "1.9.9"], ["0.9.9", "2.0.0"]],
    ["^0.3", ["0.3.0", "0.3.9"], ["0.2.9", "0.4.0"]],
    ["^0.0.3", ["0.0.3"], ["0.0.2", "0.0.4"]],
    ["^1.0 || ^2.0", ["1.5.0", "2.5.0"], ["0.9.9", "3.0.0"]],
    ["^1.0 | ^2.0", ["1.5.0", "2.5.0"], ["3.0.0"]],
    ["^1.0||^2.0", ["1.5.0", "2.5.0"], ["3.0.0"]],
    [">=1.0 <1.5 || >=2.0 <2.5", ["1.2.0", "2.2.0"], ["1.7.0", "2.7.0", "3.0.0"]],
    ["1.0.*@dev", ["1.0.5"], ["1.1.0"]],
    ["^1.0@beta", ["1.5.0"], ["2.0.0"]],
    ["~1.2@RC", ["1.9.0"], ["2.0.0"]],
    [">=1.0@stable", ["1.0.0"], ["0.9.9"]],
    ["*", ["0.0.1", "1.0.0", "99.99.99", "1.0.0-beta1"], []],
    ["x", ["1.0.0"], []],
    ["X", ["1.0.0"], []],
    ["*@dev", ["1.0.0"], []],
    ["  >=1.0   <2.0  ", ["1.5.0"], ["2.0.0"]],
    ["1.0.0 2.0.0", [], ["1.0.0", "2.0.0", "1.5.0"]],
    [">=2.0 <1.0", [], ["0.9.0", "1.5.0", "2.5.0"]],
  ];

  it.each(ranges)("range %j matches %j and rejects %j", (input, yes, no) => {
    const matches = range(input);
    for (const v of yes) expect(matches(v), `${input} should match ${v}`).toBe(true);
    for (const v of no) expect(matches(v), `${input} should not match ${v}`).toBe(false);
  });

  it("follows plain Composer ordering for pre-releases against an upper bound", () => {
    // 2.0.0-RC1 < 2.0.0 in Composer, so `<2.0.0` admits it; callers filter pre-releases.
    expect(range("<2.0.0")("2.0.0-RC1")).toBe(true);
    expect(range(">=1.0 <2.0")("1.0.0-beta1")).toBe(false);
  });

  it("returns false from matches() for branches and unparseable versions", () => {
    const matches = range("*");
    expect(matches("dev-main")).toBe(false);
    expect(matches("2.x-dev")).toBe(false);
    expect(matches("latest")).toBe(false);
    expect(matches("")).toBe(false);
    expect(range(">=1.0")("1.x-dev")).toBe(false);
  });

  const invalid = [
    "",
    "   ",
    "dev-main",
    "dev-master",
    "1.x-dev",
    "2.*-dev",
    "#abc123",
    "1.0 as 2.0",
    "~>1.2",
    ">>=1",
    "latest",
    "1.0.0-foo",
    "^",
    "~",
    ">=",
    "1.0 -",
    "1.0-2.0",
    "1.0 - ",
    "^1.0 ||",
    "|| ^1.0",
    "foo",
    "x.y.z",
    "1.0.0@nightly",
    "1.0.0 - 2.0.0 - 3.0.0",
  ];

  it.each(invalid)("throws UnparseableRange for %j", (input) => {
    expect(() => parseComposerCheck(input)).toThrow(UnparseableRange);
    expect(() => parseComposerCheck(input)).toThrow(/cannot parse Composer version or constraint/);
  });

  it("names the input in the error message", () => {
    expect(() => parseComposerCheck("~>1.2")).toThrow('"~>1.2"');
  });
});
