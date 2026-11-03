import { describe, expect, it } from "vitest";
import { createCache } from "../../../src/core/cache.js";

describe("createCache", () => {
  it("misses on an unknown key", () => {
    const cache = createCache<string>({ now: () => 0 });
    expect(cache.get("npm\0react")).toBeUndefined();
  });

  it("returns a stored value before the TTL expires", () => {
    let t = 0;
    const cache = createCache<string>({ ttlMs: 1000, now: () => t });
    cache.set("npm\0react", "v");
    t = 999;
    expect(cache.get("npm\0react")).toBe("v");
  });

  it("expires a value after the TTL", () => {
    let t = 0;
    const cache = createCache<string>({ ttlMs: 1000, now: () => t });
    cache.set("npm\0react", "v");
    t = 1000;
    expect(cache.get("npm\0react")).toBeUndefined();
  });

  it("evicts the oldest entry when maxEntries is exceeded", () => {
    const cache = createCache<number>({ maxEntries: 2, now: () => 0 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("exposes the key helper that joins ecosystem and name with NUL", () => {
    const cache = createCache<string>({ now: () => 0 });
    expect(cache.key("npm", "react")).toBe("npm\0react");
  });
});
