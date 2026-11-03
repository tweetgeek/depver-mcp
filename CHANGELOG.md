# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0.0, response keys may change in minor versions.

## [Unreleased]

## [0.1.0] - unreleased

### Added

- `check_packages` MCP tool: up to 100 packages from mixed ecosystems in one call, answered in
  input order with status, latest stable version and latest version overall.
- Ecosystems: npm (aliases pnpm, yarn, node), PyPI (pip, python, uv, poetry), pub.dev (dart,
  flutter), Packagist (composer, php).
- Exact version checks (`v_exists`, `v_yanked`, `v_deprecated`) and range resolution (`v_match`)
  in each ecosystem's native syntax: node-semver, PEP 440, pub, Composer.
- Deprecation signals: npm deprecated latest, PyPI project status, pub.dev discontinued, Packagist
  abandoned. Nothing-installable signals: npm unpublished, PyPI quarantined, all versions yanked.
- Per-registry concurrency limit, per-request timeout with one retry, 5 minute in-process cache.
- Single-file build with no runtime dependencies, runnable with `npx depver-mcp`.
