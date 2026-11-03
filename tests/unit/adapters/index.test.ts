import { describe, expect, it } from "vitest";
import { resolveEcosystem } from "../../../src/adapters/index.js";
import { UnknownEcosystem } from "../../../src/core/errors.js";

describe("resolveEcosystem", () => {
  it.each([
    ["npm", "npm"],
    ["YARN", "npm"],
    ["pnpm", "npm"],
    ["node", "npm"],
    ["pypi", "pypi"],
    ["pip", "pypi"],
    ["python", "pypi"],
    ["uv", "pypi"],
    ["poetry", "pypi"],
    ["pub", "pub"],
    ["dart", "pub"],
    ["flutter", "pub"],
    ["pub.dev", "pub"],
    ["packagist", "packagist"],
    ["composer", "packagist"],
    ["php", "packagist"],
    ["  Composer ", "packagist"],
  ])("maps %s to %s", (input, expected) => {
    expect(resolveEcosystem(input)).toBe(expected);
  });

  it("throws UnknownEcosystem listing the supported names", () => {
    expect(() => resolveEcosystem("cargo")).toThrow(UnknownEcosystem);
    expect(() => resolveEcosystem("cargo")).toThrow("npm, pypi, pub, packagist");
  });
});
