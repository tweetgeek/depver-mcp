import { RegistryError } from "./errors.js";
import type { FetchJson, FetchJsonOptions, FetchJsonResponse } from "./types.js";

const VERSION = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "dev";

/** Identifies the tool by repository URL only; no personal contact data leaves the user's machine. */
export const USER_AGENT = `depver-mcp/${VERSION} (+https://github.com/tweetgeek/depver-mcp)`;

export const DEFAULT_TIMEOUT_MS = 8000;

export interface CreateFetchJsonOptions {
  fetch?: typeof fetch;
  defaultTimeoutMs?: number;
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * Built-in fetch wrapped with: User-Agent, per-request timeout, one retry on network error or
 * 5xx (300 ms backoff), no retry on 404 or 429, typed failures. Non-2xx responses with a JSON
 * body still return the parsed body so adapters can inspect registry-specific not-found shapes.
 */
export function createFetchJson(options: CreateFetchJsonOptions = {}): FetchJson {
  const doFetch = options.fetch ?? globalThis.fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 300;

  async function attempt(url: string, opts: FetchJsonOptions): Promise<FetchJsonResponse> {
    const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
    const headers: Record<string, string> = { "user-agent": USER_AGENT };
    if (opts.accept) headers["accept"] = opts.accept;

    let response: Response;
    try {
      response = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (isAbort(err)) {
        throw new RegistryError("timeout", `registry timeout after ${timeoutMs} ms`);
      }
      throw new RegistryError("network", "registry unreachable");
    }

    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        if (response.ok) {
          throw new RegistryError(
            "malformed",
            "registry returned a non-JSON body",
            response.status,
          );
        }
        json = null;
      }
    }

    if (response.status === 429) {
      throw new RegistryError("rate_limited", "rate limited by registry", 429);
    }
    if (response.status >= 500) {
      throw new RegistryError("http", `registry answered HTTP ${response.status}`, response.status);
    }
    return { status: response.status, json };
  }

  return async (url, opts = {}) => {
    try {
      return await attempt(url, opts);
    } catch (err) {
      const retryable =
        err instanceof RegistryError && (err.kind === "network" || err.kind === "http");
      if (!retryable) throw err;
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      return attempt(url, opts);
    }
  };
}
