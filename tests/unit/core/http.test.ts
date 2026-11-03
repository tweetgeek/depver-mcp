import { describe, expect, it } from "vitest";
import { createFetchJson, USER_AGENT } from "../../../src/core/http.js";
import { RegistryError } from "../../../src/core/errors.js";

type Call = { url: string; headers: Record<string, string>; signal: AbortSignal | undefined };

function fakeFetch(responders: Array<(call: Call) => Response | Promise<Response>>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = { url: String(input), headers, signal: init?.signal ?? undefined };
    calls.push(call);
    const responder = responders[Math.min(i, responders.length - 1)];
    i++;
    if (!responder) throw new Error("no responder");
    return responder(call);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const jsonResponse = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

describe("createFetchJson", () => {
  it("returns parsed JSON on 200", async () => {
    const { fetch } = fakeFetch([() => jsonResponse(200, '{"a":1}')]);
    const fetchJson = createFetchJson({ fetch });
    await expect(fetchJson("https://x/y")).resolves.toEqual({ status: 200, json: { a: 1 } });
  });

  it("returns status 404 with null json without throwing", async () => {
    const { fetch } = fakeFetch([() => new Response("not here", { status: 404 })]);
    const fetchJson = createFetchJson({ fetch });
    await expect(fetchJson("https://x/y")).resolves.toEqual({ status: 404, json: null });
  });

  it("parses a JSON body on 404 when the registry sends one", async () => {
    const { fetch } = fakeFetch([() => jsonResponse(404, '{"error":"Not found"}')]);
    const fetchJson = createFetchJson({ fetch });
    await expect(fetchJson("https://x/y")).resolves.toEqual({
      status: 404,
      json: { error: "Not found" },
    });
  });

  it("retries once after a 500 and succeeds", async () => {
    const { fetch, calls } = fakeFetch([
      () => new Response("boom", { status: 500 }),
      () => jsonResponse(200, '{"ok":true}'),
    ]);
    const fetchJson = createFetchJson({ fetch, retryDelayMs: 0 });
    await expect(fetchJson("https://x/y")).resolves.toEqual({ status: 200, json: { ok: true } });
    expect(calls).toHaveLength(2);
  });

  it("fails with kind http after two 5xx answers", async () => {
    const { fetch, calls } = fakeFetch([() => new Response("boom", { status: 503 })]);
    const fetchJson = createFetchJson({ fetch, retryDelayMs: 0 });
    const err = await fetchJson("https://x/y").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("http");
    expect((err as RegistryError).status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it("fails with kind rate_limited on 429 without retrying", async () => {
    const { fetch, calls } = fakeFetch([() => new Response("slow down", { status: 429 })]);
    const fetchJson = createFetchJson({ fetch, retryDelayMs: 0 });
    const err = await fetchJson("https://x/y").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("rate_limited");
    expect(calls).toHaveLength(1);
  });

  it("retries once after a network error and then fails with kind network", async () => {
    const { fetch, calls } = fakeFetch([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    const fetchJson = createFetchJson({ fetch, retryDelayMs: 0 });
    const err = await fetchJson("https://x/y").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("network");
    expect(calls).toHaveLength(2);
  });

  it("fails with kind timeout when the request exceeds timeoutMs", async () => {
    const { fetch } = fakeFetch([
      (call) =>
        new Promise<Response>((_, reject) => {
          call.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "TimeoutError")),
          );
        }),
    ]);
    const fetchJson = createFetchJson({ fetch, retryDelayMs: 0 });
    const err = await fetchJson("https://x/y", { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("timeout");
    expect((err as RegistryError).message).toBe("registry timeout after 20 ms");
  });

  it("fails with kind malformed when a 200 body is not JSON", async () => {
    const { fetch } = fakeFetch([() => new Response("<html>", { status: 200 })]);
    const fetchJson = createFetchJson({ fetch, retryDelayMs: 0 });
    const err = await fetchJson("https://x/y").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).kind).toBe("malformed");
  });

  it("sends the User-Agent and the requested Accept header", async () => {
    const { fetch, calls } = fakeFetch([() => jsonResponse(200, "{}")]);
    const fetchJson = createFetchJson({ fetch });
    await fetchJson("https://x/y", { accept: "application/vnd.test+json" });
    expect(calls[0]?.headers["user-agent"]).toBe(USER_AGENT);
    expect(calls[0]?.headers["accept"]).toBe("application/vnd.test+json");
  });

  it("identifies the tool by repository URL in the User-Agent", () => {
    expect(USER_AGENT).toMatch(
      /^depver-mcp\/[^ ]+ \(\+https:\/\/github\.com\/tweetgeek\/depver-mcp\)$/,
    );
  });
});
