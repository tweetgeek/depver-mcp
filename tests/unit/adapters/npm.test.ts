import { describe, expect, it } from "vitest";
import { npmAdapter } from "../../../src/adapters/npm.js";
import { InvalidName, RegistryError, UnparseableRange } from "../../../src/core/errors.js";
import { stubFetchJson } from "../../helpers/stub-fetch.js";

const ACCEPT = "application/vnd.npm.install-v1+json";

describe("npm adapter: normalizeName", () => {
  it("lowercases and trims plain names", () => {
    expect(npmAdapter.normalizeName(" React ")).toBe("react");
  });

  it("keeps the scope of scoped names", () => {
    expect(npmAdapter.normalizeName("@types/node")).toBe("@types/node");
  });

  it.each(["", "a b", ".dot", "@scope", "@/x", "a/b", "name!"])(
    "rejects %j with InvalidName",
    (raw) => {
      expect(() => npmAdapter.normalizeName(raw)).toThrow(InvalidName);
    },
  );
});

describe("npm adapter: fetch", () => {
  it("requests the abbreviated document with the slash of a scoped name encoded", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/@types%2Fnode": { status: 200, fixture: "npm/react-abbrev.json" },
    });
    const calls: Array<{ url: string; accept?: string }> = [];
    const spy: typeof stub.fetchJson = (url, opts) => {
      calls.push({ url, ...(opts?.accept !== undefined ? { accept: opts.accept } : {}) });
      return stub.fetchJson(url, opts);
    };
    await npmAdapter.fetch("@types/node", spy);
    expect(calls).toEqual([{ url: "https://registry.npmjs.org/@types%2Fnode", accept: ACCEPT }]);
  });

  it("maps the abbreviated document to VersionInfo", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/react": { status: 200, fixture: "npm/react-abbrev.json" },
    });
    const info = await npmAdapter.fetch("react", stub.fetchJson);
    expect(info.kind).toBe("info");
    if (info.kind !== "info") return;
    expect(info.name).toBe("react");
    expect(info.stableHint).toBe("19.3.1");
    const byVersion = new Map(info.versions.map((v) => [v.version, v]));
    expect(byVersion.get("19.2.0")).toEqual({ version: "19.2.0", prerelease: false });
    expect(byVersion.get("19.0.0-rc-65e06cb7-20241218")?.prerelease).toBe(true);
    expect(byVersion.get("0.7.1")?.deprecated).toMatch(/\S/);
    expect(byVersion.get("19.2.0")?.deprecated).toBeUndefined();
    expect(byVersion.get("19.2.0")?.yanked).toBeUndefined();
  });

  it("returns not_found on 404 with the registry's not-found body", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/nope": { status: 404, fixture: "npm/not-found.json" },
    });
    await expect(npmAdapter.fetch("nope", stub.fetchJson)).resolves.toEqual({
      kind: "not_found",
      name: "nope",
    });
  });

  it("returns not_found with an unpublished reason when a 200 document has no versions", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/unpublish-me": { status: 200, fixture: "npm/unpublished.json" },
    });
    await expect(npmAdapter.fetch("unpublish-me", stub.fetchJson)).resolves.toEqual({
      kind: "not_found",
      name: "unpublish-me",
      reason: "unpublished from npm",
    });
  });

  it("throws a malformed RegistryError when the body is not an object", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/weird": { status: 200, json: [1, 2] },
    });
    const err = await npmAdapter.fetch("weird", stub.fetchJson).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("malformed");
  });

  it("throws a malformed RegistryError on an unexpected status", async () => {
    const stub = stubFetchJson({ "https://registry.npmjs.org/odd": { status: 302, json: null } });
    const err = await npmAdapter.fetch("odd", stub.fetchJson).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
  });
});

describe("npm adapter: ordering", () => {
  it("uses semver ordering and pre-release detection", () => {
    expect(npmAdapter.compare("19.2.0", "19.0.0-rc.1")).toBeGreaterThan(0);
    expect(npmAdapter.isPrerelease("19.0.0-rc.1")).toBe(true);
    expect(npmAdapter.isPrerelease("19.2.0")).toBe(false);
  });

  it("declares a concurrency limit of 6", () => {
    expect(npmAdapter.concurrency).toBe(6);
    expect(npmAdapter.id).toBe("npm");
  });
});

describe("npm adapter: package-level deprecation", () => {
  it("marks the package deprecated when the latest-tagged version carries a deprecation message", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/request": { status: 200, fixture: "npm/request-abbrev.json" },
    });
    const info = await npmAdapter.fetch("request", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated?.message).toMatch(/^request has been deprecated/);
  });

  it("does not mark the package deprecated when only an old version is deprecated", async () => {
    const stub = stubFetchJson({
      "https://registry.npmjs.org/old-dep": {
        status: 200,
        fixture: "npm/old-version-deprecated.json",
      },
    });
    const info = await npmAdapter.fetch("old-dep", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toBeUndefined();
    expect(info.versions.find((v) => v.version === "1.0.0")?.deprecated).toMatch(
      /no longer supported/,
    );
  });
});

describe("npm adapter: version checks", () => {
  it("delegates exact versions and node-semver ranges to the semver module", () => {
    expect(npmAdapter.parseVersionOrRange("18.2.0")).toEqual({ kind: "exact", version: "18.2.0" });
    const check = npmAdapter.parseVersionOrRange("^18");
    if (check.kind !== "range") throw new Error("expected range");
    expect(check.matches("18.3.1")).toBe(true);
    expect(check.matches("19.0.0")).toBe(false);
    expect(() => npmAdapter.parseVersionOrRange("latest")).toThrow(UnparseableRange);
  });
});
