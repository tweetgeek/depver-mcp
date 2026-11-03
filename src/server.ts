import { McpServer, type CallToolResult, type ToolAnnotations } from "@modelcontextprotocol/server";
import { createCache } from "./core/cache.js";
import { createFetchJson } from "./core/http.js";
import { createLimiter } from "./core/limiter.js";
import { debug } from "./core/log.js";
import type { FetchOutcome } from "./core/types.js";
import { createCheckPackages, type CheckPackagesDeps } from "./tool/check-packages.js";
import { CheckPackagesInput, formatEnvelopeError } from "./tool/schema.js";

const VERSION = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "dev";

export const SERVER_INFO = { name: "depver-mcp", version: VERSION } as const;

/** Tool metadata, verbatim from contracts/check_packages.md. */
export const TOOL_NAME = "check_packages";
export const TOOL_TITLE = "Check package versions";
export const TOOL_DESCRIPTION =
  "Verify that packages exist and get their current versions from public registries " +
  "(npm, PyPI, pub.dev, Packagist). Use before writing or updating a dependency manifest " +
  "instead of guessing versions. Accepts up to 100 packages from mixed ecosystems in one call. " +
  "Pass `version` to check an exact version or resolve a range.";
export const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export interface CheckPackagesTool {
  name: typeof TOOL_NAME;
  config: {
    title: string;
    description: string;
    inputSchema: typeof CheckPackagesInput;
    annotations: ToolAnnotations;
    outputSchema?: undefined;
  };
  /** Raw handler: validates the envelope itself so it behaves identically with or without the SDK. */
  handler: (input: unknown) => Promise<CallToolResult>;
}

export function defaultDeps(): CheckPackagesDeps {
  return {
    fetchJson: createFetchJson(),
    cache: createCache<FetchOutcome>(),
    limiter: createLimiter(),
  };
}

export function createCheckPackagesTool(
  deps: CheckPackagesDeps = defaultDeps(),
): CheckPackagesTool {
  const checkPackages = createCheckPackages(deps);
  return {
    name: TOOL_NAME,
    config: {
      title: TOOL_TITLE,
      description: TOOL_DESCRIPTION,
      inputSchema: CheckPackagesInput,
      annotations: TOOL_ANNOTATIONS,
    },
    async handler(input) {
      const parsed = CheckPackagesInput.safeParse(input);
      if (!parsed.success) {
        return {
          content: [{ type: "text", text: formatEnvelopeError(parsed.error) }],
          isError: true,
        };
      }
      const output = await checkPackages(parsed.data);
      // One minified text block, no structuredContent: a single copy of the data (Constitution I).
      return { content: [{ type: "text", text: JSON.stringify(output) }] };
    },
  };
}

/** Build a fresh McpServer with the single tool registered. serveStdio calls this per connection. */
export function createServer(deps: CheckPackagesDeps = defaultDeps()): McpServer {
  const server = new McpServer(SERVER_INFO);
  const tool = createCheckPackagesTool(deps);
  server.registerTool(
    tool.name,
    {
      title: tool.config.title,
      description: tool.config.description,
      inputSchema: tool.config.inputSchema,
      annotations: tool.config.annotations,
    },
    async (args) => {
      debug("check_packages", args.packages.length, "items");
      return tool.handler(args);
    },
  );
  return server;
}
