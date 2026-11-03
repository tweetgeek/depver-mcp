# Implementation Plan: Package Version MCP Server

**Branch**: `001-package-version-mcp` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-package-version-mcp/spec.md`

## Summary

A local, stdio-only MCP server that exposes one tool, `check_packages`, which takes up to 100
packages from npm, PyPI, pub.dev and Packagist in a single call, queries each registry directly
from the user's machine, and returns one compact JSON line per package: status (`ok`,
`deprecated`, `not_found`, `error`), latest stable, latest overall, and the result of an
exact-version or native-syntax range check. Technical approach: TypeScript on Node 20+, the v2
official MCP SDK over stdio, one self-contained adapter per registry behind a shared contract, the
`semver` library for npm and pub.dev plus in-house PEP 440 and Composer modules, a per-registry
concurrency limiter, per-request timeouts, a 5 minute in-process cache, bundled by `tsup` into a
single zero-dependency file published to npm with a `bin` entry. See [research.md](./research.md)
for every verified registry fact behind these choices.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node.js >= 20 (required by the v2 MCP SDK)

**Primary Dependencies**: `@modelcontextprotocol/server` (v2 line), `zod` 4 (brought in by the SDK), `semver`. All inlined by the bundler; the published package has no runtime dependencies. Dev: `tsup`, `vitest`, `typescript`, `@types/node`, `@types/semver`.

**Storage**: N/A. In-process TTL cache only (5 min, max 10 000 entries), dies with the process.

**Testing**: `vitest`; adapters and HTTP layer tested with recorded fixtures through an injected fetch function; contract test boots the server in-process; CI blocks real network access.

**Target Platform**: Any OS with Node 20+ where an MCP client runs the server via `npx` or an `.mcp.json` entry (macOS, Linux, Windows).

**Project Type**: single-package CLI/MCP server

**Performance Goals**: 100-item mixed batch answered in under 5 s on broadband (SC-001); cold start under 1 s after the first `npx` download (SC-007); single result ≤ 120 chars, 100-item response < 12 KB (SC-005).

**Constraints**: per-request timeout 8 s; per-registry concurrency 6 (Packagist allows 10); no stdout writes except protocol; responses minified; no network in tests; entire repository in English.

**Scale/Scope**: 4 registry adapters in the MVP, 1 tool, roughly 1 500 to 2 000 lines of source plus fixtures; designed so each further ecosystem is one adapter file.

**Identity/Delivery**: npm package `depver-mcp`, GitHub repository `tweetgeek/depver-mcp`; MIT; CI on Node 20/22/24 (Linux), publish with provenance on `v*` tags; first release `0.1.0`, `1.0.0` when the tool contract is frozen.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How the design satisfies it | Status |
|-----------|-----------------------------|--------|
| I. Token Frugality | Output keys are 1 to 12 chars; presence rules in [data-model.md](./data-model.md) forbid null/empty keys except `v_match: null`; `msg` is cut to one sentence and 160 chars; no `structuredContent` duplicate; no descriptions/authors/links anywhere in the result. | PASS |
| II. Never Lie to the Agent | Only an adapter's documented not-found signal (npm 404 `{"error":"Not found"}`, PyPI 404, pub.dev 404, Packagist 404) yields `not_found`; timeouts, 5xx, 429, malformed bodies, unknown ecosystems and unparseable ranges all yield `error`; `Promise.allSettled`-style orchestration keeps items independent; range semantics are implemented per ecosystem's own rules (R7), including a dedicated Composer module precisely to avoid approximations. | PASS |
| III. Zero Infrastructure | No database, no disk cache, no workers, no auth, no remote service. Only state is the in-process cache. | PASS |
| IV. Minimal Dependencies and Fast Startup | Runtime deps after bundling: none. Inlined: MCP server SDK, zod, semver. Limiter, cache, PEP 440 and Composer logic are in-house (each < 300 lines). `tsup` single ESM file with shebang; `engines.node >= 20`. | PASS |
| V. One Adapter per Ecosystem | `src/adapters/<ecosystem>.ts` implements the `Adapter` contract (normalizeName, fetch, isPrerelease, compare, parseVersionOrRange, concurrency); a static registry table plus alias map is the only shared knowledge of ecosystems; the tool schema is ecosystem-agnostic (`ecosystem` is a string validated against the table at runtime). | PASS |
| VI. Tests Without Network | Injected `fetchJson`; fixtures under `tests/fixtures/<ecosystem>/`; mandatory fixture set per adapter listed in R9; test-first order encoded in the task plan; CI sets a dead proxy. | PASS |
| VII. English-Only, Open-Source Quality | All artifacts in English; README, LICENSE (MIT), CONTRIBUTING with the "one adapter file" recipe; Conventional Commits. | PASS |
| Technology Constraints | Node 20+, TypeScript strict, official MCP TypeScript SDK (v2 line, `@modelcontextprotocol/server`) over stdio, zod, built-in fetch with abort timeouts, semver for npm/pub.dev, in-house PEP 440 and Composer modules, tsup, vitest. Constitution 1.0.1 wording matches these choices. | PASS |

**Post-design re-check (after Phase 1)**: unchanged. The data model, contract and quickstart
introduce no new state, dependency or response field beyond those listed above.

## Project Structure

### Documentation (this feature)

```text
specs/001-package-version-mcp/
├── plan.md              # This file
├── research.md          # Phase 0: verified registry and SDK facts, decisions
├── data-model.md        # Phase 1: entities, result keys, status semantics, adapter contract
├── quickstart.md        # Phase 1: end-to-end validation scenarios
├── contracts/
│   └── check_packages.md  # Phase 1: normative tool input/output contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
package.json             # type: module, bin, engines.node >=20, files: [dist], zero runtime deps after bundle
tsconfig.json            # strict, NodeNext, ES2022
tsup.config.ts           # esm, node20, shebang + createRequire banner, noExternal: all
vitest.config.ts
LICENSE                  # MIT
README.md                # purpose, install snippet, tool contract, ecosystems, statuses, license
CONTRIBUTING.md          # how to add an adapter (one file + fixtures + table entry)
CHANGELOG.md

src/
├── index.ts                 # shebang entry: serveStdio(createServer)
├── server.ts                # createServer(): McpServer + registerTool("check_packages")
├── tool/
│   ├── schema.ts            # zod input schema (1..100 items), envelope error messages
│   ├── check-packages.ts    # orchestration: resolve aliases, normalize, dedupe, limiter, cache, allSettled, reorder
│   └── format.ts            # VersionInfo + query → PackageResult; key presence rules; msg truncation
├── core/
│   ├── types.ts             # Ecosystem, PackageQuery, PackageResult, VersionInfo, VersionEntry, Adapter, typed outcomes
│   ├── http.ts              # fetchJson(url, {accept, timeoutMs, signal}) with UA, gzip, one retry, typed errors
│   ├── limiter.ts           # per-key concurrency limiter
│   ├── cache.ts             # TTL map with size bound
│   └── errors.ts            # NotFound (with optional reason), RegistryError, UnparseableRange, InvalidName
├── adapters/
│   ├── index.ts             # ADAPTERS table + ALIASES map + resolveEcosystem()
│   ├── npm.ts
│   ├── pypi.ts
│   ├── pub.ts
│   └── packagist.ts
└── versions/
    ├── semver-range.ts      # shared helpers over the semver lib for npm and pub.dev (pub subset guard)
    ├── pep440.ts            # PEP 440 parse, compare, specifier set
    └── composer.ts          # Composer version normalize, compare, constraint parse

tests/
├── fixtures/
│   ├── npm/        (react-abbrev.json, request-abbrev.json, unpublished.json, not-found.json, ...)
│   ├── pypi/       (requests-simple.json, all-yanked.json, deprecated-status.json, ...)
│   ├── pub/        (http.json, pedantic.json, build_runner-retracted.json, ...)
│   └── packagist/  (monolog-p2.json, swiftmailer-abandoned.json, minified-unset.json, ...)
├── unit/
│   ├── versions/   (pep440.test.ts, composer.test.ts, semver-range.test.ts)
│   ├── adapters/   (npm.test.ts, pypi.test.ts, pub.test.ts, packagist.test.ts)
│   ├── core/       (http.test.ts, limiter.test.ts, cache.test.ts)
│   └── tool/       (schema.test.ts, format.test.ts, check-packages.test.ts)
├── contract/
│   └── check-packages.contract.test.ts   # in-process server, stub fetch, examples from contracts/check_packages.md
└── helpers/
    └── stub-fetch.ts
```

**Structure Decision**: Single package, flat `src/` with four folders mirroring the four concerns in
the constitution: the tool surface (`tool/`), ecosystem-agnostic plumbing (`core/`), one file per
registry (`adapters/`), and version arithmetic (`versions/`). Tests mirror `src/` one-to-one, with
fixtures grouped by ecosystem so adding an adapter means touching exactly `src/adapters/<x>.ts`,
`src/adapters/index.ts`, `tests/unit/adapters/<x>.test.ts` and `tests/fixtures/<x>/`.

## Key design decisions (how, as decided)

1. **Status derivation is adapter-owned.** Each adapter returns a typed outcome
   (`VersionInfo | NotFound`) or throws `RegistryError`; shared code never inspects HTTP
   status codes. This is what keeps `not_found` and `error` disjoint (Constitution II).
2. **`stable` and `latest` are computed from the full version list** using the adapter's own
   comparator, with the registry's own stable hint (`dist-tags.latest`, pub `latest.version`)
   preferred when it is not a pre-release. Yanked and retracted versions never become `stable` or
   `latest`.
3. **Exact vs range is decided by the adapter's parser**: if the string parses as a complete
   version in that ecosystem it is exact; otherwise it is a range. `v` echoes the input so the agent
   can correlate.
4. **One request per package.** No adapter needs a second round-trip in the MVP (npm unpublish is
   detectable from the abbreviated doc; Packagist pre-releases are in the main p2 file).
5. **Cache stores derived data, not documents.** npm documents reach 3 MB; caching them would
   defeat Constitution IV's spirit on memory.
6. **Errors are per item and never cached.** A flaky registry gets a fresh chance on the next call.
7. **Logging** goes to stderr only, off by default, enabled with `PACKAGE_VERSION_MCP_DEBUG=1`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None after constitution 1.0.1 | The two deviations found during research (SDK v2 package name; dedicated Composer module instead of a translation layer) were accepted by the owner and folded into the constitution wording. See docs/adr/0002 for the Composer decision. | |

## Delivery pipeline

- `ci.yml`: on pull requests and pushes to `main`, run `npm ci`, `npm run build`, `npm test` on a matrix of Node 20, 22, 24 on `ubuntu-latest`, with `HTTPS_PROXY` pointed at a closed port so any accidental network call fails.
- `release.yml`: on tags `v*`, build on Node 22 and `npm publish --provenance --access public`; GitHub release notes generated from Conventional Commits. `CHANGELOG.md` is hand-maintained in Keep a Changelog format and updated in the PR that makes the change.
- Versioning: `0.1.0` first; minor versions may change response keys until `1.0.0`, which freezes the `check_packages` contract.

## Phase outputs

- Phase 0: [research.md](./research.md), all unknowns resolved; one non-blocking open item (npm package name).
- Phase 1: [data-model.md](./data-model.md), [contracts/check_packages.md](./contracts/check_packages.md), [quickstart.md](./quickstart.md).
- Phase 2 (`/speckit-tasks`): not part of this command.
