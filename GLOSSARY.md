# Package Version Checking

The language of a tool that tells AI coding agents whether a package exists in a public registry
and which versions of it are real, so the agent never invents a version number.

## Language

### Where packages live

**Ecosystem**:
A public package registry we can ask about packages. Exactly one canonical name per registry:
`npm`, `pypi`, `pub`, `packagist`.
_Avoid_: package manager, language, platform, registry (as a field name)

**Alias**:
A package manager or language name that an agent may use in place of an ecosystem name and that
maps to exactly one ecosystem (`yarn` → `npm`, `pip` → `pypi`, `flutter` → `pub`, `composer` →
`packagist`). Aliases never appear in a result.

**Package**:
A named unit of code published in one ecosystem, identified by its name as that ecosystem knows
it after normalization (lowercased npm name, PEP 503 PyPI name, lowercased `vendor/name` on
Packagist).
_Avoid_: library, module, dependency (when the registry entry is meant)

### Versions

**Version**:
A single published release of a package, written in the ecosystem's own version syntax.

**Pre-release**:
A version the ecosystem itself marks as not final (semver `-beta.1`, PEP 440 `rc1` / `.dev1`,
Composer `alpha` / `beta` / `RC` / `dev`).
_Avoid_: unstable, prerelease version, preview

**Stable**:
The highest version of a package that is not a pre-release and not yanked; for npm, the version the
maintainer tagged `latest` when that version is not a pre-release.
_Avoid_: current, release, latest stable, recommended

**Latest**:
The highest version of a package overall, pre-releases included, yanked excluded.
_Avoid_: newest, head, bleeding edge

**Yanked**:
A published version the maintainer has withdrawn from new installs while leaving it on record
(PyPI "yanked", pub.dev "retracted"). A yanked version is never Stable or Latest.
_Avoid_: retracted, withdrawn, pulled

**Deprecated version**:
A version carrying a maintainer's deprecation notice (npm per-version `deprecated`).

**Deprecated package**:
A package whose ecosystem marks it as no longer maintained: npm when its `latest`-tagged version is
deprecated, PyPI project status `deprecated`, pub.dev `discontinued`, Packagist `abandoned`.
_Avoid_: abandoned, discontinued, archived, dead (as output terms)

### Asking

**Batch**:
One call to the tool, holding 1 to 100 Items from any mix of ecosystems.
_Avoid_: request, bulk query, list

**Item**:
One package question inside a Batch: an ecosystem (or alias), a name, and optionally a Version
Check.
_Avoid_: entry, package (when the question is meant), query

**Version Check**:
The optional third part of an Item: either an Exact Version or a Range to test against the
package's published versions.

**Exact Version**:
A Version Check that names one complete version in the ecosystem's syntax and asks whether it is
published.
_Avoid_: pinned version, specific version

**Range**:
A Version Check written in the ecosystem's native constraint syntax (`^18`, `>=2.0,<3`, `~2.0`)
that asks for the highest Stable version satisfying it.
_Avoid_: constraint, specifier, requirement, version spec

### Answering

**Result**:
The single compact answer to one Item, returned in the same position the Item had in the Batch.
_Avoid_: response, record, row, entry

**Status**:
The one-word verdict in a Result: `ok`, `deprecated`, `not_found` or `error`.

**Not found**:
The ecosystem answered authoritatively that no package by this name is available to install.
_Avoid_: missing, unknown, 404 (as an output term)

**Error**:
The ecosystem could not be asked or did not answer in a usable way (timeout, outage, rate limit,
malformed response), or the Item itself was unusable (unknown ecosystem, unparseable Range). An
Error never implies anything about whether the package exists.
_Avoid_: failed, unavailable, unknown
