import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCache } from "../../../src/core/cache.js";
import { createFetchJson } from "../../../src/core/http.js";
import { createLimiter } from "../../../src/core/limiter.js";
import type { FetchOutcome } from "../../../src/core/types.js";
import { createCheckPackages } from "../../../src/tool/check-packages.js";
import { loadFixture } from "../../helpers/stub-fetch.js";

// FR-014 / SC-001: a hung registry costs at most the per-request timeout, never more.
describe("batch timing with a hung registry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("answers within the timeout plus slack and marks only the hung item as error", async () => {
    const react = JSON.stringify(loadFixture("npm/react-abbrev.json"));
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/react")) {
        return new Response(react, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Hang until aborted by the timeout signal.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "TimeoutError")),
        );
      });
    }) as typeof fetch;

    const check = createCheckPackages({
      fetchJson: createFetchJson({ fetch: fetchImpl, defaultTimeoutMs: 8000, retryDelayMs: 0 }),
      cache: createCache<FetchOutcome>({ now: () => 0 }),
      limiter: createLimiter(),
    });

    const started = Date.now();
    const pending = check({
      packages: [
        { ecosystem: "npm", name: "react" },
        { ecosystem: "npm", name: "hangs" },
      ],
    });
    await vi.advanceTimersByTimeAsync(8500);
    const { results } = await pending;
    expect(Date.now() - started).toBeLessThanOrEqual(8500);
    expect(results.map((r) => r.s)).toEqual(["ok", "error"]);
    expect(results[1]?.msg).toBe("registry timeout after 8000 ms");
  });
});
