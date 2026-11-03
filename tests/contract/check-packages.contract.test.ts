import { describe, expect, it } from "vitest";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import type { FetchOutcome } from "../../src/core/types.js";
import { createCache } from "../../src/core/cache.js";
import { createLimiter } from "../../src/core/limiter.js";
import { createCheckPackagesTool, createServer } from "../../src/server.js";
import { stubFetchJson, type Route } from "../helpers/stub-fetch.js";

/** Every URL the example request in contracts/check_packages.md reaches, served from fixtures. */
const ROUTES: Record<string, Route> = {
  "https://registry.npmjs.org/react": { status: 200, fixture: "npm/react-abbrev.json" },
  "https://registry.npmjs.org/request": { status: 200, fixture: "npm/request-abbrev.json" },
  "https://registry.npmjs.org/left-pad": { status: 200, fixture: "npm/left-pad-abbrev.json" },
  "https://registry.npmjs.org/unpublish-me": { status: 200, fixture: "npm/unpublished.json" },
  "https://pypi.org/simple/requests/": { status: 200, fixture: "pypi/requests-simple.json" },
  "https://pub.dev/api/packages/http": { status: 200, fixture: "pub/http.json" },
  "https://pub.dev/api/packages/htttp": { status: 404, fixture: "pub/not-found.xml" },
  "https://repo.packagist.org/p2/laravel/framework.json": {
    status: 200,
    fixture: "packagist/laravel-p2.json",
  },
};

function deps() {
  const stub = stubFetchJson(ROUTES);
  return {
    fetchJson: stub.fetchJson,
    cache: createCache<FetchOutcome>({ now: () => 0 }),
    limiter: createLimiter(),
  };
}

const EXAMPLE_REQUEST = {
  packages: [
    { ecosystem: "npm", name: "react" },
    { ecosystem: "yarn", name: "request" },
    { ecosystem: "pip", name: "Requests", version: "2.31.0" },
    { ecosystem: "pypi", name: "requests", version: ">=2.0,<2.20" },
    { ecosystem: "dart", name: "http", version: "^1.0.0" },
    { ecosystem: "composer", name: "laravel/framework", version: "~10.0" },
    { ecosystem: "pub", name: "htttp" },
    { ecosystem: "npm", name: "left-pad", version: "1.3.0" },
    { ecosystem: "cargo", name: "serde" },
  ],
};

describe("check_packages tool handler (contract)", () => {
  it("answers the example request from the contract with one minified text block", async () => {
    const tool = createCheckPackagesTool(deps());
    const result = await tool.handler(EXAMPLE_REQUEST);

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("expected a text block");
    // minified: re-serializing the parsed JSON reproduces the text byte for byte
    expect(JSON.stringify(JSON.parse(block.text))).toBe(block.text);

    const parsed = JSON.parse(block.text) as { results: Array<Record<string, unknown>> };
    expect(parsed.results).toHaveLength(9);
    expect(parsed.results.map((r) => [r["e"], r["n"]])).toEqual([
      ["npm", "react"],
      ["npm", "request"],
      ["pypi", "requests"],
      ["pypi", "requests"],
      ["pub", "http"],
      ["packagist", "laravel/framework"],
      ["pub", "htttp"],
      ["npm", "left-pad"],
      ["cargo", "serde"],
    ]);
    expect(parsed.results[0]).toEqual({
      e: "npm",
      n: "react",
      s: "ok",
      stable: "19.3.1",
      latest: "19.3.1",
    });
    expect(parsed.results[6]).toEqual({ e: "pub", n: "htttp", s: "not_found" });
    expect(parsed.results[8]).toEqual({
      e: "cargo",
      n: "serde",
      s: "error",
      msg: 'unknown ecosystem "cargo"; supported: npm, pypi, pub, packagist',
    });
  });

  it("rejects an invalid envelope with isError and the contract's message", async () => {
    const tool = createCheckPackagesTool(deps());
    const result = await tool.handler({ packages: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "packages must contain between 1 and 100 items (got 0)",
    });
  });

  it("declares the tool exactly as the contract describes it", () => {
    const tool = createCheckPackagesTool(deps());
    expect(tool.name).toBe("check_packages");
    expect(tool.config.title).toBe("Check package versions");
    expect(tool.config.description).toMatch(/npm, PyPI, pub\.dev, Packagist/);
    expect(tool.config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tool.config.outputSchema).toBeUndefined();
  });
});

describe("MCP server over an in-memory transport (contract)", () => {
  async function rpc(messages: JSONRPCMessage[]): Promise<JSONRPCMessage[]> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createServer(deps());
    const received: JSONRPCMessage[] = [];
    clientSide.onmessage = (m) => received.push(m);
    await server.connect(serverSide);
    await clientSide.start();
    for (const m of messages) {
      await clientSide.send(m);
      // give the server a tick to answer before sending the next message
      await new Promise((r) => setTimeout(r, 10));
    }
    await clientSide.close();
    await server.close();
    return received;
  }

  it("lists exactly one tool and answers a call with a text block", async () => {
    const received = await rpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "contract-test", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "check_packages",
          arguments: { packages: [{ ecosystem: "npm", name: "react" }] },
        },
      },
    ]);

    const byId = new Map(received.map((m) => ["id" in m ? m.id : undefined, m]));
    const init = byId.get(1) as { result?: { serverInfo?: { name?: string } } };
    expect(init.result?.serverInfo?.name).toBe("depver-mcp");

    const list = byId.get(2) as { result?: { tools?: Array<{ name: string }> } };
    expect(list.result?.tools?.map((t) => t.name)).toEqual(["check_packages"]);

    const call = byId.get(3) as {
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    };
    expect(call.result?.isError).toBeUndefined();
    expect(call.result?.content).toHaveLength(1);
    const text = call.result?.content?.[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      results: [{ e: "npm", n: "react", s: "ok", stable: "19.3.1", latest: "19.3.1" }],
    });
  });
});
