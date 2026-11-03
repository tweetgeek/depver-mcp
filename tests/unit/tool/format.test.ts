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
