import { describe, expect, it } from "vitest";
import { createCache } from "../../../src/core/cache.js";
import { RegistryError } from "../../../src/core/errors.js";
import { createLimiter } from "../../../src/core/limiter.js";
import type { FetchOutcome } from "../../../src/core/types.js";
import { createCheckPackages } from "../../../src/tool/check-packages.js";
import { stubFetchJson, type Route } from "../../helpers/stub-fetch.js";

const NPM = "https://registry.npmjs.org";
const ROUTES: Record<string, Route> = {
  [`${NPM}/react`]: { status: 200, fixture: "npm/react-abbrev.json" },
  [`${NPM}/nope`]: { status: 404, fixture: "npm/not-found.json" },
  "https://pypi.org/simple/requests/": { status: 200, fixture: "pypi/requests-simple.json" },
  "https://pub.dev/api/packages/http": { status: 200, fixture: "pub/http.json" },
  "https://repo.packagist.org/p2/monolog/monolog.json": {
    status: 200,
    fixture: "packagist/monolog-p2.json",
  },
};

function build(routes: Record<string, Route> = ROUTES) {
  const stub = stubFetchJson(routes);
  const cache = createCache<FetchOutcome>({ now: () => 0 });
  const check = createCheckPackages({ fetchJson: stub.fetchJson, cache, limiter: createLimiter() });
  return { stub, check };
}

describe("createCheckPackages", () => {
  it("answers a mixed batch in input order", async () => {
    const { check } = build();
    const { results } = await check({
      packages: [
        { ecosystem: "packagist", name: "monolog/monolog" },
        { ecosystem: "pip", name: "Requests" },
        { ecosystem: "yarn", name: "react" },
        { ecosystem: "flutter", name: "http" },
        { ecosystem: "npm", name: "nope" },
      ],
    });
    expect(results.map((r) => [r.e, r.n, r.s])).toEqual([
      ["packagist", "monolog/monolog", "ok"],
      ["pypi", "requests", "ok"],
      ["npm", "react", "ok"],
      ["pub", "http", "ok"],
      ["npm", "nope", "not_found"],
    ]);
    expect(results[2]).toEqual({
      e: "npm",
      n: "react",
      s: "ok",
      stable: "19.3.1",
      latest: "19.3.1",
    });
    expect(results[1]?.stable).toBe("2.32.5");
    expect(results[0]?.stable).toBe("3.12.1");
    expect(results[3]?.stable).toBe("1.6.0");
  });

  it("answers duplicates individually but fetches once", async () => {
    const { check, stub } = build();
    const { results } = await check({
      packages: [
        { ecosystem: "npm", name: "react" },
        { ecosystem: "pnpm", name: "React" },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
    expect(stub.calls).toEqual([`${NPM}/react`]);
  });

  it("isolates a failing item from the rest of the batch", async () => {
    const { check } = build({
      ...ROUTES,
      [`${NPM}/boom`]: {
        status: 200,
        throws: new RegistryError("timeout", "registry timeout after 8000 ms"),
      },
    });
    const { results } = await check({
      packages: [
        { ecosystem: "npm", name: "react" },
        { ecosystem: "npm", name: "boom" },
        { ecosystem: "pypi", name: "requests" },
      ],
    });
    expect(results.map((r) => r.s)).toEqual(["ok", "error", "ok"]);
    expect(results[1]?.msg).toBe("registry timeout after 8000 ms");
  });

  it("reports an unknown ecosystem as error while the batch succeeds", async () => {
    const { check } = build();
    const { results } = await check({
      packages: [
        { ecosystem: "cargo", name: "serde" },
        { ecosystem: "npm", name: "react" },
      ],
    });
    expect(results[0]).toEqual({
      e: "cargo",
      n: "serde",
      s: "error",
      msg: 'unknown ecosystem "cargo"; supported: npm, pypi, pub, packagist',
    });
    expect(results[1]?.s).toBe("ok");
  });

  it("reports an invalid name as error for that item only", async () => {
    const { check, stub } = build();
    const { results } = await check({
      packages: [
        { ecosystem: "pub", name: "Http" },
        { ecosystem: "npm", name: "react" },
      ],
    });
    expect(results[0]?.s).toBe("error");
    expect(results[0]?.msg).toMatch(/not a valid pub\.dev package name/);
    expect(stub.calls).toEqual([`${NPM}/react`]);
  });

  it("serves a repeated call from the cache without new requests", async () => {
    const { check, stub } = build();
    const input = {
      packages: [
        { ecosystem: "npm", name: "react" },
        { ecosystem: "npm", name: "nope" },
      ],
    };
    const first = await check(input);
    const second = await check(input);
    expect(second).toEqual(first);
    expect(stub.calls).toEqual([`${NPM}/react`, `${NPM}/nope`]);
  });

  it("does not cache errors", async () => {
    const { check, stub } = build({
      [`${NPM}/flaky`]: {
        status: 200,
        throws: new RegistryError("network", "registry unreachable"),
      },
    });
    await check({ packages: [{ ecosystem: "npm", name: "flaky" }] });
    await check({ packages: [{ ecosystem: "npm", name: "flaky" }] });
    expect(stub.calls).toHaveLength(2);
  });

  it("never exceeds the adapter's concurrency for one registry", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const routes: Record<string, Route> = {};
    const packages = Array.from({ length: 20 }, (_, i) => ({ ecosystem: "npm", name: `pkg-${i}` }));
    for (const p of packages) {
      routes[`${NPM}/${p.name}`] = { status: 200, fixture: "npm/react-abbrev.json", waitFor: gate };
    }
    const { check, stub } = build(routes);
    const pending = check({ packages });
    await new Promise((r) => setTimeout(r, 5));
    expect(stub.inFlight()).toBe(6);
    release();
    const { results } = await pending;
    expect(stub.peakInFlight()).toBe(6);
    expect(results.every((r) => r.s === "ok")).toBe(true);
  });

  it("survives a fully offline batch and works again afterwards", async () => {
    const offline = stubFetchJson({
      [`${NPM}/react`]: {
        status: 200,
        throws: new RegistryError("network", "registry unreachable"),
      },
      "https://pypi.org/simple/requests/": {
        status: 200,
        throws: new RegistryError("network", "registry unreachable"),
      },
    });
    const cache = createCache<FetchOutcome>({ now: () => 0 });
    const limiter = createLimiter();
    const checkOffline = createCheckPackages({ fetchJson: offline.fetchJson, cache, limiter });
    const { results } = await checkOffline({
      packages: [
        { ecosystem: "npm", name: "react" },
        { ecosystem: "pypi", name: "requests" },
      ],
    });
    expect(results.map((r) => r.s)).toEqual(["error", "error"]);
    expect(results.every((r) => r.msg === "registry unreachable")).toBe(true);

    const online = stubFetchJson(ROUTES);
    const checkOnline = createCheckPackages({ fetchJson: online.fetchJson, cache, limiter });
    const again = await checkOnline({ packages: [{ ecosystem: "npm", name: "react" }] });
    expect(again.results[0]?.s).toBe("ok");
  });
});
