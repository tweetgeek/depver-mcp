import { describe, expect, it } from "vitest";
import { npmAdapter } from "../../../src/adapters/npm.js";
import { pypiAdapter } from "../../../src/adapters/pypi.js";
import { RegistryError, UnknownEcosystem } from "../../../src/core/errors.js";
import type { VersionInfo } from "../../../src/core/types.js";
import { formatResult, truncateSentence } from "../../../src/tool/format.js";

const query = (name: string, version?: string) => ({
  ecosystem: "npm",
  name,
  ...(version !== undefined ? { version } : {}),
});

const info = (
  versions: VersionInfo["versions"],
  extra: Partial<VersionInfo> = {},
): VersionInfo => ({
  kind: "info",
  name: "pkg",
  versions,
  ...extra,
});

describe("formatResult without a version check", () => {
  it("reports stable and latest from the version list", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info([
        { version: "1.0.0", prerelease: false },
        { version: "1.1.0", prerelease: false },
        { version: "1.2.0-beta.1", prerelease: true },
      ]),
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "ok", stable: "1.1.0", latest: "1.2.0-beta.1" });
  });

  it("prefers the registry's stable hint when it is not a pre-release", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info(
        [
          { version: "1.0.0", prerelease: false },
          { version: "2.0.0", prerelease: false },
        ],
        { stableHint: "1.0.0" },
      ),
      npmAdapter,
    );
    expect(out.stable).toBe("1.0.0");
    expect(out.latest).toBe("2.0.0");
  });

  it("ignores a stable hint that points at a pre-release", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info(
        [
          { version: "1.0.0", prerelease: false },
          { version: "1.1.0-rc.1", prerelease: true },
        ],
        { stableHint: "1.1.0-rc.1" },
      ),
      npmAdapter,
    );
    expect(out.stable).toBe("1.0.0");
  });

  it("returns both keys even when stable and latest are equal", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info([{ version: "1.0.0", prerelease: false }]),
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "ok", stable: "1.0.0", latest: "1.0.0" });
  });

  it("never lets a yanked version become stable or latest", () => {
    const out = formatResult(
      query("pkg"),
      "pypi",
      "pkg",
      info([
        { version: "1.0.0", prerelease: false, yanked: false },
        { version: "1.1.0", prerelease: false, yanked: true },
      ]),
      pypiAdapter,
    );
    expect(out).toEqual({ e: "pypi", n: "pkg", s: "ok", stable: "1.0.0", latest: "1.0.0" });
  });

  it("omits stable when only pre-releases exist", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info([{ version: "0.1.0-beta.1", prerelease: true }]),
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "ok", latest: "0.1.0-beta.1" });
    expect("stable" in out).toBe(false);
  });

  it("reports ok with no versions and a message when every version is yanked", () => {
    const out = formatResult(
      query("pkg"),
      "pypi",
      "pkg",
      info([
        { version: "1.0.0", prerelease: false, yanked: true },
        { version: "1.1.0", prerelease: false, yanked: true },
      ]),
      pypiAdapter,
    );
    expect(out).toEqual({ e: "pypi", n: "pkg", s: "ok", msg: "all versions yanked" });
  });

  it("reports not_found without a message when the registry gives no reason", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      { kind: "not_found", name: "pkg" },
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "not_found" });
  });

  it("carries the registry's reason for not_found in msg", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      { kind: "not_found", name: "pkg", reason: "unpublished from npm" },
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "not_found", msg: "unpublished from npm" });
  });

  it("reports a registry timeout as error with the timeout message", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      new RegistryError("timeout", "registry timeout after 8000 ms"),
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "error", msg: "registry timeout after 8000 ms" });
  });

  it("reports an unknown ecosystem as error, echoing the raw ecosystem and name", () => {
    const out = formatResult(
      { ecosystem: "cargo", name: "serde" },
      undefined,
      undefined,
      new UnknownEcosystem("cargo"),
      undefined,
    );
    expect(out).toEqual({
      e: "cargo",
      n: "serde",
      s: "error",
      msg: 'unknown ecosystem "cargo"; supported: npm, pypi, pub, packagist',
    });
  });

  it("reports any other thrown value as a generic error", () => {
    const out = formatResult(query("pkg"), "npm", "pkg", new Error("kaboom"), npmAdapter);
    expect(out).toEqual({ e: "npm", n: "pkg", s: "error", msg: "kaboom" });
  });

  it("never emits undefined, null or empty-string values", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info([{ version: "1.0.0", prerelease: false }]),
      npmAdapter,
    );
    for (const value of Object.values(out)) {
      expect(value).not.toBeUndefined();
      expect(value).not.toBeNull();
      expect(value).not.toBe("");
    }
  });
});

describe("truncateSentence", () => {
  it("cuts at the first sentence boundary", () => {
    expect(truncateSentence("Use padStart instead. See the README for details.", 160)).toBe(
      "Use padStart instead.",
    );
  });

  it("keeps a URL with dots intact when no sentence boundary follows", () => {
    expect(
      truncateSentence(
        "request has been deprecated, see https://github.com/request/request/issues/3142",
        160,
      ),
    ).toBe("request has been deprecated, see https://github.com/request/request/issues/3142");
  });

  it("caps the length and collapses whitespace", () => {
    const long = "word ".repeat(100);
    const out = truncateSentence(long + "\n\nmore", 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).not.toMatch(/\s{2}/);
  });
});

describe("formatResult for deprecated packages", () => {
  it("reports deprecated with versions and a one-sentence message", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info([{ version: "2.88.2", prerelease: false }], {
        deprecated: {
          message:
            "request has been deprecated, see https://github.com/request/request/issues/3142. Please migrate.",
        },
      }),
      npmAdapter,
    );
    expect(out).toEqual({
      e: "npm",
      n: "pkg",
      s: "deprecated",
      stable: "2.88.2",
      latest: "2.88.2",
      msg: "request has been deprecated, see https://github.com/request/request/issues/3142.",
    });
  });

  it("caps a run-on deprecation message at 160 characters", () => {
    const out = formatResult(
      query("pkg"),
      "npm",
      "pkg",
      info([{ version: "1.0.0", prerelease: false }], { deprecated: { message: "x".repeat(500) } }),
      npmAdapter,
    );
    expect(out.msg?.length).toBe(160);
  });

  it("lets deprecation win over the all-yanked message", () => {
    const out = formatResult(
      query("pkg"),
      "pypi",
      "pkg",
      info([{ version: "1.0.0", prerelease: false, yanked: true }], {
        deprecated: { message: "project marked deprecated on PyPI" },
      }),
      pypiAdapter,
    );
    expect(out).toEqual({
      e: "pypi",
      n: "pkg",
      s: "deprecated",
      msg: "project marked deprecated on PyPI",
    });
  });
});

describe("formatResult with a version check", () => {
  const versions = [
    { version: "17.0.2", prerelease: false },
    { version: "18.2.0", prerelease: false, deprecated: "please upgrade" },
    { version: "18.3.1", prerelease: false },
    { version: "19.0.0-rc.1", prerelease: true },
    { version: "19.0.0", prerelease: false },
  ];

  it("echoes the version and reports v_exists for a published exact version", () => {
    const out = formatResult(query("pkg", "18.3.1"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toEqual({
      e: "npm",
      n: "pkg",
      s: "ok",
      stable: "19.0.0",
      latest: "19.0.0",
      v: "18.3.1",
      v_exists: true,
    });
  });

  it("reports v_exists false for a missing exact version while keeping stable and latest", () => {
    const out = formatResult(query("pkg", "18.99.0"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toMatchObject({
      s: "ok",
      stable: "19.0.0",
      latest: "19.0.0",
      v: "18.99.0",
      v_exists: false,
    });
  });

  it("reports v_deprecated for an exact npm version carrying a notice, with status still ok", () => {
    const out = formatResult(query("pkg", "18.2.0"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toMatchObject({ s: "ok", v: "18.2.0", v_exists: true, v_deprecated: true });
    expect("v_yanked" in out).toBe(false);
  });

  it("reports v_yanked for an exact PyPI version and omits v_deprecated", () => {
    const out = formatResult(
      { ecosystem: "pypi", name: "pkg", version: "2.32.0" },
      "pypi",
      "pkg",
      info([
        { version: "2.32.0", prerelease: false, yanked: true },
        { version: "2.32.5", prerelease: false, yanked: false },
      ]),
      pypiAdapter,
    );
    expect(out).toEqual({
      e: "pypi",
      n: "pkg",
      s: "ok",
      stable: "2.32.5",
      latest: "2.32.5",
      v: "2.32.0",
      v_exists: true,
      v_yanked: true,
    });
  });

  it("matches an exact version loosely across equivalent spellings", () => {
    const out = formatResult(query("pkg", "v18.3.1"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toMatchObject({ v: "v18.3.1", v_exists: true });
  });

  it("resolves a range to the highest stable, non-yanked match", () => {
    const out = formatResult(query("pkg", "^18"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toEqual({
      e: "npm",
      n: "pkg",
      s: "ok",
      stable: "19.0.0",
      latest: "19.0.0",
      v: "^18",
      v_match: "18.3.1",
    });
  });

  it("never resolves a range to a pre-release or a yanked version", () => {
    const out = formatResult(
      { ecosystem: "pypi", name: "pkg", version: ">=2.0" },
      "pypi",
      "pkg",
      info([
        { version: "2.0.0", prerelease: false, yanked: false },
        { version: "2.1.0", prerelease: false, yanked: true },
        { version: "2.2.0rc1", prerelease: true, yanked: false },
      ]),
      pypiAdapter,
    );
    expect(out.v_match).toBe("2.0.0");
  });

  it("reports v_match null when nothing satisfies the range", () => {
    const out = formatResult(query("pkg", "^99"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toMatchObject({ s: "ok", v: "^99", v_match: null });
    expect("v_match" in out).toBe(true);
  });

  it("turns an unparseable range into error for the item with a one-sentence message", () => {
    const out = formatResult(query("pkg", ">>=1"), "npm", "pkg", info(versions), npmAdapter);
    expect(out).toEqual({
      e: "npm",
      n: "pkg",
      s: "error",
      v: ">>=1",
      msg: 'cannot parse npm version or range ">>=1"',
    });
  });

  it("keeps the deprecated status when a version check is present", () => {
    const out = formatResult(
      query("pkg", "18.3.1"),
      "npm",
      "pkg",
      info(versions, { deprecated: { message: "dead" } }),
      npmAdapter,
    );
    expect(out).toMatchObject({ s: "deprecated", msg: "dead", v: "18.3.1", v_exists: true });
  });

  it("adds no version keys for not_found even when a version was asked", () => {
    const out = formatResult(
      query("pkg", "1.0.0"),
      "npm",
      "pkg",
      { kind: "not_found", name: "pkg" },
      npmAdapter,
    );
    expect(out).toEqual({ e: "npm", n: "pkg", s: "not_found", v: "1.0.0" });
  });
});
