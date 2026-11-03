# Contributing to depver-mcp

Thanks for helping agents stop inventing version numbers. This file covers the development setup,
the rules the project holds itself to, and the recipe for adding a package ecosystem.

## Development

```bash
npm ci
npm test          # vitest, no network access
npm run typecheck
npm run build     # tsup → dist/index.js (single file, shebang)
npm run build:check
```

Try the built server against the real registries with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Ground rules

These come from the project constitution and reviewers will hold pull requests to them.

1. **Tests never touch the network.** Registry behaviour is exercised through recorded fixtures in
   `tests/fixtures/<ecosystem>/`. A test setup file replaces `fetch` with a function that throws.
2. **Never lie to the agent.** A registry timeout, outage or malformed answer is `error`, never
   `not_found`. One item's failure never fails the batch. Range semantics follow the ecosystem's
   own rules.
3. **Token frugality.** A new response key must come with a sentence in the pull request saying
   which agent decision it enables. No nulls (except `v_match`), no empty strings, no prose.
4. **Zero infrastructure.** No database, disk cache, background worker, account or hosted service.
5. **Minimal dependencies.** The published package has no runtime dependencies; everything is
   bundled. A new dependency needs a justification in the pull request, and a few dozen lines of
   local code beat a package.
6. **English everywhere**: code, comments, docs, commit messages, error messages.
7. **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), one logical change per
   commit.

## Adding an ecosystem

Everything registry-specific lives in one adapter file. The tool's input and output schema never
changes.

1. Create `src/adapters/<id>.ts` exporting an object that implements `Adapter` from
   `src/core/types.ts`:
   - `id`: the canonical ecosystem name.
   - `concurrency`: maximum requests in flight to that registry (respect its documented limit).
   - `normalizeName(raw)`: the registry's own normalization; throw `InvalidName` for bad input.
   - `fetch(name, http)`: one request, returning `{ kind: "info", ... }` or
     `{ kind: "not_found", ... }`. Throw `RegistryError("malformed", ...)` for anything you do not
     recognise. Only the registry's documented not-found signal may become `not_found`.
   - `isPrerelease`, `compare`: the ecosystem's version ordering.
   - `parseVersionOrRange(input)`: exact version or native-syntax range; throw `UnparseableRange`
     for anything else.
2. Record fixtures with `curl` into `tests/fixtures/<id>/`, trimmed to what the tests need, with a
   `_note` key saying when and from where they were recorded. The mandatory set: an ordinary
   package, a package whose newest version is a pre-release, a deprecated (or yanked) case, a
   not-found response, and a malformed body.
3. Write `tests/unit/adapters/<id>.test.ts` first, watch it fail, then implement.
4. Register the adapter in `src/adapters/index.ts` and add its aliases to `ALIASES`.
5. Add the ecosystem row to the README table and a line to `CHANGELOG.md`.

## Releasing

Maintainers tag `vX.Y.Z` on `main`; the release workflow runs the tests, builds, and publishes to
npm with provenance. Until 1.0.0, response keys may change in minor versions.
