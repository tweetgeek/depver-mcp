# Quickstart results

**Date**: 2026-11-03 | **Build**: `dist/index.js` 941 KB, cold start 42–46 ms | **Node**: 26.12.1 (macOS)

All scenarios were driven over stdio with JSON-RPC against the built bundle and the live registries.
Fixture-based tests: 18 files, 615 tests, no network (guard proven by `tests/unit/no-network.test.ts`).

| Scenario | Result | Evidence |
|----------|--------|----------|
| 1. Direct stdio smoke (example request) | PASS | 9 results in input order in 0.46 s; `react` ok 19.3.1; `request` deprecated with one-sentence `msg`; PyPI exact `v_exists: true, v_yanked: false`; three ranges resolved (`2.19.1`, `1.6.0`, `v10.50.4`); `htttp` not_found; `cargo` error naming the four ecosystems |
| 2. Failure isolation / offline | PASS | With `fetch` forced to fail: both items `error` "registry unreachable" in 0.31 s (one retry, 300 ms backoff); the next call is answered; process exits 0 on stdin close. A hung registry is bounded by the 8 s timeout (`tests/unit/tool/timing.test.ts`) |
| 3. Validation boundaries | PASS | `packages: []` → `isError`, text contains "packages must contain between 1 and 100 items (got 0)"; 101 items → "(got 101)"; 100 npm items → 100 × ok in 2.90 s, 7 207 bytes; same 100 again → 0.026 s, no registry traffic |
| 4. Version semantics | PASS | `react ^17` → 17.0.2; `react 99.0.0` → `v_exists: false`; `requests ~=2.31` → 2.34.2; `requests ==2.*` → 2.34.2; `http >=0.13.0 <1.0.0` → 0.13.6; `monolog ~2.0` → 2.11.1 (Composer semantics); `monolog ~2.0.0` → 2.0.2; `>>=1` → that item only is `error` |
| 5. Install from an agent config | PENDING (manual) | Needs a Claude Code session: add `.mcp.json.example` content to a scratch project and ask for versions of `react`, `requests`, `laravel/framework`; target under 2 minutes (SC-006, task T073) |
| 6. README check | PASS (self-review) | README states purpose, install snippet for Claude Code and Cursor, input/output with example, ecosystems and aliases, status meanings, limits, privacy, license; all in English |

## Reference set (SC-002)

`node scripts/reference-check.mjs`: 20 well-known packages per ecosystem (80 total), `stable`
compared with the registry's own answer fetched directly.

| | |
|---|---|
| Packages | 80 |
| Mismatches | 0 |
| Batch answered in | 1 712 ms |

## Success criteria

| Criterion | Target | Measured |
|-----------|--------|----------|
| SC-001 100-item batch | < 5 s | 2.90 s (100 npm), 1.71 s (80 mixed) |
| SC-002 reference set agreement | 100% | 100% (80/80) |
| SC-003 exact-version answers | 100% | all fixture and live cases correct |
| SC-004 range answers | 100% | all 8 live rows and 150+ unit cases per ecosystem correct |
| SC-005 response size | ≤ 120 chars single, < 12 KB per 100 | 68 chars (`react`), 7 207 bytes (100 npm) |
| SC-006 install to first answer | < 2 min | pending manual run (scenario 5) |
| SC-007 cold start | < 1 s | 42–46 ms |
| SC-008 no crash offline | 100% `error` | 2/2 `error`, server alive, exit 0 |

## Notes

- The MCP SDK validates the advertised input schema before the handler runs and prefixes its own
  wording to envelope errors; the contract text is contained in the message. Documented in
  `contracts/check_packages.md`.
- `HTTPS_PROXY` does not affect Node's fetch before Node 24, so the CI workflow relies on the
  in-process fetch guard rather than a dead proxy. Plan and research updated accordingly.
- Live values drift daily (e.g. Packagist `~10.0` now resolves to `v10.50.4`, the fixture holds
  `v10.48.29`); the contract's example values are illustrative, its keys are normative.
