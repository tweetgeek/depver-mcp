# depver-mcp

[![npm version](https://img.shields.io/npm/v/depver-mcp.svg)](https://www.npmjs.com/package/depver-mcp)
[![CI](https://github.com/tweetgeek/depver-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tweetgeek/depver-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A local [MCP](https://modelcontextprotocol.io) server that tells AI coding agents which package
versions really exist. One tool, `check_packages`, asks the public registries of **npm**, **PyPI**,
**pub.dev** and **Packagist** and answers with the latest stable version, the latest version
overall, whether a given version or range resolves, and whether the package is deprecated. No
account, no database, no hosted service: it runs on your machine and talks to the registries
directly.

Why: agents writing `package.json`, `requirements.txt`, `pubspec.yaml` or `composer.json` from
memory invent version numbers. This tool replaces the guess with a lookup, in one call for up to
100 packages, with a response small enough not to eat your context window.

## Install

Requires Node.js 20 or newer. Nothing else: the package ships as a single file with no runtime
dependencies.

**Claude Code**: add to `.mcp.json` in your project (or `~/.claude.json` for all projects):

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

or run:

```bash
claude mcp add --transport stdio depver --scope project -- npx -y depver-mcp
```

**Cursor**: the same `mcpServers` entry in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`
(global). Other stdio-capable clients: see [docs/clients.md](./docs/clients.md).

Restart the agent. It now sees a tool called `check_packages`.

## What the agent sees

> Verify that packages exist and get their current versions from public registries (npm, PyPI,
> pub.dev, Packagist). Use before writing or updating a dependency manifest instead of guessing
> versions. Accepts up to 100 packages from mixed ecosystems in one call. Pass `version` to check
> an exact version or resolve a range.

The tool is annotated read-only, idempotent and open-world (it reaches external registries), so
hosts that auto-approve read-only tools will not prompt for it.

## Input

```json
{
  "packages": [
    { "ecosystem": "npm", "name": "react" },
    { "ecosystem": "pip", "name": "requests", "version": "2.31.0" },
    { "ecosystem": "pypi", "name": "requests", "version": ">=2.0,<2.20" },
    { "ecosystem": "dart", "name": "http", "version": "^1.0.0" },
    { "ecosystem": "composer", "name": "laravel/framework", "version": "~10.0" },
    { "ecosystem": "npm", "name": "left-pad", "version": "1.3.0" },
    { "ecosystem": "pub", "name": "htttp" }
  ]
}
```

- `packages`: 1 to 100 items. More is a validation error, never a silent truncation.
- `ecosystem`: a canonical name or an alias (table below), case-insensitive.
- `name`: the package name as your package manager spells it (`@types/node`, `laravel/framework`).
- `version` (optional): an exact version or a range in that ecosystem's own syntax.

## Output

One minified JSON text block with one result per input item, in input order:

```json
{
  "results": [
    { "e": "npm", "n": "react", "s": "ok", "stable": "19.3.1", "latest": "19.3.1" },
    {
      "e": "pypi",
      "n": "requests",
      "s": "ok",
      "stable": "2.34.2",
      "latest": "2.34.2",
      "v": "2.31.0",
      "v_exists": true,
      "v_yanked": false
    },
    {
      "e": "pypi",
      "n": "requests",
      "s": "ok",
      "stable": "2.34.2",
      "latest": "2.34.2",
      "v": ">=2.0,<2.20",
      "v_match": "2.19.1"
    },
    {
      "e": "pub",
      "n": "http",
      "s": "ok",
      "stable": "1.6.0",
      "latest": "1.6.0",
      "v": "^1.0.0",
      "v_match": "1.6.0"
    },
    {
      "e": "packagist",
      "n": "laravel/framework",
      "s": "ok",
      "stable": "v13.39.0",
      "latest": "v13.39.0",
      "v": "~10.0",
      "v_match": "v10.48.29"
    },
    {
      "e": "npm",
      "n": "left-pad",
      "s": "deprecated",
      "stable": "1.3.0",
      "latest": "1.3.0",
      "v": "1.3.0",
      "v_exists": true,
      "v_deprecated": true,
      "msg": "use String.prototype.padStart()"
    },
    { "e": "pub", "n": "htttp", "s": "not_found" }
  ]
}
```

| Key            | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `e`, `n`       | Canonical ecosystem and the name as the registry knows it                             |
| `s`            | Status: `ok`, `deprecated`, `not_found`, `error`                                      |
| `stable`       | Highest version that is neither a pre-release nor yanked (npm: the `latest` dist-tag) |
| `latest`       | Highest version overall, pre-releases included, yanked excluded                       |
| `v`            | Echo of the `version` you asked about                                                 |
| `v_exists`     | The exact version is published                                                        |
| `v_yanked`     | That version was yanked (PyPI) or retracted (pub.dev)                                 |
| `v_deprecated` | That version carries a deprecation notice (npm)                                       |
| `v_match`      | Highest stable version satisfying the range, or `null` if none                        |
| `msg`          | One sentence: deprecation notice, reason, or failure                                  |

Keys are omitted when they do not apply. There are no nulls except `v_match: null`, no
descriptions, authors or changelogs.

### Statuses

| `s`          | Meaning                                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`         | The package exists. If every version is yanked, `stable` and `latest` are absent and `msg` says so.                                                                                                   |
| `deprecated` | The package exists and its registry marks it deprecated: npm (latest version deprecated), PyPI (project status), pub.dev (discontinued), Packagist (abandoned).                                       |
| `not_found`  | The registry says nothing installable exists under this name: never existed, unpublished, or quarantined. `msg` carries the reason when the registry gives one.                                       |
| `error`      | The registry could not be asked (timeout, outage, rate limit, malformed answer) or the item was unusable (unknown ecosystem, unparseable range). **An error never means the package does not exist.** |

## Supported ecosystems

| Ecosystem   | Aliases                         | Registry           | Range syntax                                                    |
| ----------- | ------------------------------- | ------------------ | --------------------------------------------------------------- |
| `npm`       | `pnpm`, `yarn`, `node`          | registry.npmjs.org | node-semver: `^18`, `~1.2`, `1.x`, `>=1 <2`, `1.0.0 - 1.5.0`, ` |     | `   |
| `pypi`      | `pip`, `python`, `uv`, `poetry` | pypi.org           | PEP 440: `>=2.0,<3`, `~=2.31`, `==2.*`, `!=2.32.0`              |
| `pub`       | `dart`, `flutter`, `pub.dev`    | pub.dev            | pub: `^1.0.0`, `>=0.13.0 <1.0.0`, `any`                         |
| `packagist` | `composer`, `php`               | packagist.org      | Composer: `^10.0`, `~10.0`, `10.*`, `>=10 <12`, `\|\|`          |

Ranges are interpreted with each ecosystem's own rules, not translated through a common library:
Composer's `~10.0` means `>=10.0 <11.0`, PyPI's `~=2.31` means `>=2.31, ==2.*`, and so on.

## Limits and behaviour

- Up to 100 packages per call, mixed ecosystems allowed.
- Registry requests run in parallel, at most 6 at a time per registry, with an 8 second timeout
  per request and one retry on network errors. One slow registry never blocks the others.
- Results are cached in memory for 5 minutes while the server process lives. Nothing is written
  to disk.
- `DEPVER_MCP_DEBUG=1` prints diagnostics to stderr. Nothing is ever written to stdout except
  protocol messages.
- `npx depver-mcp --help` and `--version` print to stderr and exit.

## Privacy

Queries go from your machine straight to the public registries, with a `User-Agent` of
`depver-mcp/<version> (+https://github.com/tweetgeek/depver-mcp)`. No telemetry, no proxy, no
account.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Adding an ecosystem is one adapter file plus fixtures.

## License

[MIT](./LICENSE)
