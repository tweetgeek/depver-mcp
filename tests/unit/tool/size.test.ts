import { describe, expect, it } from "vitest";
import { npmAdapter } from "../../../src/adapters/npm.js";
import type { PackageResult, VersionInfo } from "../../../src/core/types.js";
import { formatResult } from "../../../src/tool/format.js";

// SC-005: a single result stays tiny and a full batch stays far below the agent's context budget.
describe("response size", () => {
  const info: VersionInfo = {
    kind: "info",
    name: "@tanstack/react-query",
    versions: [
      { version: "5.90.2", prerelease: false },
      { version: "5.91.0-beta.3", prerelease: true },
    ],
    stableHint: "5.90.2",
  };

  it("keeps a single result without a version check at or under 120 characters", () => {
    const result = formatResult(
      { ecosystem: "npm", name: "@tanstack/react-query" },
      "npm",
      "@tanstack/react-query",
      info,
      npmAdapter,
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(120);
  });

  it("keeps a 100-item batch of ok results under 12 KB", () => {
    const results: PackageResult[] = Array.from({ length: 100 }, (_, i) =>
      formatResult(
        { ecosystem: "npm", name: `@scope/package-name-${i}`, version: "^5" },
        "npm",
        `@scope/package-name-${i}`,
        info,
        npmAdapter,
      ),
    );
    expect(JSON.stringify({ results }).length).toBeLessThan(12 * 1024);
  });
});
