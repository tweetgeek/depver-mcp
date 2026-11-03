# Tasks: Package Version MCP Server (`depver-mcp`)

**Input**: Design documents from `/specs/001-package-version-mcp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/check_packages.md, quickstart.md, `.specify/memory/constitution.md` (v1.0.1)

**Tests**: REQUIRED. Constitution VI mandates test-first for adapters and version/range logic and forbids network access in tests. Every test task precedes the implementation it covers; run it, watch it fail, then implement.

**Organization**: Grouped by user story. US1 is the MVP and carries the shared tool, server and the four adapters; US2 adds version checks; US3 adds deprecation and nothing-installable signals; US4 is installation and public-facing docs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on unfinished tasks)
- **[Story]**: US1..US4 from spec.md
- Paths are relative to the repository root (`src/`, `tests/` single project per plan.md)

## Conventions used in every task

- Language: everything in English (Constitution VII).
- Tests: `vitest`; adapters receive an injected `fetchJson` function; fixtures live in `tests/fixtures/<ecosystem>/` and are loaded by `tests/helpers/stub-fetch.ts`.
- Recording a fixture is a one-time developer action with `curl` (commands given in the task); trim huge documents to the fields and a handful of versions the test needs, and note the trimming in a `_note` key at the top of the fixture.
- Output keys and presence rules are normative in `data-model.md` ("PackageResult"); status semantics in its "Status semantics" table; tool text in `contracts/check_packages.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: An empty but buildable, testable, bundleable TypeScript package named `depver-mcp`.

- [ ] T001 Create `package.json` at repository root: `name` `depver-mcp`, `version` `0.1.0`, `description`, `license` `MIT`, `type` `module`, `bin` `{ "depver-mcp": "dist/index.js" }`, `files` `["dist"]`, `engines.node` `>=20`, `repository` `github:tweetgeek/depver-mcp`, `keywords` (mcp, package versions, npm, pypi, pub.dev, packagist, ai agents), scripts `build` (`tsup`), `test` (`vitest run`), `test:watch`, `typecheck` (`tsc --noEmit`), `format` and `format:check` (`prettier`), `prepublishOnly` (`npm run typecheck && npm test && npm run build`). Dependencies: `@modelcontextprotocol/server`, `semver` (both will be inlined by the bundler). Dev dependencies: `typescript`, `tsup`, `vitest`, `prettier`, `@types/node`, `@types/semver`. Pin versions to what `npm view <pkg> version` reports on the day (research.md R1 saw server 2.4.0, zod 4.6.7, tsup 9.0.0).
- [ ] T002 [P] Create `tsconfig.json`: `strict: true`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `lib: ["ES2022"]`, `types: ["node"]`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `rootDir: src`, `outDir: dist`, `include: ["src"]`; add `tsconfig.test.json` extending it with `include: ["src", "tests"]`.
- [ ] T003 [P] Create `tsup.config.ts`: `entry: ["src/index.ts"]`, `format: ["esm"]`, `platform: "node"`, `target: "node20"`, `bundle: true`, `noExternal: [/.*/]` (inline everything so the published package has zero runtime dependencies), `minify: false`, `sourcemap: false`, `clean: true`, `banner.js` = `#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);` (research.md R2).
- [ ] T004 [P] Create `vitest.config.ts`: `test.include: ["tests/**/*.test.ts"]`, `test.environment: "node"`, `test.setupFiles: ["tests/helpers/no-network.ts"]`, coverage disabled by default.
- [ ] T005 [P] Create `tests/helpers/no-network.ts`: in `beforeAll`, replace `globalThis.fetch` with a function that throws `Error("Network access is forbidden in tests (Constitution VI)")`; restore in `afterAll`.
- [ ] T006 [P] Create `.prettierrc` (`printWidth: 100`, `singleQuote: false`, `semi: true`, `trailingComma: "all"`), `.prettierignore` (`dist`, `tests/fixtures`), and `.editorconfig` (utf-8, lf, 2 spaces, final newline).
- [ ] T007 [P] Create `.npmignore` is NOT needed because `files: ["dist"]` is set; instead create `LICENSE` with the MIT text, copyright `2026 TweetGeek` (owner may adjust the holder name).
- [ ] T008 Run `npm install`, then `npm run typecheck`, `npm test` (expect "no test files found" or an empty pass) and `npm run build` to confirm the toolchain works on an empty `src/index.ts` that only `export {}`.

**Checkpoint**: `npm run build` produces `dist/index.js` with a shebang; `npm test` runs with network blocked.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ecosystem-agnostic types, errors, HTTP layer, limiter, cache, alias table and test helpers that every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T009 Create `src/core/types.ts` with the types from data-model.md: `Ecosystem` = `"npm" | "pypi" | "pub" | "packagist"`; `PackageQuery` `{ ecosystem: string; name: string; version?: string }`; `PackageResult` with keys `e`, `n`, `s`, `stable?`, `latest?`, `v?`, `v_exists?`, `v_yanked?`, `v_deprecated?`, `v_match?: string | null`, `msg?`; `Status` = `"ok" | "deprecated" | "not_found" | "error"`; `VersionEntry` `{ version: string; prerelease: boolean; yanked?: boolean; deprecated?: string }`; `VersionInfo` `{ name: string; versions: VersionEntry[]; stableHint?: string; deprecated?: { message: string } }`; `NotFound` `{ kind: "not_found"; reason?: string }`; `FetchOutcome` = `VersionInfo | NotFound`; `VersionCheck` = `{ kind: "exact"; version: string } | { kind: "range"; matches: (v: string) => boolean }`; `Adapter` interface `{ id: Ecosystem; concurrency: number; normalizeName(raw: string): string; fetch(name: string, http: FetchJson): Promise<FetchOutcome>; isPrerelease(v: string): boolean; compare(a: string, b: string): number; parseVersionOrRange(input: string): VersionCheck }`; `FetchJson` = `(url: string, opts: { accept?: string; timeoutMs?: number }) => Promise<{ status: number; json: unknown }>`.
- [ ] T010 [P] Create `src/core/errors.ts`: classes `RegistryError` (fields `kind: "timeout" | "network" | "http" | "malformed" | "rate_limited"`, `status?: number`, one-sentence `message`), `UnparseableRange`, `InvalidName`, `UnknownEcosystem` (message lists `npm, pypi, pub, packagist`). Each class sets `name` and is `instanceof`-safe.
- [ ] T011 [P] Write `tests/unit/core/http.test.ts` with an injected `fetch` double: (a) 200 JSON → `{ status: 200, json }`; (b) 404 → `{ status: 404, json: null }` without throwing; (c) 500 then 200 → one retry, success; (d) 500 twice → `RegistryError kind "http"`; (e) 429 → `RegistryError kind "rate_limited"` with no retry; (f) abort after `timeoutMs` → `RegistryError kind "timeout"`; (g) invalid JSON body on 200 → `RegistryError kind "malformed"`; (h) request carries `User-Agent` `depver-mcp/<version> (+https://github.com/tweetgeek/depver-mcp)` and the given `Accept` header.
- [ ] T012 Implement `src/core/http.ts`: `createFetchJson({ fetch = globalThis.fetch, userAgent, defaultTimeoutMs = 8000 })` returning a `FetchJson`; uses `AbortSignal.timeout`; one retry with 300 ms backoff on network error or 5xx; no retry on 404, 429; maps failures to `RegistryError` per T011; exports `USER_AGENT` built from the package version (read from `package.json` at build time via a `declare const __PKG_VERSION__` injected through tsup `define`, with a fallback string for tests).
- [ ] T013 [P] Write `tests/unit/core/limiter.test.ts`: per-key limiter with concurrency 2 never has more than 2 in flight for the same key, keys are independent, rejected tasks release their slot, order is FIFO.
- [ ] T014 [P] Implement `src/core/limiter.ts`: `createLimiter(defaultLimit)` with `run(key, limit, fn)`; promise queue, about 30 lines, no dependency.
- [ ] T015 [P] Write `tests/unit/core/cache.test.ts`: `get` miss → undefined; `set` then `get` → value; expired after TTL (use fake timers); max 10 000 entries evicts oldest-first; keys are `ecosystem + "\0" + name`.
- [ ] T016 [P] Implement `src/core/cache.ts`: `createCache<T>({ ttlMs = 300_000, maxEntries = 10_000, now = Date.now })` backed by a `Map` (insertion order gives oldest-first eviction).
- [ ] T017 [P] Write `tests/unit/adapters/index.test.ts`: `resolveEcosystem("YARN")` → `"npm"`; `pnpm`, `node` → `npm`; `pip`, `python`, `uv`, `poetry` → `pypi`; `dart`, `flutter`, `pub.dev` → `pub`; `composer`, `php` → `packagist`; canonical names map to themselves; `"cargo"` throws `UnknownEcosystem` whose message contains `npm, pypi, pub, packagist`; `getAdapter("npm").id === "npm"`.
- [ ] T018 Implement `src/adapters/index.ts`: `ALIASES` map (lower-cased keys), `resolveEcosystem(raw)`, `ADAPTERS: Record<Ecosystem, Adapter>` (initially filled as adapters land in US1), `getAdapter(ecosystem)`.
- [ ] T019 [P] Create `tests/helpers/stub-fetch.ts`: `stubFetchJson(routes: Record<string, { status: number; json?: unknown; fixture?: string; throws?: Error }>)` returning a `FetchJson` that matches by exact URL, loads `tests/fixtures/<fixture>` lazily, records every call (`calls: string[]`) for assertions, and throws on unmatched URLs so a test can never silently hit the network.
- [ ] T020 [P] Create `src/core/log.ts`: `debug(...args)` writes to `process.stderr` only when `process.env.DEPVER_MCP_DEBUG === "1"`; never touches stdout.

**Checkpoint**: `npm test` green for core; `src/adapters/index.ts` compiles with an empty adapter table.

---

## Phase 3: User Story 1 - Verify versions for a batch of mixed packages (Priority: P1) 🎯 MVP

**Goal**: `check_packages` answers a batch of up to 100 items from mixed ecosystems with `e`, `n`, `s` (`ok` or `not_found`), `stable`, `latest`, in input order, with per-item errors isolated.

**Independent Test**: Contract test sends one item per ecosystem plus a misspelled name and an unknown ecosystem; results come back in order with correct statuses and versions taken from fixtures. Manual: MCP Inspector against `dist/index.js` shows one tool and real versions.

### Version ordering modules (test-first)

- [ ] T021 [P] [US1] Write `tests/unit/versions/semver-range.test.ts` for ordering only: `compare("1.10.0","1.9.0") > 0`; `isPrerelease("1.0.0-beta.1") === true`; `isPrerelease("1.0.0") === false`; pub tie-break `compare("1.2.3+2","1.2.3+1") > 0` (build metadata ordered numerically, research.md R7).
- [ ] T022 [P] [US1] Implement ordering part of `src/versions/semver-range.ts`: `compareSemver`, `isSemverPrerelease`, `compareWithBuildTieBreak` using the `semver` library (`semver.compare`, `semver.prerelease`) plus the build-metadata tie-break.
- [ ] T023 [P] [US1] Write `tests/unit/versions/pep440.test.ts` for parsing and ordering (table-driven from PEP 440 examples in research.md R7): parse `1.0`, `1.0.0`, `1!2.0`, `1.0a1`, `1.0.alpha1` → `1.0a1`, `1.0rc1`, `1.0c1` → `1.0rc1`, `1.0.post1`, `1.0-1` → `1.0.post1`, `1.0.dev1`, `1.0+local.1`; ordering `1.0.dev1 < 1.0a1 < 1.0b1 < 1.0rc1 < 1.0 < 1.0.post1 < 1.1`; epoch `1!1.0 > 2.0`; zero-padding `1.0 == 1.0.0`; `isPrerelease` true for a/b/rc/dev, false for final and post; invalid strings return `null` from `parse`.
- [ ] T024 [P] [US1] Implement parse/compare in `src/versions/pep440.ts`: `parsePep440(s): Pep440Version | null` (epoch, release number[], pre `[letter, n]?`, post `n?`, dev `n?`, local string[]?), `comparePep440(a, b)`, `isPep440Prerelease(v)`; normalization of aliases and case per PEP 440.
- [ ] T025 [P] [US1] Write `tests/unit/versions/composer.test.ts` for normalization and ordering (table-driven from research.md R6): `normalize("v1.2.3")` → `1.2.3.0`; `1.2` → `1.2.0.0`; `1.0.0-beta1`, `1.0.0-RC2`, `1.0.0-alpha.3`, `1.0.0-p1`, `1.0.0-patch1` accepted; stability `dev < alpha < beta < RC < stable`, and `1.0.0-patch1 > 1.0.0`; `isPrerelease` true for dev/alpha/beta/RC, false for stable and patch; `dev-main` and `2.x-dev` parse as branch versions with `isPrerelease === true`.
- [ ] T026 [P] [US1] Implement normalize/compare in `src/versions/composer.ts`: `normalizeComposer(s): ComposerVersion | null` (4 numeric components + stability `{ kind, n }`), `compareComposer(a, b)`, `isComposerPrerelease(v)`, `formatComposer(v)` returning the original tag string for output.

### Adapters (test-first, one file per ecosystem, Constitution V)

- [ ] T027 [P] [US1] Record fixtures `tests/fixtures/npm/react-abbrev.json` (trim `versions` to ~12 entries spanning `0.7.1`, `16.6.2`, `18.2.0`, `18.3.1`, `19.0.0-rc.1`, `19.2.0`, keep `dist-tags`), `tests/fixtures/npm/not-found.json` (`{"error":"Not found"}`), `tests/fixtures/npm/prerelease-newest.json` (synthetic: `dist-tags.latest` `1.0.0`, versions `1.0.0`, `1.1.0-beta.1`), `tests/fixtures/npm/only-prerelease.json` (synthetic: `dist-tags.latest` `0.1.0-beta.1`, single version). Commands: `curl -s -H 'Accept: application/vnd.npm.install-v1+json' https://registry.npmjs.org/react`, then trim.
- [ ] T028 [P] [US1] Write `tests/unit/adapters/npm.test.ts`: `normalizeName("React")` → `"react"`; `normalizeName("@types/node")` keeps scope; invalid names (`""`, `"a b"`, `".dot"`) throw `InvalidName`; URL for scoped name is `https://registry.npmjs.org/@types%2Fnode` with `Accept: application/vnd.npm.install-v1+json`; `react-abbrev.json` → `VersionInfo` with `stableHint` = `dist-tags.latest`, every version present with `prerelease` and `deprecated` (string) populated; `not-found.json` with status 404 → `{ kind: "not_found" }`; 200 with no `versions` key → `{ kind: "not_found", reason: "unpublished from npm" }`; malformed body (array instead of object) → `RegistryError malformed`.
- [ ] T029 [US1] Implement `src/adapters/npm.ts` per research.md R3 and T028; `concurrency: 6`; `isPrerelease`/`compare` delegate to `src/versions/semver-range.ts`; `parseVersionOrRange` throws `UnparseableRange("not implemented")` until US2.
- [ ] T030 [P] [US1] Record fixtures `tests/fixtures/pypi/requests-simple.json` (`curl -s -H 'Accept: application/vnd.pypi.simple.v1+json' https://pypi.org/simple/requests/`, trim `files` to those of versions `2.19.1`, `2.31.0`, `2.32.0` (yanked, keep the string reason), `2.32.5`, keep `versions` trimmed to the same set plus `2.15.0`-style file-less version removed, keep `meta` and `project-status`), `tests/fixtures/pypi/not-found.json` (empty object, used with 404), `tests/fixtures/pypi/prerelease-newest.json` (synthetic: versions `1.0.0`, `1.1.0rc1`).
- [ ] T031 [P] [US1] Write `tests/unit/adapters/pypi.test.ts`: `normalizeName("Typing_Extensions")` → `"typing-extensions"`; `normalizeName("zope.interface")` → `"zope-interface"`; invalid (`""`, `"-bad"`) throw `InvalidName`; URL `https://pypi.org/simple/requests/` with the PEP 691 Accept header; `requests-simple.json` → versions from `versions` list, `yanked` true for `2.32.0` (all its files carry a non-empty string), false for others, `prerelease` via PEP 440; 404 → `not_found`; `project-status.status === "quarantined"` → `{ kind: "not_found", reason: "quarantined by PyPI" }`; body without `versions` array → `RegistryError malformed`.
- [ ] T032 [US1] Implement `src/adapters/pypi.ts` per research.md R4 and T031; `isPrerelease`/`compare` delegate to `src/versions/pep440.ts`; `parseVersionOrRange` stubbed until US2.
- [ ] T033 [P] [US1] Record fixtures `tests/fixtures/pub/http.json` (`curl -s -H 'Accept: application/vnd.pub.v2+json' https://pub.dev/api/packages/http`, trim each version's `pubspec` to `{}` and keep ~8 versions including `1.5.0-beta.2`, `1.5.0`, `1.6.0`, keep `latest` as served), `tests/fixtures/pub/not-found.xml` (the GCS `NoSuchKey` XML body, stored as text), `tests/fixtures/pub/only-prerelease.json` (synthetic: `latest.version` `0.1.3-main.0`, single version).
- [ ] T034 [P] [US1] Write `tests/unit/adapters/pub.test.ts`: `normalizeName` trims and rejects uppercase/invalid (`"Http"`, `"bad-name"`) with `InvalidName`; URL `https://pub.dev/api/packages/http` with Accept `application/vnd.pub.v2+json`; `http.json` → versions unsorted in input are returned with `retracted` mapped to `yanked`, `stableHint` = `latest.version` only when it is not a pre-release; 404 with a non-JSON body → `not_found` without throwing; missing `versions` → `RegistryError malformed`.
- [ ] T035 [US1] Implement `src/adapters/pub.ts` per research.md R5 and T034; ordering via `compareWithBuildTieBreak`; `parseVersionOrRange` stubbed until US2.
- [ ] T036 [P] [US1] Record fixtures `tests/fixtures/packagist/monolog-p2.json` (`curl -s -A 'depver-mcp-dev (+https://github.com/tweetgeek/depver-mcp)' https://repo.packagist.org/p2/monolog/monolog.json`, trim to ~10 entries including `3.0.0-RC1`, `2.9.3`, `3.12.1`, keep the `minified` marker and at least one `__unset`), `tests/fixtures/packagist/not-found.txt` (`404 not found, no packages here`), `tests/fixtures/packagist/minified-unset.json` (synthetic 3-entry file exercising key inheritance and `__unset`).
- [ ] T037 [P] [US1] Write `tests/unit/adapters/packagist.test.ts`: `normalizeName("Monolog/Monolog")` → `"monolog/monolog"`; names without `/` or with more than one `/` throw `InvalidName`; URL `https://repo.packagist.org/p2/monolog/monolog.json`; `minified-unset.json` expands so that entry 2 inherits `require` from entry 1 and has `extra` removed by `"__unset"`; `monolog-p2.json` → versions with `prerelease` true for `3.0.0-RC1`; 404 → `not_found`; body lacking `packages[name]` array → `RegistryError malformed`.
- [ ] T038 [US1] Implement `src/adapters/packagist.ts` per research.md R6 and T037 with an internal `expandMinified()`; ordering via `src/versions/composer.ts`; `concurrency: 6`; `parseVersionOrRange` stubbed until US2.
- [ ] T039 [US1] Register the four adapters in `src/adapters/index.ts` `ADAPTERS` table and extend `tests/unit/adapters/index.test.ts` to assert all four ids resolve.

### Tool surface

- [ ] T040 [P] [US1] Write `tests/unit/tool/schema.test.ts`: valid batch of 1 passes; 0 items fails with message `packages must contain between 1 and 100 items (got 0)`; 101 items fails with `(got 101)`; item with `name: ""` fails with `packages[0].name must be a non-empty string`; item with numeric `ecosystem` fails with `packages[0].ecosystem must be a string`; unknown extra keys are rejected; `version` is optional and trimmed.
- [ ] T041 [US1] Implement `src/tool/schema.ts` with zod (`import * as z from "zod/v4"`): `CheckPackagesInput` object schema (`packages` array `min(1).max(100)`, item `{ ecosystem: z.string(), name: z.string().min(1), version: z.string().optional() }`, `strict()`), plus `formatEnvelopeError(zodError)` producing exactly the three message shapes from contracts/check_packages.md ("Error text").
- [ ] T042 [P] [US1] Write `tests/unit/tool/format.test.ts` for the no-version-check path: `VersionInfo` with stable and prerelease versions → `{ e, n, s: "ok", stable, latest }`; `stableHint` preferred when not a pre-release; yanked versions excluded from both `stable` and `latest`; only pre-releases → `latest` present, `stable` absent (key missing, not null); all versions yanked → `s: "ok"`, no `stable`/`latest`, `msg: "all versions yanked"`; `NotFound` → `{ e, n, s: "not_found" }` plus `msg` when `reason` set; `RegistryError timeout` → `{ e, n, s: "error", msg: "registry timeout after 8000 ms" }`; `UnknownEcosystem` → `s: "error"` with the supported list; result objects never contain `undefined`, `null` (except `v_match`), or empty-string values; `msg` truncated to first sentence and max 160 chars.
- [ ] T043 [US1] Implement `src/tool/format.ts`: `formatResult(query, canonicalEcosystem, normalizedName, outcome | Error, adapter)` with `pickStable`, `pickLatest`, `truncateSentence(msg, 160)`, and a final `stripEmpty()` enforcing the presence rules of data-model.md.
- [ ] T044 [P] [US1] Write `tests/unit/tool/check-packages.test.ts` with `stub-fetch`: a 5-item mixed batch returns 5 results in input order; duplicate items (`npm:react` twice) produce two results but one recorded fetch; a stub that throws for one item leaves the other four `ok`; a second identical call makes zero new fetches (cache); unknown ecosystem item is `error` while the batch succeeds; concurrency: with 20 npm items and a stub that resolves on demand, in-flight count never exceeds 6.
- [ ] T045 [US1] Implement `src/tool/check-packages.ts`: `createCheckPackages({ fetchJson, cache, limiter, adapters })` returning `async (input) => { results }`; steps: resolve alias → normalize name → dedupe by `ecosystem\0name` → cache lookup → `limiter.run(ecosystem, adapter.concurrency, () => adapter.fetch(...))` → store `VersionInfo | NotFound` in cache (never errors) → `formatResult` per original item → reorder to input order; use `Promise.allSettled` so an item's failure never rejects the batch.
- [ ] T046 [US1] Implement `src/server.ts`: `createServer()` builds `McpServer({ name: "depver-mcp", version })`, registers `check_packages` with `title`, `description` and `annotations` copied verbatim from contracts/check_packages.md ("Tool metadata"), `inputSchema` from `src/tool/schema.ts`; handler returns `{ content: [{ type: "text", text: JSON.stringify(result) }] }` (minified, no `structuredContent`); envelope validation failures return `{ content: [{ type: "text", text: message }], isError: true }`.
- [ ] T047 [US1] Implement `src/index.ts`: shebang-free source (tsup adds it), `serveStdio(createServer, { onerror: (e) => debug(e) })` from `@modelcontextprotocol/server/stdio`; never writes to stdout; on `DEPVER_MCP_DEBUG=1` prints a one-line startup notice to stderr.
- [ ] T048 [US1] Write `tests/contract/check-packages.contract.test.ts`: boot `createServer()` in-process with an in-memory client transport from the SDK (or call the registered tool handler directly if the SDK's test transport is unavailable), send the 9-item example request from contracts/check_packages.md with `stub-fetch` routes for every URL, and assert: 9 results in order, `react` `ok` with `stable` and `latest`, `htttp` `not_found`, `cargo` `error` with the supported-ecosystems message, exactly one `text` content block, and that `JSON.parse(text)` round-trips with no whitespace in `text`. (US2/US3 assertions for this test are added in T058 and T067.)
- [ ] T049 [US1] Build with `npm run build`; verify `dist/index.js` starts with `#!/usr/bin/env node`, is executable, and `node dist/index.js < /dev/null` exits without writing to stdout; run `npx @modelcontextprotocol/inspector node dist/index.js` manually and confirm the single tool `check_packages` appears (quickstart.md Scenario 1, steps 1 to 3 against live registries).

**Checkpoint**: MVP. A batch of mixed packages returns real versions; errors are per item; no network in tests.

---

## Phase 4: User Story 2 - Check a specific version or range before installing or updating (Priority: P2)

**Goal**: `version` accepts an exact version or a native-syntax range; results carry `v`, `v_exists`, `v_yanked`, `v_deprecated` or `v_match`.

**Independent Test**: Table in quickstart.md Scenario 4 passes against fixtures; unparseable range errors only its own item.

### Range modules (test-first)

- [ ] T050 [P] [US2] Extend `tests/unit/versions/semver-range.test.ts`: npm `parseVersionOrRange("18.2.0")` → exact; `"^18"` → range matching `18.3.1` not `19.0.0` nor `18.0.0-beta.1`; `"~1.2"` → `<1.3.0`; `"1.x"`, `">=1 <2"`, `"1.0.0 - 1.5.0"`, `"||"` combos valid; `"latest"`, `">>=1"` throw `UnparseableRange`. pub mode: `"any"` → matches everything stable; `"^1.0.0"`, `">=0.13.0 <1.0.0"` valid; `"~1.2"`, `"1.x"`, `"1.0.0 - 2.0.0"`, `"^1 || ^2"` throw `UnparseableRange` (pub has no such syntax, research.md R5).
- [ ] T051 [US2] Implement range part of `src/versions/semver-range.ts`: `parseSemverCheck(input, { dialect: "npm" | "pub" })` using `semver.valid` for exact and `new semver.Range(input, { includePrerelease: false })` for ranges, with a pub-dialect pre-validation that rejects `~`, `x`/`*` wildcards (except bare `any`), hyphen ranges and `||`.
- [ ] T052 [P] [US2] Extend `tests/unit/versions/pep440.test.ts` with specifiers: `==2.31.0` exact; `==2.*` matches `2.32.5` not `3.0.0`; `>=2.0,<2.20` → highest `2.19.1`; `~=2.31` ≡ `>=2.31,==2.*`; `!=2.32.0`; `>2.0` excludes `2.0.post1`; `<2.0` excludes `2.0rc1`; pre-releases excluded unless a clause names one (`>=1.0a1`) or no final matches; `===` string equality; `~=2` (single segment) and `==2.*.*` invalid → `UnparseableRange`; whitespace around commas tolerated.
- [ ] T053 [US2] Implement specifiers in `src/versions/pep440.ts`: `parsePep440Check(input)` → exact when the whole string is a bare version, else `SpecifierSet` with the operator rules of research.md R4/R7 and a `matches(versions)` helper that applies the pre-release fallback rule over the candidate list.
- [ ] T054 [P] [US2] Extend `tests/unit/versions/composer.test.ts` with constraints: exact `1.2.3` and `=1.2.3`; `1.0.*`; `>=1.0 <2.0` and `>=1.0,<2.0`; `1.0 - 2.0` matches `2.0.9` but not `2.1.0`; `1.0.0 - 2.1.0` inclusive upper; `~1.2` matches `1.9.0` not `2.0.0`; `~1.2.3` matches `1.2.9` not `1.3.0`; `^1.2.3` → `<2.0.0`; `^0.3` → `<0.4.0`; `^0.0.3` → `<0.0.4`; `^1.0 || ^2.0`; `1.0.*@dev` accepted (flag parsed, ignored for stable matching); `dev-main`, `1.x-dev`, `#abc123`, `1.0 as 2.0`, `~>1.2` throw `UnparseableRange`.
- [ ] T055 [US2] Implement constraints in `src/versions/composer.ts`: `parseComposerCheck(input)` tokenizing OR (`||`, `|`) then AND (space, comma), expanding `*`/`x`, hyphen, `~`, `^` to comparator pairs over `ComposerVersion`, stripping `@stability` flags.

### Adapter and tool wiring

- [ ] T056 [US2] Replace the `parseVersionOrRange` stubs: `src/adapters/npm.ts` → `parseSemverCheck(input, { dialect: "npm" })`; `src/adapters/pub.ts` → dialect `"pub"`; `src/adapters/pypi.ts` → `parsePep440Check`; `src/adapters/packagist.ts` → `parseComposerCheck`; add one adapter-level test each in the existing adapter test files asserting the delegation.
- [ ] T057 [US2] Extend `tests/unit/tool/format.test.ts`: exact existing → `v`, `v_exists: true`; exact missing → `v_exists: false` with `stable`/`latest` still present; exact yanked (pypi) → `v_yanked: true`; exact deprecated (npm) → `v_deprecated: true`; `v_yanked` absent for npm and `v_deprecated` absent for pypi (registry has no such concept); range → `v_match` = highest **stable** satisfying version, `null` when none (key present with null); `UnparseableRange` → `s: "error"` with one-sentence `msg`, other keys absent; then implement in `src/tool/format.ts` (`applyVersionCheck`).
- [ ] T058 [US2] Extend `tests/contract/check-packages.contract.test.ts` with the version-bearing items of the example request (PyPI exact `2.31.0`, PyPI range `>=2.0,<2.20`, pub `^1.0.0`, Packagist `~10.0`, npm `left-pad@1.3.0`) and an unparseable range item, asserting the contract's example keys and that the unparseable item alone is `error`.
- [ ] T059 [US2] Add `tests/fixtures/packagist/laravel-p2.json` (trimmed to versions spanning `v10.48.29`, `v11.0.0`, `v12.30.1`) and `tests/fixtures/pub/http-ranges.json` if `http.json` lacks a `0.13.x` version, so quickstart.md Scenario 4 rows are each covered by a unit or contract test.

**Checkpoint**: Scenario 4 table from quickstart.md is fully covered by tests; `npm run build` still produces one file.

---

## Phase 5: User Story 3 - Learn that a package is deprecated or no longer installable (Priority: P3)

**Goal**: `s: "deprecated"` with a one-sentence `msg` for package-level deprecation; honest `not_found`/`ok` signals with `msg` for unpublished, quarantined and all-yanked cases.

**Independent Test**: Fixtures for `request` (npm), `pedantic` (pub), `swiftmailer/swiftmailer` (Packagist), a PEP 792 deprecated project (PyPI), `unpublish-me` (npm), an all-yanked and a quarantined PyPI project each produce the expected status and `msg`.

- [ ] T060 [P] [US3] Record fixtures: `tests/fixtures/npm/request-abbrev.json` (trim to 3 versions, keep `deprecated` strings and `dist-tags`), `tests/fixtures/npm/unpublished.json` (`curl -s -H 'Accept: application/vnd.npm.install-v1+json' https://registry.npmjs.org/unpublish-me`), `tests/fixtures/npm/old-version-deprecated.json` (synthetic: only `0.7.1` deprecated, `dist-tags.latest` `19.2.0` not deprecated).
- [ ] T061 [P] [US3] Record fixtures: `tests/fixtures/pypi/deprecated-status.json` (synthetic Simple JSON with `project-status.status: "deprecated"`), `tests/fixtures/pypi/all-yanked.json` (synthetic, every file yanked), `tests/fixtures/pypi/quarantined.json` (`project-status.status: "quarantined"`, empty `versions` and `files`).
- [ ] T062 [P] [US3] Record fixtures: `tests/fixtures/pub/pedantic.json` (`curl -s https://pub.dev/api/packages/pedantic`, trim versions, keep `isDiscontinued` and `replacedBy`), `tests/fixtures/pub/all-retracted.json` (synthetic), `tests/fixtures/pub/build_runner-retracted.json` (trim to the two retracted versions plus `2.17.1`).
- [ ] T063 [P] [US3] Record fixtures: `tests/fixtures/packagist/swiftmailer-abandoned.json` (`abandoned: "symfony/mailer"`, trim), `tests/fixtures/packagist/faker-abandoned.json` (`abandoned: true`, trim).
- [ ] T064 [US3] Extend the four adapter tests (`tests/unit/adapters/*.test.ts`) and adapters: npm sets `VersionInfo.deprecated.message` only when `versions[dist-tags.latest].deprecated` is non-empty (old-version-only deprecation leaves it unset); pypi sets it for `project-status.status === "deprecated"` with message `project marked deprecated on PyPI`; pub sets it for `isDiscontinued` with message `discontinued, replaced by <replacedBy>` or `discontinued`; packagist sets it for `abandoned` with `abandoned, use <name>` or `abandoned`. Implement in `src/adapters/{npm,pypi,pub,packagist}.ts`.
- [ ] T065 [US3] Extend `tests/unit/tool/format.test.ts` and `src/tool/format.ts`: `deprecated` present → `s: "deprecated"`, `stable` and `latest` still present, `msg` = message truncated to the first sentence (verify on the real multi-clause `request` message that the output ends at the first `.`/`!`/`?` boundary or 160 chars); `deprecated` plus all yanked → `s: "deprecated"` with `msg` from deprecation (deprecation wins); `v_deprecated` on an exact version of a non-deprecated package stays `s: "ok"`.
- [ ] T066 [US3] Extend `tests/unit/tool/check-packages.test.ts`: `unpublish-me` → `not_found` with `msg: "unpublished from npm"`; quarantined → `not_found` with `msg: "quarantined by PyPI"`; all-yanked → `ok` with `msg: "all versions yanked"` and no version keys; never-existing → `not_found` with no `msg`.
- [ ] T067 [US3] Extend `tests/contract/check-packages.contract.test.ts` with the `request` (deprecated) and `unpublish-me` items from contracts/check_packages.md examples.

**Checkpoint**: All four statuses are exercised end to end; `msg` is always one sentence.

---

## Phase 6: User Story 4 - Install the server in under a minute (Priority: P3)

**Goal**: A stranger can install `depver-mcp` from the README into Claude Code or Cursor and get a first answer in under 2 minutes; the repository reads as a professional open-source project.

**Independent Test**: On a clean machine with Node 20+, follow README only; the agent lists `check_packages` and a call succeeds (quickstart.md Scenario 5 and 6).

- [ ] T068 [P] [US4] Write `README.md`: one-paragraph purpose (stop agents from hallucinating package versions), badges (npm version, CI, license), "Install" with the exact `.mcp.json` snippet (`"depver": { "command": "npx", "args": ["-y", "depver-mcp"] }`), the `claude mcp add --transport stdio depver --scope project -- npx -y depver-mcp` one-liner, and the Cursor `mcp.json` equivalent; "What the agent sees" with the tool description; "Input" and "Output" sections copied from contracts/check_packages.md including the example and the status table from data-model.md; "Supported ecosystems" table with aliases; "Version checks" with one range example per ecosystem; "Limits" (100 items, 8 s timeout, 5 min cache, no persistence); "Privacy" (queries go from the user's machine straight to public registries, User-Agent identifies the tool by repository URL only); "Contributing" link; "License" MIT.
- [ ] T069 [P] [US4] Write `CONTRIBUTING.md`: dev setup (`npm ci`, `npm test`, `npm run build`), the no-network test rule, "Adding an ecosystem" recipe (create `src/adapters/<id>.ts` implementing `Adapter`, add fixtures under `tests/fixtures/<id>/` covering the mandatory set from research.md R9, add tests, register in `src/adapters/index.ts`, add aliases, update README table), Conventional Commits, English-only rule, and the dependency-justification rule from the constitution.
- [ ] T070 [P] [US4] Create `CHANGELOG.md` with a `## [Unreleased]` section and a `## [0.1.0]` placeholder following Keep a Changelog headings.
- [ ] T071 [P] [US4] Create `.mcp.json.example` at the repository root with the `depver` entry, and `docs/clients.md` with the Claude Code, Cursor and generic stdio configuration snippets (research.md R1).
- [ ] T072 [US4] Verify `package.json` publish surface: `npm pack --dry-run` lists only `dist/index.js`, `package.json`, `README.md`, `LICENSE` (and `CHANGELOG.md` if desired); `bin` resolves; `engines.node >=20`; no `dependencies` field leaks into the tarball consumers' install (dependencies are inlined, so move SDK and semver to `devDependencies` after confirming the bundle is self-contained, or keep them and document why).
- [ ] T073 [US4] Manual run of quickstart.md Scenario 5: add the snippet to a scratch project's `.mcp.json`, start Claude Code, ask for the latest versions of `react`, `requests` and `laravel/framework`, confirm a single `check_packages` call and real versions; record elapsed time (target < 2 minutes) in the PR description.

**Checkpoint**: README alone is enough to install and use the tool.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: CI, release automation, size and performance guards, and the final quickstart pass.

- [ ] T074 [P] Create `.github/workflows/ci.yml`: triggers `pull_request` and `push` to `main`; matrix `node-version: [20, 22, 24]` on `ubuntu-latest`; steps `actions/checkout`, `actions/setup-node` with cache `npm`, `npm ci`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`; env `HTTPS_PROXY=http://127.0.0.1:9` and `HTTP_PROXY=http://127.0.0.1:9` so any real request fails.
- [ ] T075 [P] Create `.github/workflows/release.yml`: trigger `push` tags `v*`; Node 22; `npm ci`, `npm test`, `npm run build`, `npm publish --provenance --access public` with `NODE_AUTH_TOKEN` from the `NPM_TOKEN` secret and `id-token: write` permission; create a GitHub release with notes generated from Conventional Commits (e.g. `softprops/action-gh-release` with `generate_release_notes: true`).
- [ ] T076 [P] Add `tests/unit/tool/size.test.ts`: a result with no version check for a typical name serializes to ≤ 120 characters; a synthetic 100-item batch of `ok` results serializes to < 12 KB (SC-005).
- [ ] T077 [P] Add `tests/unit/tool/timing.test.ts` with fake timers: a batch where one stub hangs resolves within `8000 ms + 500 ms` and the hanging item is `error` with `registry timeout after 8000 ms` (SC-001 bound, FR-014).
- [ ] T078 [P] Add a `scripts/check-bundle.mjs` run by `npm run build:check`: fails if `dist/index.js` exceeds 1.5 MB or lacks the shebang, and times `node dist/index.js --version`-style startup (add a `--version` flag to `src/index.ts` that prints the version to stderr and exits 0) to be under 1 s (SC-007).
- [ ] T079 Add `src/index.ts` handling for `--help` (prints a one-paragraph usage to stderr, exit 0) so a curious `npx depver-mcp --help` user is not left with a silent process.
- [ ] T080 Run `npm run format`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:check`; fix anything red.
- [ ] T081 Execute quickstart.md Scenarios 1 to 6 end to end against live registries from a clean checkout and record the results (pass/fail per scenario, timings) in `specs/001-package-version-mcp/quickstart-results.md`.
- [ ] T082 Tag `v0.1.0` only after T081 is fully green; push the tag to trigger `release.yml`; verify the npm page shows provenance and `npx -y depver-mcp --help` works from a machine that never built the project.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: starts immediately; T001 before T008; T002 to T007 in parallel.
- **Foundational (Phase 2)**: after Phase 1; T009 first (types), then T010 to T020 largely in parallel; T018 depends on T009/T010.
- **US1 (Phase 3)**: after Phase 2. Within it: version ordering (T021 to T026) and fixtures (T027, T030, T033, T036) in parallel → adapter tests → adapters → T039 → tool schema/format/orchestration → server → contract test → build check.
- **US2 (Phase 4)**: after US1 (needs adapters and format). Range modules T050 to T055 in parallel per ecosystem.
- **US3 (Phase 5)**: after US1; independent of US2 (touches status/`msg`, not version checks). Can run in parallel with US2 if two people work, but both edit `src/tool/format.ts`, so coordinate.
- **US4 (Phase 6)**: after US1 (needs a buildable server); docs can be drafted in parallel with US2/US3 and finalized after them.
- **Polish (Phase 7)**: after all desired stories; T074/T075 can be written any time after Phase 1 but should be merged last.

### User Story Dependencies

- **US1 (P1)**: foundation only.
- **US2 (P2)**: US1 (adapters, format).
- **US3 (P3)**: US1 (adapters, format); independent of US2.
- **US4 (P3)**: US1 (something to install); content references US2/US3 features.

### Within Each User Story

- Test file before implementation file; run the test, see it fail, implement, see it pass.
- Fixtures before adapter tests; version modules before adapters; adapters before tool; tool before server; server before contract test.

### Parallel Opportunities

- Phase 1: T002 to T007 (six files, no overlap).
- Phase 2: T011/T012, T013/T014, T015/T016, T017/T018 pairs are independent of each other; T019, T020 free.
- US1: four fixture-recording tasks; three version-module pairs; four adapter test/impl pairs (each pair sequential, pairs parallel); schema and format tests.
- US2: three range-module pairs in parallel.
- US3: four fixture tasks in parallel, then the adapter extensions in parallel.
- US4: T068 to T071 in parallel.
- Polish: T074 to T078 in parallel.

---

## Parallel Example: User Story 1

```bash
# Fixtures and version modules together (different files):
Task: "T027 record npm fixtures in tests/fixtures/npm/"
Task: "T030 record PyPI fixtures in tests/fixtures/pypi/"
Task: "T033 record pub.dev fixtures in tests/fixtures/pub/"
Task: "T036 record Packagist fixtures in tests/fixtures/packagist/"
Task: "T021+T022 semver ordering in src/versions/semver-range.ts"
Task: "T023+T024 PEP 440 ordering in src/versions/pep440.ts"
Task: "T025+T026 Composer ordering in src/versions/composer.ts"

# Then the four adapter pairs together (each pair test-first):
Task: "T028→T029 npm adapter"
Task: "T031→T032 PyPI adapter"
Task: "T034→T035 pub.dev adapter"
Task: "T037→T038 Packagist adapter"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 US1: ordering modules, fixtures, adapters, tool, server, contract test, build.
3. **STOP and VALIDATE**: quickstart Scenario 1 against live registries with the Inspector. If it works, the tool is already useful: it stops agents from inventing versions.

### Incremental Delivery

1. US1 → usable MVP (`0.1.0` candidate).
2. US2 → exact and range checks (the dependency-update use case).
3. US3 → deprecation and nothing-installable signals.
4. US4 → README, CONTRIBUTING, client docs; then Phase 7 CI, release, `v0.1.0`.

### Parallel Team Strategy

With two people after Phase 2: one takes npm + pub.dev (both semver), the other PyPI + Packagist (both in-house parsers), through US1 and US2; they meet at `src/tool/format.ts` for US3.

---

## Notes

- Each adapter file is the only place that knows its registry's URL, headers, body shape, name rules and version syntax (Constitution V).
- Never cache `RegistryError`; never emit `removed`; never turn a timeout into `not_found` (Constitution II).
- Commit after each task or pair with a Conventional Commit message in English.
- If a live registry changes shape while recording fixtures, update research.md in the same PR.
