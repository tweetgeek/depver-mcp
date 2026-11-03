import { describe, expect, it } from "vitest";
import { UnparseableRange } from "../../../src/core/errors.js";
import {
  comparePep440,
  isPep440Prerelease,
  parsePep440,
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
