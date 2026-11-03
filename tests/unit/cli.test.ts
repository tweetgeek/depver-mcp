import { describe, expect, it } from "vitest";
import { parseCliArgs, HELP_TEXT } from "../../src/cli.js";

describe("parseCliArgs", () => {
  it("serves when no flags are given", () => {
    expect(parseCliArgs([])).toBe("serve");
  });

  it.each(["--help", "-h"])("reports help for %s", (flag) => {
    expect(parseCliArgs([flag])).toBe("help");
  });

  it.each(["--version", "-v"])("reports version for %s", (flag) => {
    expect(parseCliArgs([flag])).toBe("version");
  });

  it("ignores unknown arguments and serves", () => {
    expect(parseCliArgs(["--something"])).toBe("serve");
  });

  it("describes the install snippet and the debug variable in the help text", () => {
    expect(HELP_TEXT).toMatch(/npx -y depver-mcp/);
    expect(HELP_TEXT).toMatch(/DEPVER_MCP_DEBUG/);
  });
});
