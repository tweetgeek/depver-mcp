# Quickstart: Package Version MCP Server

**Feature**: [spec.md](./spec.md) | **Contract**: [contracts/check_packages.md](./contracts/check_packages.md)

This guide validates the feature end-to-end once it is implemented. It is a run and verification
guide, not an implementation guide.

## Prerequisites

- Node.js 20 or newer (`node --version`)
- npm 10 or newer
- An MCP-capable agent for the final scenario (Claude Code, Cursor, or the MCP Inspector)

## Build and unit tests

```bash
npm ci
npm run build          # tsup → dist/index.js (single file, shebang, executable)
npm test               # vitest, must pass with networking disabled
```

Expected: `dist/index.js` exists and starts; the test run makes zero network calls (verify by
running with `--offline` style network blocking, e.g. `unshare -n` on Linux or by pointing
`HTTPS_PROXY` at a closed port; every test still passes).

## Scenario 1: direct stdio smoke test (no agent)

Send an MCP `initialize` and a `tools/call` over stdin and read the JSON-RPC answer. The easiest
tool for this is the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

In the Inspector:
1. Confirm the tool list shows exactly one tool, `check_packages`.
2. Call it with the example request from `contracts/check_packages.md`.
3. Verify: 9 results, in input order; `react` is `ok` with two version fields; `request` is `deprecated` with a one-sentence `msg`; the PyPI exact check has `v_exists: true`; the three ranges have `v_match`; `htttp` is `not_found`; `cargo` is `error` with the supported-ecosystems message.
4. Call with `{"ecosystem":"npm","name":"unpublish-me"}` → `not_found` with `msg` "unpublished from npm".

## Scenario 2: failure isolation

1. Disconnect from the network (or block `packagist.org` only, e.g. via `/etc/hosts`).
2. Call `check_packages` with one npm item and one Packagist item.
3. Verify: the npm item still succeeds (if online) or both are `error`; the Packagist item is `error` with a timeout or connection message; the call returns within the per-item timeout plus a few hundred milliseconds; the server process is still alive and answers the next call.

## Scenario 3: validation boundaries

1. Call with `packages: []` → whole call fails (`isError`) with text containing `packages must contain between 1 and 100 items (got 0)`.
2. Call with 101 items → whole call fails naming `101`.
3. Call with 100 valid npm items → succeeds; observe (via stderr debug logging, if enabled) that in-flight requests to the npm registry never exceed the configured per-registry concurrency.
4. Call the same 100 items again immediately → identical response, no new registry requests.

## Scenario 4: version semantics

| Ecosystem | Input | Expected |
|-----------|-------|----------|
| npm | `react` `^17` | `v_match` is the highest 17.x |
| npm | `react` `99.0.0` | `v_exists: false` |
| pypi | `requests` `~=2.31` | `v_match` is the highest 2.x ≥ 2.31 |
| pypi | `requests` `==2.*` | `v_match` is the highest 2.x |
| pub | `http` `>=0.13.0 <1.0.0` | `v_match` is the highest 0.13.x |
| packagist | `monolog/monolog` `~2.0` | `v_match` is the highest 2.x (Composer semantics, not 2.0.x) |
| packagist | `monolog/monolog` `~2.0.0` | `v_match` is the highest 2.0.x |
| any | nonsense range `>>=1` | that item only is `error`, batch succeeds |

## Scenario 5: install from an agent config

Add to the project's `.mcp.json` (Claude Code) or equivalent:

```json
{
  "mcpServers": {
    "depver": {
      "command": "npx",
      "args": ["-y", "depver-mcp"]
    }
  }
}
```

Restart the agent. Ask it: "Check the latest versions of react, requests and laravel/framework."
Verify the agent calls `check_packages` once with three mixed-ecosystem items and reports real
versions. Time from editing the config to the first successful answer must be under 2 minutes
(SC-006).

## Scenario 6: README check

Open `README.md` as a stranger. It must state: what the tool does, the one-line install snippet,
the input and output format with an example, the supported ecosystems and aliases, the status
meanings, and the license. All in English.
