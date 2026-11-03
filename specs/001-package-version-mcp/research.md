# Research: Package Version MCP Server

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-03

All registry facts below were verified against live endpoints and official documentation on
2026-11-03. Version numbers of libraries are as published on that date and MUST be re-checked when
`package.json` is written.

## R1. MCP SDK package and server API

**Decision**: Use the v2 line of the official TypeScript SDK, package `@modelcontextprotocol/server`
(2.4.0 at research time, Node >= 20, zod 4 as a regular dependency), with `serveStdio()` from
`@modelcontextprotocol/server/stdio` and `McpServer.registerTool()` with a `z.object()` input
schema. Set annotations `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true`. Do not
set `outputSchema` (it would force `structuredContent`, a second copy of the payload).

**Rationale**: The single-package `@modelcontextprotocol/sdk` (1.32.2) is now the maintenance
line; its README points new code to v2, which implements the 2026-07-28 spec. v2 brings zod as a
normal dependency, so bundling needs no peer handling. The constitution names
`@modelcontextprotocol/sdk`; the v2 package is the same official SDK split into packages, which
satisfies the intent. A wording amendment (PATCH) is recommended.

**Alternatives considered**: v1 `@modelcontextprotocol/sdk` 1.32.2 (works, but "only serves
2025-era clients" when wired by hand and is explicitly the maintenance line); a hand-written
JSON-RPC stdio loop (no dependency at all, rejected: reimplementing capability negotiation and
protocol versions is the kind of complexity the constitution forbids without need).

**Verified facts**: stdio servers MUST write only protocol messages to stdout and log to stderr
(spec 2025-06-18 transports). Claude Code `.mcp.json` and Cursor `mcp.json` share the
`mcpServers.<name>.{command,args,env}` shape; `npx -y <pkg>` is the documented launch form.

## R2. Bundling to a single `npx`-runnable file

**Decision**: `tsup` with `format: ["esm"]`, `platform: "node"`, `target: "node20"`,
`banner.js` = shebang plus a `createRequire` shim, `noExternal` covering the SDK and zod so the
published package has zero runtime dependencies. `package.json`: `"type": "module"`, `"bin"`,
`"engines": {"node": ">=20"}`, `"files": ["dist"]`.

**Rationale**: Constitution IV. With everything inlined, `npx` downloads one tarball and starts in
well under a second. The `createRequire` banner avoids the "Dynamic require of X is not supported"
failure when CJS transitive dependencies are inlined into ESM.

**Alternatives considered**: `tsc` only with runtime deps (slower first `npx`, larger tree);
esbuild directly (equivalent, tsup is the thinner config surface).

## R3. npm adapter

**Decision**: `GET https://registry.npmjs.org/<name>` with
`Accept: application/vnd.npm.install-v1+json` (abbreviated document). Scoped names encode the
slash: `@types%2Fnode`. Derive:
- `versions` from `Object.keys(doc.versions)`; `prerelease` via semver; per-version `deprecated`
  string is present in the abbreviated doc.
- `stable` = `dist-tags.latest` when it is not a pre-release, otherwise the highest non-pre-release.
- `latest` = highest version by semver including pre-releases.
- Package-level `deprecated` iff `versions[dist-tags.latest].deprecated` is a non-empty string
  (this is what `npm view` prints). `msg` = that string.
- `not_found` iff HTTP 404 with body `{"error":"Not found"}`.
- `not_found` with `msg` "unpublished from npm" iff HTTP 200 and the document has no `versions`
  key (fully unpublished packages return `{name, modified}` only in abbreviated form). No second
  request to the full document is needed.

**Rationale**: The abbreviated doc carries everything required and is 2.4 to 3.5 times smaller
than the full doc. Still large for huge packages (react ≈ 3 MB uncompressed), so the HTTP layer
MUST send `Accept-Encoding: gzip` (Node's fetch does by default) and the cache MUST store the
derived `VersionInfo`, never the raw document.

**Verified facts**: no User-Agent required, no documented per-minute limit, clients must handle
429 (treated as `error`). Cloudflare cache `max-age=300`.

## R4. PyPI adapter

**Decision**: Simple API JSON form (PEP 691):
`GET https://pypi.org/simple/<normalized-name>/` with
`Accept: application/vnd.pypi.simple.v1+json`. Normalize names per PEP 503
(`re.sub(r"[-_.]+", "-", name).lower()`) before the request. Derive:
- `versions` from the PEP 700 `versions` list (yanked versions are included, file-less releases are
  not, which is correct: they are not installable).
- A version is `yanked` iff it has at least one file and every file's `yanked` is `true` or a
  non-empty string.
- `prerelease`, ordering and ranges via the in-house PEP 440 module (R7).
- `stable` = highest non-pre-release, non-yanked version; `latest` = highest non-yanked version.
- `deprecated` iff `project-status.status === "deprecated"` (PEP 792). `msg` = "project marked
  deprecated on PyPI".
- `ok` with no `stable`/`latest` and `msg` "all versions yanked" iff the project answers 200 but
  has no non-yanked version. `not_found` with `msg` "quarantined by PyPI" iff
  `project-status.status === "quarantined"`.
- `not_found` iff HTTP 404.

**Rationale**: The JSON API's `releases` field is officially deprecated and its documents are up to
30% larger; `info.version` is not a reliable "latest stable" (it falls back to pre-releases and
yanked releases). The Simple JSON form is the non-deprecated path and carries project status.

**Verified facts**: deleted projects are indistinguishable from never-existing ones (404 on both
APIs); PyPI applies no edge rate limit but asks for an identifying User-Agent; responses carry
`ETag` and `max-age=900`. PEP 792 also exposes `archived`; it is intentionally not mapped (spec
non-goal) and is a cheap future addition.

## R5. pub.dev adapter

**Decision**: `GET https://pub.dev/api/packages/<name>` with
`Accept: application/vnd.pub.v2+json`. Names are lowercase-only and taken as-is. Derive:
- `versions` from `versions[]` (publish order, NOT sorted: sort with the adapter comparator);
  `retracted: true` maps to `yanked`.
- `stable` = `latest.version` (pub.dev already picks the highest stable, non-retracted version, and
  only falls back to a pre-release when no stable exists; when `latest` is a pre-release, omit
  `stable`).
- `latest` = highest non-retracted version by pub ordering.
- `deprecated` iff `isDiscontinued === true`; `msg` = `replacedBy` when present
  ("discontinued, replaced by lints"), else "discontinued".
- `ok` with no `stable`/`latest` and `msg` "all versions yanked" iff every version is retracted.
- `not_found` iff HTTP 404 (body is GCS XML, not JSON; do not try to parse it).

**Rationale**: Single endpoint, all flags present, 120 s CDN cache. Moderated packages also 404, so
the only signal that a package once existed is the all-retracted case, reported as `ok` without versions.

**Verified facts**: no rate limit, UA optional; responses 75 to 350 KB uncompressed, ~10 to 25 KB
gzipped.

## R6. Packagist adapter

**Decision**: `GET https://repo.packagist.org/p2/<vendor>/<package>.json` (tagged releases only,
which already includes alpha/beta/RC tags; the `~dev.json` branch file is not needed). Lowercase
the name. Expand the `composer/2.0` minified format: entry 0 is complete, each later entry
overrides keys of the previous expanded entry, and a value of `"__unset"` deletes the key. Derive:
- `versions` from `version_normalized` (4 components) with the raw `version` kept for output.
- `prerelease` iff stability is dev, alpha, beta or RC; `patch` suffix counts as stable.
- `stable` = highest stable; `latest` = highest overall.
- `deprecated` iff `abandoned` is present on the expanded entries (`true` or a replacement name);
  `msg` = "abandoned, use <replacement>" or "abandoned".
- `not_found` iff HTTP 404. Deleted packages also 404 and are reported the same way.

**Rationale**: p2 is the static, CDN-served, 3 to 4 times smaller endpoint Composer itself uses.
The `/packages/x/y.json` endpoint is dynamic and includes downloads and stars we do not want.

**Verified facts**: Packagist asks for a User-Agent that includes a contact address and allows at
most 10 concurrent requests (20 for static files). Per-registry concurrency is therefore capped at
6 by default. Files are up to 1 MB raw / 82 KB gzipped (laravel/framework).

## R7. Version and range semantics per ecosystem

**Decision**:

| Ecosystem | Library | Notes |
|-----------|---------|-------|
| npm | `semver` | Native. `includePrerelease: false` for ranges. |
| pub.dev | `semver` | Pub syntax is a strict subset: `any` → `*`; `^`, comparators and space-AND match node-semver. Reject `~`, `||`, `x`, hyphen ranges with an `error`. Build metadata is ordered in pub but ignored by semver; the adapter comparator breaks ties on build metadata numerically. |
| PyPI | in-house `pep440.ts` | Parse `[N!]N(.N)*[{a|b|rc}N][.postN][.devN][+local]` with alias normalization (`alpha`, `c`, `pre`, `preview`, `rev`, `r`, implicit `-1`). Ordering: epoch, release (zero-padded), then `dev < a < b < rc < final < post`, local above public. Operators `== != >= <= > < ~= ===` and `==X.*`; comma-AND. Pre-releases excluded unless a clause names one or no final matches (packaging behaviour). |
| Packagist | in-house `composer.ts` | Parse exact, `=`, `!=`/`<>`, comparators, `*`/`x` wildcards, hyphen (`1.0 - 2.0` = `>=1.0.0 <2.1`), `~` (next significant release), `^`, `||`/`|` OR, space/comma AND, trailing `@stability` flags. Compare on 4-component normalized versions with stability order dev < alpha < beta < RC < stable < patch. Reject `dev-*`, `#commit`, `X as Y` with an `error`. |

**Rationale for the Composer deviation**: the constitution's Technology Constraints describe
Composer support as "a thin translation layer" onto `semver`. Research shows the translation is not
thin: hyphen ranges, `~`, 4-component versions, `patch` ordering and stability flags all differ, and
each mismatch would be a silent wrong answer (violating Constitution II). A dedicated comparator
and constraint parser is roughly the same size as the PEP 440 module and is directly testable
against the documented Composer semantics. This is recorded in the plan's Complexity Tracking and
needs the owner's acknowledgement (and a PATCH amendment of the constitution wording).

**Alternatives considered**: translating Composer to node-semver (rejected above); shelling out to
`composer` or `pip` (rejected: not guaranteed installed, slow, breaks "no network in tests");
`@renovatebot/pep440` and `@renovatebot/ruby-semver`-style packages (rejected: extra runtime
dependencies for a few hundred lines, Constitution IV).

## R8. HTTP layer, concurrency, timeouts, cache

**Decision**:
- Built-in `fetch` with `AbortSignal.timeout(8000)` per request; one retry on network error or 5xx
  with 300 ms backoff; no retry on 404 or 429 (429 → `error` with "rate limited by registry").
- `User-Agent: depver-mcp/<version> (+https://github.com/tweetgeek/depver-mcp)`. Repository URL only,
  no e-mail address: it satisfies Packagist's contact request without broadcasting an address from
  every user's machine.
- A tiny promise-based limiter per registry (default 6 in flight), implemented in-house
  (about 30 lines) rather than `p-limit`.
- In-process cache keyed by `ecosystem\0name`, TTL 5 minutes, max 10 000 entries, storing
  `VersionInfo | NotFound`, never raw documents and never errors.
- Batch orchestration: validate, resolve aliases, normalize names, deduplicate, run through the
  limiter with `Promise.allSettled` semantics so one failure never rejects the batch, reassemble in
  input order.

**Rationale**: Constitution III and IV. All four registries are CDN-fronted with 2 to 15 minute
caches, so a 5 minute local TTL cannot return anything staler than the registry itself would.

## R9. Testing without network

**Decision**: `vitest`. Adapters receive an injected `fetchJson` function; tests pass a stub that
serves recorded fixtures from `tests/fixtures/<ecosystem>/`. Each adapter has at minimum: ordinary
package, pre-release-as-newest, deprecated/abandoned/discontinued, yanked/retracted version,
not-found, nothing-installable (unpublished, all yanked, quarantined, where the registry can express it), malformed body, timeout. Version modules are
tested table-driven against cases taken from the ecosystems' own documentation. A contract test
boots the server in-process and calls `check_packages` end to end with the stub HTTP layer. A CI
guard sets an invalid `HTTPS_PROXY` so any accidental real request fails loudly.

**Rationale**: Constitution VI.

## R10. Package name

**Decision**: `depver-mcp`. The owner's first choice, `depcheck-mcp`, is already published on npm
(0.1.2, May 2026, an unrelated dependency auditor), and `depcheck` is a long-standing npm tool for
unused dependencies, so any "depcheck" name would be confused with it. Verified free on 2026-11-03:
`depver-mcp`, `pkgcheck-mcp`, `mcp-depcheck`, `package-version-mcp`.

## R11. Statuses: no `removed`

**Decision**: the status set is `ok`, `deprecated`, `not_found`, `error`. Three registries cannot
distinguish a deleted package from one that never existed, so a `removed` status would be
reliable only for npm. Instead: npm unpublished → `not_found` + `msg`; PyPI quarantine →
`not_found` + `msg`; all versions yanked/retracted → `ok` with no `stable`/`latest` + `msg`.

## R12. Delivery

**Decision**: GitHub repository named `depver-mcp`; GitHub Actions: tests on Node 20, 22, 24
(ubuntu-latest) for every PR, build and `npm publish --provenance` on `v*` tags using Node 22;
Conventional Commits; first tag `v0.1.0` after all quickstart scenarios pass; `v1.0.0` only when
the tool contract is frozen.
