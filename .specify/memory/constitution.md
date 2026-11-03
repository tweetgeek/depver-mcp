# Package Version MCP Server Constitution

## Core Principles

### I. Token Frugality

Every byte returned to an agent costs the user context and money. Responses MUST use short,
stable keys, MUST omit null, empty and redundant fields (the single exception is `v_match: null`,
which carries meaning), and MUST NOT include package descriptions, authors, changelogs, download
counts, repository links or any other data the agent did not ask for. Free-text messages MUST be
truncated to one sentence. Any proposal to add a response field MUST state which agent decision
it enables; if it enables none, it is rejected.

**Rationale**: The product exists to replace a hallucinated version with a verified one. Anything
beyond that competes with the user's own work for context window.

### II. Never Lie to the Agent

The server MUST report exactly one of `ok`, `deprecated`, `not_found`, `error` per item, with
their defined meanings. The server MUST NOT infer that a package was deleted when a registry
cannot say so; a 404 is `not_found`, and a registry-stated reason (unpublished, quarantined,
all versions yanked) travels in `msg`. A registry timeout, outage, unexpected response or
unparseable input MUST be reported as `error` and MUST NEVER be collapsed into `not_found` or
`ok`. A failure on one item MUST NOT fail the batch; every other item MUST still be answered.
Version and range answers MUST follow the ecosystem's own semantics, not a convenient
approximation.

**Rationale**: An agent that is told "this package does not exist" when the network blinked will
pick a different, possibly worse, dependency. A wrong answer is worse than no answer.

### III. Zero Infrastructure

The server runs entirely on the user's machine. It MUST NOT require a database, on-disk cache,
background worker, remote service, account, token or configuration file to operate against public
registries. The only permitted state is an in-process cache that dies with the process. Any
feature that needs persistent or hosted state is out of scope for this project by definition.

**Rationale**: The project was redesigned from a hosted service to a local tool specifically to
remove running costs and operational burden. Reintroducing them silently would undo that
decision.

### IV. Minimal Dependencies and Fast Startup

The published package MUST be a single bundled executable file installable through `npx` with no
build step on the user's side. Every runtime dependency MUST justify itself in the pull request
that adds it; a dependency that can be replaced by a few dozen lines of code MUST be replaced.
Development-only dependencies are unconstrained. Cold start after install MUST stay well under one
second.

**Rationale**: `npx` downloads the dependency tree on first run. Each added package slows every
new user's first experience and widens the supply-chain surface of a tool that agents trust.

### V. One Adapter per Ecosystem

Each registry is implemented as one self-contained adapter module behind a single shared
contract: resolve a package name, return versions with their flags, parse and match that
ecosystem's range syntax. Adding an ecosystem MUST mean adding one adapter and registering it;
it MUST NOT change the tool's input or output schema. Ecosystem-specific quirks (name
normalization, pre-release rules, range semantics) MUST live inside the adapter, never in shared
code.

**Rationale**: Six more ecosystems are already planned. The cost of each must stay at one file so
contributors can add theirs without understanding the whole server.

### VI. Tests Without Network

Automated tests MUST NOT make network calls. Registry behaviour MUST be exercised through recorded
fixtures checked into the repository. Adapters and version/range logic MUST be developed
test-first: the failing test comes before the implementation. Each adapter MUST have fixtures for
at least: an ordinary package, a package with a pre-release as latest, a deprecated or yanked
case, a not-found case, and a malformed registry response.

**Rationale**: Registries change daily and rate-limit aggressively. A test suite that depends on
them is flaky and slow, and flaky tests get ignored.

### VII. English-Only, Open-Source Quality

Everything in the repository MUST be in English: source code, identifiers, comments,
documentation, README, error and log messages, MCP tool names and descriptions, commit messages,
issues and pull requests. The README MUST let a stranger on GitHub understand what the tool does,
how to install it, what it returns and which ecosystems it supports without reading the code. The
project MUST carry an OSI-approved license.

**Rationale**: The project is public and meant to be found through search and recommendation.
Its first impression is its documentation.

## Technology Constraints

These choices were made by the project owner and are fixed unless amended here.

- Runtime: Node.js 20 or newer. Language: TypeScript with strict mode.
- Protocol: the official MCP TypeScript SDK, current stable line (`@modelcontextprotocol/server`
  at the time of writing), over stdio transport. No HTTP API, no HTTP framework (explicitly: no
  NestJS, Express, Fastify or similar).
- Validation: `zod` for tool input schemas.
- Networking: the runtime's built-in `fetch` with abort-based timeouts. No HTTP client library.
- Version logic: the `semver` library for npm and pub.dev; purpose-written modules for Composer
  versions and constraints and for the PEP 440 subset needed by PyPI. Ecosystem semantics are
  never approximated through another ecosystem's library.
- Build: `tsup` to a single file; published to npm with a `bin` entry.
- Tests: `vitest`.
- Concurrency: per-registry concurrency limit and per-item timeout for every batch.

## Development Workflow

- Every feature starts as a Spec Kit specification and plan; the plan MUST include a
  Constitution Check that cites each principle and states how the design satisfies it.
- Pull requests MUST pass the full test suite with no network access and MUST include fixtures for
  any new registry behaviour they rely on.
- A pull request that adds a runtime dependency MUST explain in its description why the
  dependency cannot be reasonably replaced by local code.
- A pull request that adds a response field MUST explain which agent decision the field enables.
- Breaking changes to the tool's input or output schema MUST bump the package major version and be
  called out in the changelog.
- Commit messages follow Conventional Commits and are written in English.

## Governance

This constitution supersedes all other practices, templates and conventions in the repository.
Where a template, plan or review disagrees with a principle here, the principle wins and the
other document is corrected.

Amendments: any change to this file MUST be made in a dedicated pull request that states the
reason for the change, updates the version line below, and adjusts the Sync Impact Report at the
top of the file. Versioning follows semantic rules: MAJOR for removing or redefining a principle,
MINOR for adding a principle or materially expanding guidance, PATCH for clarifications and
wording.

Compliance: every specification, plan, task list and pull request MUST be checked against these
principles before it is accepted. Added complexity MUST be justified in writing against the
principle it strains; unjustified complexity is grounds for rejection.

**Version**: 1.0.1 | **Ratified**: 2026-11-03 | **Last Amended**: 2026-11-03
