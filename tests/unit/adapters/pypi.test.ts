import { describe, expect, it } from "vitest";
import { pypiAdapter } from "../../../src/adapters/pypi.js";
import { InvalidName, RegistryError, UnparseableRange } from "../../../src/core/errors.js";
import { stubFetchJson } from "../../helpers/stub-fetch.js";

const ACCEPT = "application/vnd.pypi.simple.v1+json";

describe("pypi adapter: normalizeName", () => {
  it.each([
    ["Typing_Extensions", "typing-extensions"],
    ["zope.interface", "zope-interface"],
    [" Requests ", "requests"],
    ["a__b--c..d", "a-b-c-d"],
  ])("normalizes %j to %j per PEP 503", (raw, expected) => {
    expect(pypiAdapter.normalizeName(raw)).toBe(expected);
  });

  it.each(["", "-bad", "bad-", "a b", "näme"])("rejects %j with InvalidName", (raw) => {
    expect(() => pypiAdapter.normalizeName(raw)).toThrow(InvalidName);
  });
});

describe("pypi adapter: fetch", () => {
  it("requests the Simple API JSON form for the normalized name", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/requests/": { status: 200, fixture: "pypi/requests-simple.json" },
    });
    const calls: Array<{ url: string; accept?: string }> = [];
    const spy: typeof stub.fetchJson = (url, opts) => {
      calls.push({ url, ...(opts?.accept !== undefined ? { accept: opts.accept } : {}) });
      return stub.fetchJson(url, opts);
    };
    await pypiAdapter.fetch("requests", spy);
    expect(calls).toEqual([{ url: "https://pypi.org/simple/requests/", accept: ACCEPT }]);
  });

  it("derives versions from the PEP 700 list and yanked from the files", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/requests/": { status: 200, fixture: "pypi/requests-simple.json" },
    });
    const info = await pypiAdapter.fetch("requests", stub.fetchJson);
    expect(info.kind).toBe("info");
    if (info.kind !== "info") return;
    expect(info.name).toBe("requests");
    expect(info.stableHint).toBeUndefined();
    const byVersion = new Map(info.versions.map((v) => [v.version, v]));
    expect([...byVersion.keys()]).toEqual(["2.19.1", "2.31.0", "2.32.0", "2.32.5"]);
    expect(byVersion.get("2.32.0")).toEqual({ version: "2.32.0", prerelease: false, yanked: true });
    expect(byVersion.get("2.32.5")).toEqual({
      version: "2.32.5",
      prerelease: false,
      yanked: false,
    });
  });

  it("marks PEP 440 pre-releases", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/pre-newest/": {
        status: 200,
        fixture: "pypi/prerelease-newest.json",
      },
    });
    const info = await pypiAdapter.fetch("pre-newest", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.versions.find((v) => v.version === "1.1.0rc1")?.prerelease).toBe(true);
    expect(info.versions.find((v) => v.version === "1.0.0")?.prerelease).toBe(false);
  });

  it("returns not_found on 404", async () => {
    const stub = stubFetchJson({ "https://pypi.org/simple/nope/": { status: 404, json: null } });
    await expect(pypiAdapter.fetch("nope", stub.fetchJson)).resolves.toEqual({
      kind: "not_found",
      name: "nope",
    });
  });

  it("returns not_found with a quarantine reason for quarantined projects", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/quarantined-lib/": { status: 200, fixture: "pypi/quarantined.json" },
    });
    await expect(pypiAdapter.fetch("quarantined-lib", stub.fetchJson)).resolves.toEqual({
      kind: "not_found",
      name: "quarantined-lib",
      reason: "quarantined by PyPI",
    });
  });

  it("throws a malformed RegistryError when the versions list is missing", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/odd/": { status: 200, json: { name: "odd", files: [] } },
    });
    const err = await pypiAdapter.fetch("odd", stub.fetchJson).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("malformed");
  });

  it("skips versions that are not valid PEP 440 instead of failing the package", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/legacy/": {
        status: 200,
        json: { name: "legacy", versions: ["1.0-final", "1.0", "1.1"], files: [] },
      },
    });
    const info = await pypiAdapter.fetch("legacy", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.versions.map((v) => v.version)).toEqual(["1.0", "1.1"]);
  });
});

describe("pypi adapter: ordering", () => {
  it("uses PEP 440 ordering and pre-release detection", () => {
    expect(pypiAdapter.compare("2.32.5", "2.32.0")).toBeGreaterThan(0);
    expect(pypiAdapter.compare("1.0", "1.0.0")).toBe(0);
    expect(pypiAdapter.isPrerelease("1.1.0rc1")).toBe(true);
    expect(pypiAdapter.isPrerelease("1.1.0.post1")).toBe(false);
    expect(pypiAdapter.id).toBe("pypi");
  });
});

describe("pypi adapter: project status and yanked releases", () => {
  it("marks a PEP 792 deprecated project as deprecated", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/old-lib/": { status: 200, fixture: "pypi/deprecated-status.json" },
    });
    const info = await pypiAdapter.fetch("old-lib", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toEqual({ message: "project marked deprecated on PyPI" });
  });

  it("reports every version as yanked when all files are yanked, by flag or by reason string", async () => {
    const stub = stubFetchJson({
      "https://pypi.org/simple/gone-lib/": { status: 200, fixture: "pypi/all-yanked.json" },
    });
    const info = await pypiAdapter.fetch("gone-lib", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.versions.map((v) => [v.version, v.yanked])).toEqual([
      ["1.0.0", true],
      ["1.1.0", true],
    ]);
  });
});

describe("pypi adapter: version checks", () => {
  it("delegates to the PEP 440 specifier parser", () => {
    expect(pypiAdapter.parseVersionOrRange("2.31.0")).toEqual({ kind: "exact", version: "2.31.0" });
    const check = pypiAdapter.parseVersionOrRange("~=2.31");
    if (check.kind !== "range") throw new Error("expected range");
    expect(check.matches("2.34.2")).toBe(true);
    expect(check.matches("3.0.0")).toBe(false);
    expect(() => pypiAdapter.parseVersionOrRange("^1.0")).toThrow(UnparseableRange);
  });
});
