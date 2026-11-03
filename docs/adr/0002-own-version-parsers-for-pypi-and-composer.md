---
status: accepted
date: 2026-11-03
---

# Purpose-written version and range parsers for PyPI and Composer

npm and pub.dev ranges are handled by the `semver` library. PyPI (PEP 440) and Composer get their
own small modules instead of being translated onto `semver`. We verified that the translation is
lossy for Composer (`~1.2` means `>=1.2 <2.0`, hyphen ranges wildcard the right side,
versions have four components, `patch` sorts above the plain release, `@stability` flags) and
impossible for PEP 440 (epochs, `.dev`/`.post` segments, `~=`, `==X.*`, pre-release exclusion
rules). Each untranslated difference would be a silent wrong `v_match`, which violates the
project's rule that the tool never gives an agent a confident wrong answer. Two modules of roughly
250 lines each, tested table-driven against the ecosystems' own documentation, were judged cheaper
than a translation layer that needs the same test matrix plus a mapping step.

## Considered options

- Translate Composer and PEP 440 onto node-semver: rejected for the lossiness above.
- Third-party packages (`@renovatebot/pep440` and similar): rejected to keep the published bundle
  free of extra runtime code for a few hundred lines of logic.
- Shelling out to `pip` or `composer`: rejected, not guaranteed installed and incompatible with
  network-free tests.
