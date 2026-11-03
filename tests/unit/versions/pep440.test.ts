import { describe, expect, it } from "vitest";
import { UnparseableRange } from "../../../src/core/errors.js";
import type { VersionCheck } from "../../../src/core/types.js";
import {
  comparePep440,
  filterPep440Matches,
  isPep440Prerelease,
  parsePep440,
  parsePep440Check,
  type Pep440Version,
} from "../../../src/versions/pep440.js";

type Expected = Omit<Pep440Version, "raw">;

function parsed(input: string): Expected {
  const v = parsePep440(input);
  if (v === null) throw new Error(`expected "${input}" to parse`);
  const { raw, ...rest } = v;
  expect(raw).toBe(input);
  return rest;
}

describe("parsePep440", () => {
  const cases: Array<[string, Expected]> = [
    ["1.0", { epoch: 0, release: [1, 0] }],
    ["1.0.0", { epoch: 0, release: [1, 0, 0] }],
    ["1!2.0", { epoch: 1, release: [2, 0] }],
    ["1.0a1", { epoch: 0, release: [1, 0], pre: ["a", 1] }],
    ["1.0.alpha1", { epoch: 0, release: [1, 0], pre: ["a", 1] }],
    ["1.0b2", { epoch: 0, release: [1, 0], pre: ["b", 2] }],
    ["1.0.beta2", { epoch: 0, release: [1, 0], pre: ["b", 2] }],
    // Valid PEP 440 even though it looks like semver: packaging normalizes it to 1.0.0b0.
    ["1.0.0-beta", { epoch: 0, release: [1, 0, 0], pre: ["b", 0] }],
    ["1.0rc1", { epoch: 0, release: [1, 0], pre: ["rc", 1] }],
    ["1.0c1", { epoch: 0, release: [1, 0], pre: ["rc", 1] }],
    ["1.0.pre1", { epoch: 0, release: [1, 0], pre: ["rc", 1] }],
    ["1.0.preview1", { epoch: 0, release: [1, 0], pre: ["rc", 1] }],
    ["1.0a", { epoch: 0, release: [1, 0], pre: ["a", 0] }],
    ["1.0.post1", { epoch: 0, release: [1, 0], post: 1 }],
    ["1.0-1", { epoch: 0, release: [1, 0], post: 1 }],
    ["1.0.rev1", { epoch: 0, release: [1, 0], post: 1 }],
    ["1.0r1", { epoch: 0, release: [1, 0], post: 1 }],
    ["1.0.post", { epoch: 0, release: [1, 0], post: 0 }],
    ["1.0.dev1", { epoch: 0, release: [1, 0], dev: 1 }],
    ["1.0dev", { epoch: 0, release: [1, 0], dev: 0 }],
    ["1.0+local.1", { epoch: 0, release: [1, 0], local: ["local", 1] }],
    ["1.0+ubuntu-2", { epoch: 0, release: [1, 0], local: ["ubuntu", 2] }],
    ["v1.0", { epoch: 0, release: [1, 0] }],
    ["V1.0", { epoch: 0, release: [1, 0] }],
    ["1.0RC1", { epoch: 0, release: [1, 0], pre: ["rc", 1] }],
    ["1.0.Alpha1", { epoch: 0, release: [1, 0], pre: ["a", 1] }],
    ["1.0.POST1", { epoch: 0, release: [1, 0], post: 1 }],
    ["1.0.DEV1", { epoch: 0, release: [1, 0], dev: 1 }],
    ["1.0+Local.A", { epoch: 0, release: [1, 0], local: ["local", "a"] }],
    [" 1.0 ", { epoch: 0, release: [1, 0] }],
    ["01.02", { epoch: 0, release: [1, 2] }],
    [
      "2!1.2.3a4.post5.dev6+l.7",
      { epoch: 2, release: [1, 2, 3], pre: ["a", 4], post: 5, dev: 6, local: ["l", 7] },
    ],
  ];

  it.each(cases)("parses %j", (input, expected) => {
    expect(parsed(input)).toEqual(expected);
  });

  const invalid = [
    "latest",
    "1.0.0-foo",
    "1.0.0-SNAPSHOT",
    "^1.0",
    "1.x",
    "",
    "1.0.0.",
    ".1",
    "1.0+",
    "a1",
    "1.0-",
  ];

  it.each(invalid)("returns null for %j", (input) => {
    expect(parsePep440(input)).toBeNull();
  });

  it("returns an object without undefined-valued optional keys", () => {
    const v = parsePep440("1.0");
    expect(v).not.toBeNull();
    expect(Object.keys(v!).sort()).toEqual(["epoch", "raw", "release"]);
  });
});

describe("comparePep440", () => {
  const ascending = ["1.0.dev1", "1.0a1", "1.0b1", "1.0rc1", "1.0", "1.0.post1", "1.1"];

  it("orders dev < a < b < rc < final < post < next release", () => {
    for (let i = 0; i < ascending.length - 1; i++) {
      const lower = ascending[i]!;
      const higher = ascending[i + 1]!;
      expect(comparePep440(lower, higher), `${lower} < ${higher}`).toBeLessThan(0);
      expect(comparePep440(higher, lower), `${higher} > ${lower}`).toBeGreaterThan(0);
    }
  });

  const less: Array<[string, string]> = [
    ["1.0a1.dev1", "1.0a1"],
    ["1.0a1", "1.0a1.post1"],
    ["1.0a1.post1", "1.0a2"],
    ["1.0.post1.dev1", "1.0.post1"],
    ["1.0", "1.0.post1.dev1"],
    ["2.0", "1!1.0"],
    ["1.0", "1.0+a"],
    ["1.0+a.1", "1.0+a.2"],
    ["1.0+a.b", "1.0+a.1"],
    ["1.0+a", "1.0+a.1"],
    ["1.0+a", "1.0+9"],
    ["1.0.post1", "1.0.post2"],
    ["1.0.dev2", "1.0.dev10"],
    ["1.0a2", "1.0a10"],
    ["1.9", "1.10"],
    ["0.9.9", "1.0"],
    ["1.0", "1.0.1"],
    ["1.0.post1", "1.1.dev1"],
  ];

  it.each(less)("%s < %s", (a, b) => {
    expect(comparePep440(a, b)).toBeLessThan(0);
    expect(comparePep440(b, a)).toBeGreaterThan(0);
  });

  const equal: Array<[string, string]> = [
    ["1.0", "1.0.0"],
    ["1.0", "1.0.0.0"],
    ["1.0", "v1.0"],
    ["1.0rc1", "1.0.preview1"],
    ["1.0a1", "1.0.ALPHA1"],
    ["1.0.post1", "1.0-1"],
    ["1.0+a.1", "1.0+A-1"],
    ["0!1.0", "1.0"],
    ["1.0.0.post1", "1.0.post1"],
  ];

  it.each(equal)("%s == %s", (a, b) => {
    expect(comparePep440(a, b)).toBe(0);
    expect(comparePep440(b, a)).toBe(0);
  });

  it("accepts parsed versions as well as strings", () => {
    const a = parsePep440("1.0")!;
    const b = parsePep440("1.1")!;
    expect(comparePep440(a, b)).toBeLessThan(0);
    expect(comparePep440(a, "1.1")).toBeLessThan(0);
    expect(comparePep440("1.1", a)).toBeGreaterThan(0);
  });

  it("throws UnparseableRange when a string does not parse", () => {
    expect(() => comparePep440("latest", "1.0")).toThrow(UnparseableRange);
    expect(() => comparePep440("1.0", "1.x")).toThrow(UnparseableRange);
    expect(() => comparePep440("1.0", "1.x")).toThrow(/1\.x/);
  });

  it("sorts a list into PEP 440 order", () => {
    const input = [
      "1.0",
      "1.0.post1",
      "1.0rc1",
      "1!0.1",
      "1.0.dev1",
      "1.0+local",
      "1.0b1",
      "1.0a1",
    ];
    const sorted = [...input].sort(comparePep440);
    expect(sorted).toEqual([
      "1.0.dev1",
      "1.0a1",
      "1.0b1",
      "1.0rc1",
      "1.0",
      "1.0+local",
      "1.0.post1",
      "1!0.1",
    ]);
  });
});

describe("isPep440Prerelease", () => {
  const prerelease = [
    "1.0a1",
    "1.0b1",
    "1.0rc1",
    "1.0.dev1",
    "1.0a1.post1",
    "1.0.post1.dev1",
    "1.0rc1+local",
  ];

  it.each(prerelease)("%s is a pre-release", (v) => {
    expect(isPep440Prerelease(v)).toBe(true);
    expect(isPep440Prerelease(parsePep440(v)!)).toBe(true);
  });

  const final = ["1.0", "1.0.0", "1!1.0", "1.0.post1", "1.0-1", "1.0+local.1"];

  it.each(final)("%s is not a pre-release", (v) => {
    expect(isPep440Prerelease(v)).toBe(false);
    expect(isPep440Prerelease(parsePep440(v)!)).toBe(false);
  });

  it("throws UnparseableRange for an invalid string", () => {
    expect(() => isPep440Prerelease("latest")).toThrow(UnparseableRange);
  });
});

/** Parses `spec` as a specifier set and asks whether `version` matches it. */
function matches(spec: string, version: string): boolean {
  const check = parsePep440Check(spec);
  if (check.kind !== "range") throw new Error(`expected "${spec}" to be a range`);
  return check.matches(version);
}

describe("parsePep440Check", () => {
  it("returns an exact check for a bare version", () => {
    expect(parsePep440Check("2.31.0")).toEqual({ kind: "exact", version: "2.31.0" });
    expect(parsePep440Check(" 2.31.0 ")).toEqual({ kind: "exact", version: "2.31.0" });
    expect(parsePep440Check("1.0rc1")).toEqual({ kind: "exact", version: "1.0rc1" });
    expect(parsePep440Check("v1.0")).toEqual({ kind: "exact", version: "v1.0" });
  });

  it("returns a range check for a specifier set", () => {
    const check: VersionCheck = parsePep440Check(">=2.0,<3");
    expect(check.kind).toBe("range");
  });

  const cases: Array<[spec: string, version: string, expected: boolean]> = [
    // == with zero padding; the local label is ignored unless the specifier has one.
    ["==2.31.0", "2.31.0", true],
    ["==2.31.0", "2.31.1", false],
    ["==2.31.0", "2.31", true],
    ["==1.0", "1.0.0", true],
    ["==1.0", "1.0.post1", false],
    ["==1.0", "1.0+local", true],
    ["==1.0+local", "1.0", false],
    ["==1.0+local", "1.0+LOCAL", true],
    ["==2.0a1", "2.0a1", true],
    ["==2.0a1", "2.0a1+local", true],
    // ==X.* prefix matching on the zero-padded release segment, epoch included.
    ["==2.*", "2.32.5", true],
    ["==2.*", "3.0.0", false],
    ["==2.*", "2", true],
    ["==2.0.*", "2", true],
    ["==2.0.*", "2.0.1", true],
    ["==2.0.*", "2.1", false],
    ["==2.*", "2.0.post1", true],
    ["==2.*", "2.0+local", true],
    ["==2.*", "1!2.0", false],
    ["==1!2.*", "1!2.0", true],
    // ~= compatible release.
    ["~=2.31", "2.31.0", true],
    ["~=2.31", "2.34.2", true],
    ["~=2.31", "3.0.0", false],
    ["~=2.31", "2.30.0", false],
    ["~=2.31.1", "2.31.5", true],
    ["~=2.31.1", "2.32.0", false],
    ["~=2.31.1", "2.31.0", false],
    ["~=1!2.0", "1!2.5", true],
    ["~=1!2.0", "2.5", false],
    ["~=2.31.0a1", "2.31.0a2", true],
    ["~=2.31.0a1", "2.31.0", true],
    ["~=2.31.0a1", "2.32.0", false],
    // != and !=X.*.
    ["!=2.32.0", "2.32.0", false],
    ["!=2.32.0", "2.32.1", true],
    ["!=2.32.0", "1.0", true],
    ["!=2.*", "2.5", false],
    ["!=2.*", "3.0", true],
    // >V excludes post-releases and locals of V unless V is itself a post-release.
    [">2.0", "2.0.post1", false],
    [">2.0", "2.0.1", true],
    [">2.0", "2.0", false],
    [">2.0", "2.0+local", false],
    [">2.0", "2.1+local", true],
    [">2.0.post1", "2.0.post2", true],
    [">2.0.post1", "2.0.post1+local", false],
    [">2.0a1", "2.0a1.post1", false],
    [">2.0a1", "2.0a2+local", true],
    // <V excludes pre-releases of V unless V is itself a pre-release.
    ["<2.0", "2.0rc1", false],
    ["<2.0", "2.0.dev1", false],
    ["<2.0", "1.9", true],
    ["<2.0", "2.0", false],
    ["<2.0rc2", "2.0rc1", true],
    ["<2.0rc2", "1.9", true],
    ["<2.0rc2", "2.0rc2", false],
    ["<2.0.post1", "2.0", true],
    // <= and >= compare the public version (local label stripped).
    ["<=2.0", "2.0", true],
    ["<=2.0", "2.0+local", true],
    ["<=2.0", "2.0.post1", false],
    [">=2.0", "2.0+local", true],
    [">=2.0", "1.9", false],
    // Pre-releases match only when some clause names a pre-release.
    [">=1.0a1", "1.0a2", true],
    [">=1.0a1", "1.0", true],
    [">=1.0a1", "1.0a1", true],
    [">=1.0a1", "1.0.dev1", false],
    [">=1.0", "1.1rc1", false],
    [">=1.0", "1.1", true],
    ["<=2.0", "2.0rc1", false],
    ["!=2.0rc1", "2.0rc2", false],
    ["==2.*", "2.0a1", false],
    [">=1.0a1,<2.0", "1.5b1", true],
    [">=1.0,<2.0b1", "2.0a1", true],
    ["===1.0a1", "1.0a1", true],
    // === is case-insensitive string equality against the raw version.
    ["===2.31.0", "2.31.0", true],
    ["===2.31.0", "2.31", false],
    ["===2.31.0", "2.31.0.0", false],
    ["===2.31.0", "v2.31.0", false],
    ["===1.0RC1", "1.0rc1", true],
    // Comma-AND, whitespace tolerance and a leading v in the specifier.
    [">=1.0,!=1.5,<2", "1.5", false],
    [">=1.0,!=1.5,<2", "1.6", true],
    ["== 2.31.0", "2.31.0", true],
    [">=2.0 , <3", "2.5", true],
    [" >=2.0 , <3 ", "3.0", false],
    ["==v2.0", "2.0", true],
    [">=V2.0", "2.0", true],
  ];

  it.each(cases)("%j matches %j -> %s", (spec, version, expected) => {
    expect(matches(spec, version)).toBe(expected);
  });

  it(">=2.0,<2.20 picks 2.19.1 as the highest matching version", () => {
    const check = parsePep440Check(">=2.0,<2.20");
    if (check.kind !== "range") throw new Error("expected a range");
    const highest = ["1.9", "2.0", "2.19.1", "2.20.0"]
      .filter((v) => check.matches(v))
      .sort(comparePep440)
      .at(-1);
    expect(highest).toBe("2.19.1");
  });

  it("never matches a candidate that is not a PEP 440 version, except through ===", () => {
    expect(matches(">=1.0", "latest")).toBe(false);
    expect(matches("===latest", "latest")).toBe(true);
    expect(matches("===latest,>=1.0", "latest")).toBe(false);
  });

  const invalid = [
    ">>=1",
    "~=2",
    "==2.*.*",
    "==*",
    "==.*",
    "==2.0.*.0",
    "",
    "   ",
    ",",
    ">=1.0,",
    ">=1.0,,<2",
    "^1.0",
    "1.x",
    "latest",
    "==2.*+local",
    "==2.0.dev1.*",
    "==2.0a1.*",
    "==2.0.post1.*",
    "~=2.0.*",
    ">=2.*",
    "===",
    ">=1.0+local",
    "~=1.0+local",
    ">= 1.0 < 2.0",
    "=1.0",
    "== 2.0 .*",
    ">=1.0;",
  ];

  it.each(invalid)("throws UnparseableRange for %j", (input) => {
    expect(() => parsePep440Check(input)).toThrow(UnparseableRange);
    expect(() => parsePep440Check(input)).toThrow(
      `cannot parse PyPI version or specifier "${input}"`,
    );
  });
});

describe("filterPep440Matches", () => {
  const cases: Array<[spec: string, versions: string[], expected: string[]]> = [
    // Only pre-releases match: they are returned as the fallback.
    [">=1.0", ["1.1a1", "1.1rc1"], ["1.1a1", "1.1rc1"]],
    // A final matches: the pre-releases are dropped.
    [">=1.0", ["1.1a1", "1.0"], ["1.0"]],
    // Nothing matches at all (1.0a1 and 1.0rc1 sort below 1.0).
    [">=1.0", ["1.0a1", "1.0rc1"], []],
    [">=1.0,<3", ["1.1a1", "3.0"], ["1.1a1"]],
    ["!=2.32.0", ["1.0a1"], ["1.0a1"]],
    [">=2.0,<2.20", ["1.9", "2.0", "2.19.1", "2.20.0"], ["2.0", "2.19.1"]],
    // A clause naming a pre-release lets finals and pre-releases through together.
    ["<2.0rc2", ["1.9", "2.0rc1"], ["1.9", "2.0rc1"]],
    [">=1.0a1", ["1.0a1", "1.0", "1.1b1"], ["1.0a1", "1.0", "1.1b1"]],
    // Input order is preserved.
    [">=1.0", ["1.2", "1.0", "1.1"], ["1.2", "1.0", "1.1"]],
    [">=1.0", ["1.2b1", "1.1a1"], ["1.2b1", "1.1a1"]],
  ];

  it.each(cases)("%j over %j -> %j", (spec, versions, expected) => {
    expect(filterPep440Matches(versions, parsePep440Check(spec))).toEqual(expected);
  });

  it("filters an exact check by PEP 440 equality", () => {
    const check = parsePep440Check("2.31.0");
    expect(filterPep440Matches(["2.31", "2.31.0", "2.31.1", "2.31.0rc1"], check)).toEqual([
      "2.31",
      "2.31.0",
    ]);
    expect(filterPep440Matches(["1.0a1", "1.0"], parsePep440Check("1.0a1"))).toEqual(["1.0a1"]);
  });

  it("skips candidates that are not PEP 440 versions unless === names them", () => {
    expect(filterPep440Matches(["latest", "1.0"], parsePep440Check(">=1.0"))).toEqual(["1.0"]);
    expect(filterPep440Matches(["latest", "1.0"], parsePep440Check("===latest"))).toEqual([
      "latest",
    ]);
  });

  it("falls back to matches() for a range check it did not build", () => {
    const foreign: VersionCheck = { kind: "range", matches: (v) => v.startsWith("1.") };
    expect(filterPep440Matches(["1.0", "2.0", "1.1a1"], foreign)).toEqual(["1.0", "1.1a1"]);
  });
});
