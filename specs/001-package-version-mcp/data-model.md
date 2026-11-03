# Data Model: Package Version MCP Server

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

All entities are in-memory TypeScript types. There is no persistence (Constitution III).

## Ecosystem

Canonical identifier of a public registry. Closed set in the MVP.

| Canonical | Accepted aliases (case-insensitive) | Registry |
|-----------|--------------------------------------|----------|
| `npm` | `pnpm`, `yarn`, `node` | registry.npmjs.org |
| `pypi` | `pip`, `python`, `uv`, `poetry` | pypi.org |
| `pub` | `dart`, `flutter`, `pub.dev` | pub.dev |
| `packagist` | `composer`, `php` | packagist.org |

Rules:
- Alias resolution happens once, at input validation. Everything downstream sees canonical names only.
- An unknown ecosystem string is a per-item validation failure (`status: error`), not a batch failure. The message lists the canonical names.

## PackageQuery (input item)

| Field | Type | Rules |
|-------|------|-------|
| `ecosystem` | string | Required. Resolved via the alias table. |
| `name` | string | Required. Trimmed. Must be non-empty after trimming. Adapter-specific normalization applied after (see Adapter). |
| `version` | string, optional | Trimmed. Interpreted as an exact version if it parses as a full version in the ecosystem's syntax, otherwise as a range. Absent means "no version check". |

Batch rules (FR-003, FR-004): the batch is an array of 1 to 100 PackageQuery items. Length violations reject the whole call with a validation error that names the limit. Duplicate items (same canonical ecosystem and normalized name) are answered individually but fetched once.

## PackageResult (output item)

Emitted exactly once per input item, in input order.

| Key | Type | Present when | Meaning |
|-----|------|--------------|---------|
| `e` | string | always | Canonical ecosystem |
| `n` | string | always | Name as the registry knows it (normalized) |
| `s` | `ok` \| `deprecated` \| `not_found` \| `error` | always | Status, see state table |
| `stable` | string | `s` is `ok` or `deprecated` and at least one non-pre-release, non-yanked version exists | Highest non-pre-release, non-yanked version; for npm, the `latest` dist-tag when it is not a pre-release |
| `latest` | string | `s` is `ok` or `deprecated` and at least one non-yanked version exists | Highest non-yanked version overall, including pre-releases |
| `v` | string | input had `version` | Echo of the requested version or range, so the agent can correlate |
| `v_exists` | boolean | input `version` was exact and `s` is `ok` or `deprecated` | The exact version is published (a yanked version still exists; see `v_yanked`) |
| `v_yanked` | boolean | `v_exists` is true and the registry has a yank/retract flag for that version | Version is yanked (PyPI) or retracted (pub.dev) |
| `v_deprecated` | boolean | `v_exists` is true and the registry has a per-version deprecation flag (npm) | Version is deprecated |
| `v_match` | string \| null | input `version` was a range and `s` is `ok` or `deprecated` | Highest stable version satisfying the range; `null` when none does |
| `msg` | string | `s` is `deprecated` or `error`, or the registry gave a reason for `not_found` (unpublished, quarantined), or `s` is `ok` with no installable version (all yanked) | One sentence: deprecation notice, replacement hint, reason, or failure |

Rules (FR-007, FR-013):
- No key is ever emitted with `null`, `undefined`, `""`, or `false`-by-omission semantics, except `v_match: null`, which is meaningful.
- Boolean keys are emitted only when their value is known from the registry; a missing `v_yanked` means "the registry has no such concept", not "not yanked".
- `msg` is truncated at the first sentence boundary (`.`, `!`, `?` followed by whitespace or end) and capped at 160 characters.

### Status semantics

| `s` | Condition | `stable`/`latest` present |
|-----|-----------|---------------------------|
| `ok` | Registry returned the package and it is not deprecated at package level | yes, unless every version is yanked: then both absent and `msg` = "all versions yanked" |
| `deprecated` | Package exists and the registry marks it deprecated at package level (npm: `latest` version carries `deprecated`; pub.dev: `isDiscontinued`; Packagist: `abandoned`; PyPI: no package-level concept, never emitted) | yes |
| `not_found` | Registry answered authoritatively that nothing installable exists under this name: 404 (all ecosystems), npm 200 without `versions` (`msg` = "unpublished from npm"), PyPI `project-status` quarantined (`msg` = "quarantined by PyPI") | no |
| `error` | Network failure, timeout, non-2xx other than the registry's "not found" signal, malformed body, unparseable version/range, unknown ecosystem | no |

`not_found` and `error` are disjoint by construction: only the adapter's explicit not-found detection (a documented status code or body shape) may yield `not_found`. Everything unexpected is `error` (Constitution II).

## VersionInfo (adapter output, internal)

What every adapter returns for a resolved package, before result formatting.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Normalized name |
| `versions` | `VersionEntry[]` | All published versions known to the registry |
| `stableHint` | string, optional | Registry-declared stable version (npm `dist-tags.latest`, pub.dev `latest.version`) used in preference to computing it |
| `deprecated` | `{ message: string }`, optional | Package-level deprecation |

### VersionEntry

| Field | Type | Notes |
|-------|------|-------|
| `version` | string | As published |
| `prerelease` | boolean | Per the ecosystem's own rule |
| `yanked` | boolean, optional | Only ecosystems with the concept set it |
| `deprecated` | string, optional | Per-version deprecation message (npm) |

## Adapter (contract, internal)

One module per ecosystem, registered in a static table keyed by canonical ecosystem (Constitution V).

| Member | Responsibility |
|--------|----------------|
| `id` | Canonical ecosystem name |
| `normalizeName(raw)` | Ecosystem-specific normalization (npm lowercase and scope check; PyPI PEP 503; Packagist lowercase `vendor/name`; pub.dev as-is) and syntactic validation; throws a typed error for invalid names |
| `fetch(name, http)` | One registry round-trip (or the minimal set), returning `VersionInfo`, or a typed `NotFound` outcome carrying an optional reason |
| `isPrerelease(version)` | Ecosystem rule |
| `compare(a, b)` | Total order on versions in this ecosystem |
| `parseVersionOrRange(input)` | Returns `{ kind: "exact", version }` or `{ kind: "range", matches: (v) => boolean }`, or throws a typed `UnparseableRange` |
| `concurrency` | Max in-flight requests to this registry (default 8) |

Everything ecosystem-specific lives inside the adapter. Shared code only knows the contract.

## Cache (internal)

In-process `Map<string, { value: VersionInfo | NotFound, expiresAt }>` keyed by `ecosystem + "\0" + normalizedName`.

- TTL: 5 minutes for successful and not-found answers. Errors are not cached.
- No size bound is needed for an agent session; an upper bound of 10 000 entries with oldest-first eviction is applied defensively.
- The cache dies with the process. There is no disk persistence (Constitution III).

## State transitions

Per item, within one call:

```
received → validated ─┬─ invalid ──────────────────────→ error
                      └─ valid → cache hit? ─┬─ yes ───→ format
                                             └─ no ───→ fetch ─┬─ ok/deprecated → format
                                                               ├─ not found ───→ not_found
                                                               └─ failure ─────→ error
```

`format` applies the version check (exact or range) and emits the PackageResult. A failure inside `format` (for example an unparseable range) yields `error` for that item only.
