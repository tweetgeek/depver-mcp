import { getAdapter, resolveEcosystem } from "../adapters/index.js";
import type { Cache } from "../core/cache.js";
import type { Limiter } from "../core/limiter.js";
import type {
  Adapter,
  Ecosystem,
  FetchJson,
  FetchOutcome,
  PackageQuery,
  PackageResult,
} from "../core/types.js";
import { formatResult } from "./format.js";
import type { CheckPackagesInput } from "./schema.js";

export interface CheckPackagesDeps {
  fetchJson: FetchJson;
  cache: Cache<FetchOutcome>;
  limiter: Limiter;
}

export interface CheckPackagesOutput {
  results: PackageResult[];
}

interface Resolved {
  ecosystem: Ecosystem;
  name: string;
  adapter: Adapter;
}

/**
 * The whole pipeline for one batch: resolve aliases, normalize names, deduplicate, fetch through
 * the per-registry limiter and the cache, format, and answer in input order. One item's failure
 * never affects another (Constitution II).
 */
export function createCheckPackages(deps: CheckPackagesDeps) {
  const { fetchJson, cache, limiter } = deps;

  function resolve(query: PackageQuery): Resolved {
    const ecosystem = resolveEcosystem(query.ecosystem);
    const adapter = getAdapter(ecosystem);
    return { ecosystem, name: adapter.normalizeName(query.name), adapter };
  }

  async function lookup(r: Resolved): Promise<FetchOutcome> {
    const key = cache.key(r.ecosystem, r.name);
    const cached = cache.get(key);
    if (cached) return cached;
    const outcome = await limiter.run(r.ecosystem, r.adapter.concurrency, () =>
      r.adapter.fetch(r.name, fetchJson),
    );
    cache.set(key, outcome); // only successful lookups; errors threw before reaching here
    return outcome;
  }

  return async function checkPackages(input: CheckPackagesInput): Promise<CheckPackagesOutput> {
    // Deduplicate so the same package in one batch costs one request, and so that concurrent
    // duplicates share the same promise instead of racing the cache.
    const inflight = new Map<string, Promise<FetchOutcome>>();

    const results = await Promise.all(
      input.packages.map(async (query): Promise<PackageResult> => {
        let resolved: Resolved;
        try {
          resolved = resolve(query);
        } catch (err) {
          return formatResult(query, undefined, undefined, err, undefined);
        }
        const key = cache.key(resolved.ecosystem, resolved.name);
        let promise = inflight.get(key);
        if (!promise) {
          promise = lookup(resolved);
          inflight.set(key, promise);
        }
        try {
          const outcome = await promise;
          return formatResult(query, resolved.ecosystem, resolved.name, outcome, resolved.adapter);
        } catch (err) {
          return formatResult(query, resolved.ecosystem, resolved.name, err, resolved.adapter);
        }
      }),
    );

    return { results };
  };
}
