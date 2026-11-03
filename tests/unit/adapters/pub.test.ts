import { describe, expect, it } from "vitest";
import { pubAdapter } from "../../../src/adapters/pub.js";
import { InvalidName, RegistryError, UnparseableRange } from "../../../src/core/errors.js";
import { stubFetchJson } from "../../helpers/stub-fetch.js";

describe("pub adapter: normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(pubAdapter.normalizeName(" http ")).toBe("http");
  });

  it("accepts lowercase identifiers with underscores and digits", () => {
    expect(pubAdapter.normalizeName("flutter_bloc2")).toBe("flutter_bloc2");
  });

  it.each(["", "Http", "bad-name", "1abc", "a.b"])("rejects %j with InvalidName", (raw) => {
    expect(() => pubAdapter.normalizeName(raw)).toThrow(InvalidName);
  });
});

describe("pub adapter: fetch", () => {
  it("requests the package document with the v2 Accept header", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/http": { status: 200, fixture: "pub/http.json" },
    });
    const calls: Array<{ url: string; accept?: string }> = [];
    const spy: typeof stub.fetchJson = (url, opts) => {
      calls.push({ url, ...(opts?.accept !== undefined ? { accept: opts.accept } : {}) });
      return stub.fetchJson(url, opts);
    };
    await pubAdapter.fetch("http", spy);
    expect(calls).toEqual([
      { url: "https://pub.dev/api/packages/http", accept: "application/vnd.pub.v2+json" },
    ]);
  });

  it("maps versions, retraction and the stable hint", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/build_runner": {
        status: 200,
        fixture: "pub/build_runner-retracted.json",
      },
    });
    const info = await pubAdapter.fetch("build_runner", stub.fetchJson);
    expect(info.kind).toBe("info");
    if (info.kind !== "info") return;
    expect(info.stableHint).toBe("2.17.1");
    const byVersion = new Map(info.versions.map((v) => [v.version, v]));
    expect(byVersion.get("2.17.0")).toEqual({ version: "2.17.0", prerelease: false, yanked: true });
    expect(byVersion.get("2.17.1")).toEqual({
      version: "2.17.1",
      prerelease: false,
      yanked: false,
    });
  });

  it("marks semver pre-releases and keeps the registry's input order", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/http": { status: 200, fixture: "pub/http.json" },
    });
    const info = await pubAdapter.fetch("http", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    const beta = info.versions.find((v) => v.version === "1.5.0-beta.2");
    expect(beta?.prerelease).toBe(true);
    expect(info.versions[0]?.version).toBe("0.13.0");
  });

  it("omits the stable hint when latest is itself a pre-release", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/only_pre": { status: 200, fixture: "pub/only-prerelease.json" },
    });
    const info = await pubAdapter.fetch("only_pre", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.stableHint).toBeUndefined();
  });

  it("returns not_found on a 404 whose body is XML, without throwing", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/htttp": { status: 404, fixture: "pub/not-found.xml" },
    });
    await expect(pubAdapter.fetch("htttp", stub.fetchJson)).resolves.toEqual({
      kind: "not_found",
      name: "htttp",
    });
  });

  it("throws a malformed RegistryError when versions are missing", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/odd": { status: 200, json: { name: "odd" } },
    });
    const err = await pubAdapter.fetch("odd", stub.fetchJson).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("malformed");
  });
});

describe("pub adapter: ordering", () => {
  it("orders build metadata numerically after semver precedence", () => {
    expect(pubAdapter.compare("1.2.3+2", "1.2.3+1")).toBeGreaterThan(0);
    expect(pubAdapter.compare("1.6.0", "1.5.0-beta.2")).toBeGreaterThan(0);
    expect(pubAdapter.isPrerelease("1.5.0-beta.2")).toBe(true);
    expect(pubAdapter.id).toBe("pub");
  });
});

describe("pub adapter: discontinued packages", () => {
  it("marks a discontinued package deprecated and names the replacement", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/pedantic": { status: 200, fixture: "pub/pedantic.json" },
    });
    const info = await pubAdapter.fetch("pedantic", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toEqual({ message: "discontinued, replaced by lints" });
  });

  it("marks a discontinued package without replacement as plainly discontinued", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/gone": {
        status: 200,
        json: {
          name: "gone",
          isDiscontinued: true,
          latest: { version: "1.0.0" },
          versions: [{ version: "1.0.0" }],
        },
      },
    });
    const info = await pubAdapter.fetch("gone", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toEqual({ message: "discontinued" });
  });

  it("reports every version as yanked for an all-retracted package", async () => {
    const stub = stubFetchJson({
      "https://pub.dev/api/packages/all_retracted": {
        status: 200,
        fixture: "pub/all-retracted.json",
      },
    });
    const info = await pubAdapter.fetch("all_retracted", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.versions.every((v) => v.yanked)).toBe(true);
    expect(info.deprecated).toBeUndefined();
  });
});

describe("pub adapter: version checks", () => {
  it("delegates to the pub dialect of the semver module", () => {
    expect(pubAdapter.parseVersionOrRange("1.0.0")).toEqual({ kind: "exact", version: "1.0.0" });
    const check = pubAdapter.parseVersionOrRange(">=0.13.0 <1.0.0");
    if (check.kind !== "range") throw new Error("expected range");
    expect(check.matches("0.13.6")).toBe(true);
    expect(check.matches("1.0.0")).toBe(false);
    expect(() => pubAdapter.parseVersionOrRange("~1.2")).toThrow(UnparseableRange);
  });
});
