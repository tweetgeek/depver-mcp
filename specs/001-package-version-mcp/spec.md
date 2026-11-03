# Feature Specification: Package Version MCP Server

**Feature Branch**: `001-package-version-mcp`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Local MCP server for AI coding agents that verifies package versions across multiple package ecosystems, to stop agents from hallucinating versions when scaffolding new projects, adding dependencies, or updating dependencies. Runs locally over stdio via npx or an .mcp.json entry, no remote service, no auth, no database. Single tool `check_packages` accepting up to 100 packages from mixed ecosystems (npm, PyPI, pub.dev, Packagist in MVP), returning compact per-package results: status, latest stable, latest overall, and exact-version or range checks. Open source, entire repository in English."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify versions for a batch of mixed packages (Priority: P1)

A developer is building a new project with an AI coding agent. The agent is about to write a dependency manifest (for example `package.json`, `requirements.txt`, `pubspec.yaml`, `composer.json`) and, instead of guessing versions from memory, calls the server with the list of packages it intends to use. The server queries the public registries on the developer's machine and returns, for every package, whether it exists, its latest stable version and its latest version overall. The agent writes the manifest with real, current versions.

**Why this priority**: This is the core value of the product. Without it nothing else matters. A single batch call that answers "does this exist and what is current" removes the most common hallucination: an invented or outdated version number.

**Independent Test**: Can be fully tested by sending one batch containing at least one package from each supported ecosystem and verifying that each result carries the correct status and versions as published by the respective registry on that day.

**Acceptance Scenarios**:

1. **Given** the server is connected to an agent, **When** the agent asks for `npm:react`, `pypi:requests`, `pub:http` and `packagist:laravel/framework` in one call, **Then** the response contains exactly four results, each with `status: ok`, a `stable` version and a `latest` version matching the public registry.
2. **Given** a batch that mixes a real package and a misspelled one, **When** the agent sends it, **Then** the real package returns `ok` and the misspelled one returns `not_found`, and the batch as a whole succeeds.
3. **Given** a package whose latest release is a pre-release (for example a release candidate), **When** the agent asks for it, **Then** `stable` is the highest non-pre-release version and `latest` is the pre-release, and both fields are present.
4. **Given** a package whose latest stable and latest overall are the same version, **When** the agent asks for it, **Then** both `stable` and `latest` are present and equal.
5. **Given** a batch of 101 items, **When** the agent sends it, **Then** the server rejects the whole request with a validation error that names the limit, and nothing is silently truncated.
6. **Given** the agent uses an ecosystem alias (`pnpm`, `yarn`, `pip`, `dart`, `flutter`, `composer`), **When** it sends the request, **Then** the server resolves the alias to the canonical ecosystem and the result reports the canonical ecosystem name.

---

### User Story 2 - Check a specific version or range before installing or updating (Priority: P2)

A developer asks an agent to add a dependency pinned to a given version, or runs a dependency-update skill that proposes new versions. Before writing anything, the agent asks the server whether a specific version exists, or which version satisfies a range written in that ecosystem's native syntax. The server answers per package, so the agent can pin only versions that really exist and never proposes a yanked or deprecated version.

**Why this priority**: Update and pin workflows are the second most common place where agents invent versions (for example "upgrade to 5.0.0" when 5.0.0 was never published). It builds on P1 and adds the version argument.

**Independent Test**: Can be tested by sending known exact versions (existing, non-existing, yanked) and known ranges per ecosystem and comparing the answers against the registry's version list.

**Acceptance Scenarios**:

1. **Given** `npm:react` with version `18.2.0`, **When** the agent asks, **Then** the result includes `v_exists: true`.
2. **Given** `npm:react` with version `18.99.0`, **When** the agent asks, **Then** the result includes `v_exists: false` while `status`, `stable` and `latest` are still returned normally.
3. **Given** a PyPI package and a version that was yanked, **When** the agent asks about that exact version, **Then** the result includes `v_exists: true` and `v_yanked: true`.
4. **Given** an npm package and a version that was deprecated, **When** the agent asks about that exact version, **Then** the result includes `v_exists: true` and `v_deprecated: true`.
5. **Given** `npm:react` with range `^18.0.0`, **When** the agent asks, **Then** `v_match` is the highest stable 18.x version published.
6. **Given** `pypi:requests` with range `>=2.0,<2.20`, **When** the agent asks, **Then** `v_match` is the highest stable version in that interval, using PEP 440 semantics.
7. **Given** `packagist:monolog/monolog` with range `~2.0`, **When** the agent asks, **Then** the range is interpreted with Composer semantics (`>=2.0 <3.0`), not npm semantics.
8. **Given** a range that matches no published version, **When** the agent asks, **Then** `v_match` is `null` and `status` is still `ok`.
9. **Given** a range the server cannot parse, **When** the agent asks, **Then** that single item returns `status: error` with a one-sentence message, and every other item in the batch is answered normally.

---

### User Story 3 - Learn that a package is deprecated or no longer installable (Priority: P3)

An agent is about to add or keep a dependency that its training data remembers as healthy. The server reports that the package is now deprecated (the registry carries a deprecation notice) or that nothing installable remains under that name (unpublished, quarantined, or every version yanked). The agent can warn the developer or pick an alternative instead of installing dead code.

**Why this priority**: Less frequent than version lookups, but the consequences of missing it are worse: shipping a dependency the maintainer has abandoned. It needs only the status field already present in P1.

**Independent Test**: Can be tested with a known deprecated npm package (for example `request`) and a known fully unpublished or yanked package, verifying the status and the short message.

**Acceptance Scenarios**:

1. **Given** an npm package deprecated at the package level, **When** the agent asks, **Then** `status` is `deprecated`, `stable` and `latest` are still returned, and `msg` carries the registry's deprecation message truncated to one sentence.
2. **Given** an npm package that has been fully unpublished, **When** the agent asks, **Then** `status` is `not_found` and `msg` says it was unpublished.
3. **Given** a PyPI or pub.dev package all of whose versions are yanked or retracted, **When** the agent asks, **Then** `status` is `ok`, `stable` and `latest` are absent, and `msg` says all versions are yanked.
4. **Given** a PyPI project in quarantine, **When** the agent asks, **Then** `status` is `not_found` and `msg` says it is quarantined.
5. **Given** a package that never existed, **When** the agent asks, **Then** `status` is `not_found` with no `msg`.

---

### User Story 4 - Install the server in under a minute (Priority: P3)

Any developer who finds the project on the web or through a recommendation reads the README, copies a short snippet into their agent's MCP configuration (for example `.mcp.json`) or runs a single `npx` command, and the tool is available to their agent on the next session. No account, token, or configuration is required.

**Why this priority**: Adoption depends on frictionless setup, but the server is already useful once P1 works for the author.

**Independent Test**: Can be tested by following only the README on a clean machine with Node installed and confirming the agent lists the `check_packages` tool.

**Acceptance Scenarios**:

1. **Given** a clean machine with a supported Node runtime, **When** the developer adds the documented `.mcp.json` entry and restarts the agent, **Then** the agent lists `check_packages` and a first call succeeds.
2. **Given** the README, **When** a reader unfamiliar with the project opens it, **Then** it states in English what the tool does, how to install it, the input and output format, the supported ecosystems, and the license.

---

### Edge Cases

- A registry is slow or down: the affected items return `status: error` with a timeout or failure message; other items in the batch, including those from other registries, are unaffected. `error` is never reported as `not_found`.
- The developer is offline: every item returns `status: error`; the server does not crash and stays usable for the next call.
- One registry is asked about many packages at once (for example 100 npm packages): requests are throttled per registry so the registry is not hammered and the server does not get rate-limited.
- The same package is requested twice in one batch: both entries are answered, and the registry is queried once.
- The same package is requested again shortly after a previous call: the cached answer is reused for a short period, then refreshed.
- Scoped npm names (`@scope/name`) and vendor-qualified Packagist names (`vendor/package`) are accepted and encoded correctly.
- Package names with different casing or surrounding whitespace: whitespace is trimmed; case handling follows the registry (npm is lowercase-only, PyPI normalizes names, Packagist is lowercase, pub.dev is case-sensitive).
- An unknown ecosystem name: that item returns a validation-level `error` naming the supported ecosystems; the batch proceeds.
- An empty batch: rejected with a validation error.
- A package with no stable release at all (only pre-releases): `latest` is the pre-release and `stable` is omitted rather than set to null.
- Deprecation message is multi-sentence or very long: `msg` is cut to the first sentence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The server MUST run as a local MCP server over stdio and MUST be startable with a single `npx` command or a single entry in an agent's MCP configuration file.
- **FR-002**: The server MUST expose exactly one tool, `check_packages`, with an English description that tells an agent when and how to use it.
- **FR-003**: `check_packages` MUST accept a list of 1 to 100 items; each item has `ecosystem` (string), `name` (string) and optional `version` (string).
- **FR-004**: Requests with 0 items or more than 100 items MUST be rejected with a validation error that states the allowed range; the server MUST NOT silently truncate.
- **FR-005**: A single batch MUST be allowed to mix ecosystems.
- **FR-006**: The MVP MUST support the ecosystems `npm`, `pypi`, `pub` and `packagist`, and MUST accept the aliases `pnpm`, `yarn`, `node` (npm), `pip`, `python`, `uv`, `poetry` (PyPI), `dart`, `flutter` (pub.dev), `composer`, `php` (Packagist), case-insensitively. Results MUST report the canonical ecosystem name.
- **FR-007**: For every item the server MUST return: ecosystem, name, `status`, and, when the package exists, `stable` (highest non-pre-release version; for npm, the registry's `latest` dist-tag) and `latest` (highest version overall including pre-releases). Both MUST be present even when equal.
- **FR-008**: `status` MUST be one of `ok`, `deprecated`, `not_found`, `error`. `not_found` means the registry answered authoritatively that nothing installable is available under this name (never existed, unpublished, or quarantined); when the registry gives a reason, `msg` carries it. A package that exists but whose every version is yanked is `ok` with no `stable` or `latest` and a `msg` saying so. `error` means the registry could not be queried or answered unexpectedly, and MUST never be collapsed into `not_found`.
- **FR-009**: When `version` is an exact version, the result MUST include `v_exists`; when the registry carries per-version flags, it MUST also include `v_yanked` and/or `v_deprecated` for that version.
- **FR-010**: When `version` is a range, the result MUST include `v_match` holding the highest stable version that satisfies the range, or `null` when none does.
- **FR-011**: Ranges MUST be interpreted in the native syntax of the item's ecosystem: semver-style for npm and pub.dev, Composer semantics for Packagist (including `~` meaning "next significant release"), and PEP 440 specifiers for PyPI (at least `==`, `!=`, `>=`, `<=`, `>`, `<`, `~=`, wildcard `==X.*`, comma-separated clauses, pre-release and epoch forms).
- **FR-012**: A range that cannot be parsed MUST yield `status: error` with a one-sentence message for that item only; the remaining items MUST still be answered.
- **FR-013**: Responses MUST be compact: short keys, no null or empty fields except `v_match: null`, no descriptions, authors, changelogs, download counts or repository links. `msg` MUST be truncated to a single sentence.
- **FR-014**: Registry queries for a batch MUST run concurrently, with a per-registry concurrency limit and a per-item timeout, so that one slow registry or item cannot delay the whole batch beyond the timeout.
- **FR-015**: The server MUST keep a short in-memory cache (on the order of minutes) so that repeated requests for the same package within one agent session do not re-query the registry. The cache MUST live only for the lifetime of the server process.
- **FR-016**: The server MUST hold no persistent data: no database, no on-disk cache, no background refresh.
- **FR-017**: The server MUST require no authentication, account, token or configuration to work against public registries.
- **FR-018**: Ecosystem support MUST be organized so that adding a new registry means adding one self-contained adapter without changing the tool interface.
- **FR-019**: The entire repository MUST be in English: source code, comments, documentation, README, error messages, tool names and descriptions, and commit messages.
- **FR-020**: The project MUST be published as open source with an OSI-approved license and a README that lets a first-time visitor understand purpose, installation, usage and supported ecosystems without reading the code.
- **FR-021**: Automated tests MUST NOT make network calls; registry behaviour MUST be exercised through recorded responses.

### Key Entities

- **Package query item**: One entry in a batch. Attributes: ecosystem (canonical or alias), name, optional version or range.
- **Package result**: One entry in the response. Attributes: canonical ecosystem, name, status, optional stable version, optional latest version, optional version-check fields (`v_exists`, `v_yanked`, `v_deprecated`, `v_match`), optional one-sentence message.
- **Ecosystem adapter**: The knowledge of how to ask one public registry about one package and how to translate its answer into a Package result, including that ecosystem's version ordering and range syntax.
- **Version range**: A constraint expressed in an ecosystem's native syntax, resolved against the list of published versions to a single best match.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A batch of 100 packages spread across the four supported ecosystems returns a complete response in under 5 seconds on a typical broadband connection, and never later than the configured timeout even when one registry is unreachable.
- **SC-002**: For a reference set of at least 20 well-known packages per ecosystem, 100% of `stable` and `latest` values match what the registry's own website shows on the same day.
- **SC-003**: For a reference set of existing, non-existing, yanked and deprecated versions, 100% of `v_exists`, `v_yanked` and `v_deprecated` answers are correct.
- **SC-004**: For a reference set of at least 10 ranges per ecosystem, including the Composer `~` and PyPI `~=` and wildcard forms, 100% of `v_match` answers equal the result the ecosystem's own package manager would resolve.
- **SC-005**: The response for a single package with no version check is at most 120 characters, and a 100-package batch stays under 12 KB, so the tool does not consume a meaningful share of an agent's context.
- **SC-006**: A developer with Node installed can go from reading the README to a first successful `check_packages` call in under 2 minutes without any account or configuration.
- **SC-007**: Cold start of the server (first `npx` run excluded) is under 1 second, and the published package installs with the smallest practical dependency set.
- **SC-008**: Registry outages and offline mode never crash the server; 100% of affected items report `error` rather than a wrong status.

## Assumptions

- Users run an MCP-capable coding agent (for example Claude Code, Cursor, Copilot) with a supported Node runtime available, since `npx` is the distribution channel.
- Only public registries are targeted: registry.npmjs.org, pypi.org, pub.dev, packagist.org. Private registries, mirrors and corporate proxies are out of scope for the MVP.
- "Archived" status (repository archived on a code host) is explicitly out of scope because registries do not carry it and it would require code-host API calls with their own rate limits.
- No rate limiting, accounts or abuse protection are needed because the server runs on the user's own machine and queries registries in the user's own name.
- Pre-release detection follows each ecosystem's own rules (semver pre-release tags for npm and pub.dev, PEP 440 pre/dev/post segments for PyPI, Composer stability flags for Packagist).
- For npm, the registry's `latest` dist-tag is treated as the authoritative stable version because the maintainer sets it deliberately; for other ecosystems `stable` is computed as the highest non-pre-release version.
- The deprecation message, when present, is passed through verbatim but cut at the first sentence boundary; the server does not rewrite it.
- The deferred ecosystems (crates.io, RubyGems, Go modules, Maven, NuGet, Hex) are expected to follow the same adapter contract and are not designed in detail here.

## Decided Constraints *(input to planning, chosen by the project owner)*

These were settled during brainstorming and are recorded here so planning does not reopen them. They are deliberate owner decisions, not derived requirements.

- Runtime and language: Node 20 or newer, TypeScript. No NestJS or any HTTP framework; the server is a stdio process with one tool.
- MCP implementation: the official MCP TypeScript SDK, current stable line (`@modelcontextprotocol/server` v2), with stdio transport. Input validation with zod.
- HTTP: the runtime's built-in fetch with abort-based timeouts. No HTTP client library.
- Version logic: the `semver` library for npm and pub.dev ranges; purpose-written modules for Composer versions and constraints and for the PEP 440 subset needed by PyPI. No ecosystem's semantics are approximated through another's library.
- Build and distribution: bundled to a single file, published to npm with a `bin` entry so `npx` works immediately. Runtime dependencies kept to the minimum so the first `npx` is fast.
- Tests: vitest with recorded registry responses as fixtures.
- Name and distribution: npm package `depver-mcp` (repository named the same); MIT license; GitHub Actions run tests on Node 20, 22 and 24 on Linux and publish to npm with provenance on `v*` tags; Conventional Commits with a generated changelog.
- Versioning: first public release is `0.1.0`; `1.0.0` is tagged only once the `check_packages` contract is frozen; until then response keys may change in minor versions.
- Responses carry a single text JSON block; no `structuredContent` or `outputSchema`.
- Operational defaults, not user-configurable in the MVP: 8 s per-request timeout, one retry on network error or 5xx, 6 concurrent requests per registry, 5 minute in-process cache capped at 10 000 entries. The only environment variable is an optional debug switch for stderr logging.
