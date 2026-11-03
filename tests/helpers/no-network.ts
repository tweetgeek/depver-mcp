import { afterAll, beforeAll } from "vitest";

// Constitution VI: automated tests never touch the network.
// Any code path that reaches the real fetch fails loudly instead of silently hitting a registry.
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("Network access is forbidden in tests (Constitution VI)");
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});
