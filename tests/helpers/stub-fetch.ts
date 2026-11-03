import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { FetchJson } from "../../src/core/types.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export interface Route {
  status: number;
  /** Inline JSON body. */
  json?: unknown;
  /** Path under tests/fixtures, e.g. "npm/react-abbrev.json"; `.json` files are parsed, others yield null. */
  fixture?: string;
  /** Throw this instead of answering. */
  throws?: Error;
  /** Delay the answer until this promise resolves (for concurrency/timeout tests). */
  waitFor?: Promise<unknown>;
}

export interface StubFetch {
  fetchJson: FetchJson;
  calls: string[];
  inFlight: () => number;
  peakInFlight: () => number;
}

export function loadFixture(relativePath: string): unknown {
  const text = readFileSync(join(FIXTURES_DIR, relativePath), "utf8");
  return relativePath.endsWith(".json") ? (JSON.parse(text) as unknown) : null;
}

/** A FetchJson that answers only the given URLs and throws for anything else. */
export function stubFetchJson(routes: Record<string, Route>): StubFetch {
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`stub-fetch: unexpected request to ${url}`);
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      if (route.waitFor) await route.waitFor;
      if (route.throws) throw route.throws;
      const json = route.fixture !== undefined ? loadFixture(route.fixture) : (route.json ?? null);
      return { status: route.status, json };
    } finally {
      inFlight--;
    }
  };
  return { fetchJson, calls, inFlight: () => inFlight, peakInFlight: () => peak };
}
