import { describe, expect, it } from "vitest";
import { expandMinified, packagistAdapter } from "../../../src/adapters/packagist.js";
import { InvalidName, RegistryError, UnparseableRange } from "../../../src/core/errors.js";
import { loadFixture, stubFetchJson } from "../../helpers/stub-fetch.js";

describe("packagist adapter: normalizeName", () => {
  it("lowercases vendor/package names", () => {
    expect(packagistAdapter.normalizeName(" Monolog/Monolog ")).toBe("monolog/monolog");
  });

  it.each(["", "monolog", "a/b/c", "/x", "x/", "a b/c", "vendor/pkg!"])(
    "rejects %j with InvalidName",
    (raw) => {
      expect(() => packagistAdapter.normalizeName(raw)).toThrow(InvalidName);
    },
  );
});

describe("expandMinified", () => {
  it("inherits keys from the previous entry and removes keys marked __unset", () => {
    const doc = loadFixture("packagist/minified-unset.json") as {
      packages: Record<string, Array<Record<string, unknown>>>;
    };
    const entries = expandMinified(doc.packages["acme/widget"] ?? []);
    expect(entries).toHaveLength(3);
    expect(entries[1]).toEqual({
      name: "acme/widget",
      version: "1.1.0",
      version_normalized: "1.1.0.0",
      require: { php: ">=8.1" },
    });
    expect(entries[2]?.["require"]).toEqual({ php: ">=8.0" });
    expect(entries[2]?.["extra"]).toBeUndefined();
    expect(entries[2]?.["name"]).toBe("acme/widget");
  });
});

describe("packagist adapter: fetch", () => {
  it("requests the p2 metadata file", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/monolog/monolog.json": {
        status: 200,
        fixture: "packagist/monolog-p2.json",
      },
    });
    await packagistAdapter.fetch("monolog/monolog", stub.fetchJson);
    expect(stub.calls).toEqual(["https://repo.packagist.org/p2/monolog/monolog.json"]);
  });

  it("maps tagged releases with Composer pre-release detection", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/monolog/monolog.json": {
        status: 200,
        fixture: "packagist/monolog-p2.json",
      },
    });
    const info = await packagistAdapter.fetch("monolog/monolog", stub.fetchJson);
    expect(info.kind).toBe("info");
    if (info.kind !== "info") return;
    expect(info.name).toBe("monolog/monolog");
    expect(info.stableHint).toBeUndefined();
    const byVersion = new Map(info.versions.map((v) => [v.version, v]));
    expect(byVersion.get("3.0.0-RC1")).toEqual({ version: "3.0.0-RC1", prerelease: true });
    expect(byVersion.get("3.12.1")).toEqual({ version: "3.12.1", prerelease: false });
    expect(byVersion.get("3.12.1")?.yanked).toBeUndefined();
  });

  it("sees a release candidate as newest when the registry lists one first", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/acme/next.json": {
        status: 200,
        fixture: "packagist/prerelease-newest.json",
      },
    });
    const info = await packagistAdapter.fetch("acme/next", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    const sorted = [...info.versions].sort((a, b) =>
      packagistAdapter.compare(a.version, b.version),
    );
    expect(sorted.at(-1)?.version).toBe("2.1.0-RC1");
    expect(sorted.at(-1)?.prerelease).toBe(true);
    expect(sorted.filter((v) => !v.prerelease).at(-1)?.version).toBe("2.0.0");
  });

  it("returns not_found on 404", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/zz/nope.json": {
        status: 404,
        fixture: "packagist/not-found.txt",
      },
    });
    await expect(packagistAdapter.fetch("zz/nope", stub.fetchJson)).resolves.toEqual({
      kind: "not_found",
      name: "zz/nope",
    });
  });

  it("throws a malformed RegistryError when the package key is missing", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/a/b.json": {
        status: 200,
        json: { minified: "composer/2.0", packages: {} },
      },
    });
    const err = await packagistAdapter.fetch("a/b", stub.fetchJson).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("malformed");
  });
});

describe("packagist adapter: ordering", () => {
  it("uses Composer ordering", () => {
    expect(packagistAdapter.compare("v3.12.1", "3.0.0-RC1")).toBeGreaterThan(0);
    expect(packagistAdapter.compare("1.0.0-patch1", "1.0.0")).toBeGreaterThan(0);
    expect(packagistAdapter.isPrerelease("1.0.0-RC1")).toBe(true);
    expect(packagistAdapter.isPrerelease("1.0.0-patch1")).toBe(false);
    expect(packagistAdapter.id).toBe("packagist");
    expect(packagistAdapter.concurrency).toBe(6);
  });
});

describe("packagist adapter: abandoned packages", () => {
  it("marks an abandoned package with a replacement as deprecated naming the replacement", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/swiftmailer/swiftmailer.json": {
        status: 200,
        fixture: "packagist/swiftmailer-abandoned.json",
      },
    });
    const info = await packagistAdapter.fetch("swiftmailer/swiftmailer", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toEqual({ message: "abandoned, use symfony/mailer" });
  });

  it("marks an abandoned package without replacement as plainly abandoned", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/fzaninotto/faker.json": {
        status: 200,
        fixture: "packagist/faker-abandoned.json",
      },
    });
    const info = await packagistAdapter.fetch("fzaninotto/faker", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toEqual({ message: "abandoned" });
  });

  it("does not mark a healthy package as deprecated", async () => {
    const stub = stubFetchJson({
      "https://repo.packagist.org/p2/monolog/monolog.json": {
        status: 200,
        fixture: "packagist/monolog-p2.json",
      },
    });
    const info = await packagistAdapter.fetch("monolog/monolog", stub.fetchJson);
    if (info.kind !== "info") throw new Error("expected info");
    expect(info.deprecated).toBeUndefined();
  });
});

describe("packagist adapter: version checks", () => {
  it("delegates to the Composer constraint parser", () => {
    expect(packagistAdapter.parseVersionOrRange("v10.48.29")).toEqual({
      kind: "exact",
      version: "v10.48.29",
    });
    const check = packagistAdapter.parseVersionOrRange("~10.0");
    if (check.kind !== "range") throw new Error("expected range");
    expect(check.matches("v10.48.29")).toBe(true);
    expect(check.matches("v11.0.0")).toBe(false);
    expect(() => packagistAdapter.parseVersionOrRange("dev-main")).toThrow(UnparseableRange);
  });
});
