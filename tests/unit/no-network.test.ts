import { describe, expect, it } from "vitest";

// Proves the Constitution VI guard is active: any code path reaching the real fetch fails loudly.
describe("network guard", () => {
  it("makes the global fetch throw during tests", () => {
    expect(() => globalThis.fetch("https://registry.npmjs.org/react")).toThrow(
      /Network access is forbidden in tests/,
    );
  });
});
