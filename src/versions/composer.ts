/**
 * Composer version normalization and ordering, following composer/semver's VersionParser:
 * optional leading `v`, 1 to 4 numeric components padded with zeros, an optional stability
 * suffix (`dev`, `alpha`/`a`, `beta`/`b`, `RC`/`rc`, `patch`/`pl`/`p`, `stable`) with an optional
 * number, and branch forms `dev-<name>` and `<n>.x-dev`. See research.md R6/R7 and ADR 0002.
 * Constraint parsing (T055) builds on `ComposerVersion` and `compareComposer` from this module.
 */
import { UnparseableRange } from "../core/errors.js";

export type ComposerStability = "dev" | "alpha" | "beta" | "RC" | "stable" | "patch";

export interface ComposerVersion {
  /** Four numeric components, missing ones padded with zeros (`1.2` is `[1, 2, 0, 0]`). */
  components: [number, number, number, number];
  stability: ComposerStability;
  /** The number after the stability word (`beta2` is 2); 0 when absent or stable. */
  stabilityNumber: number;
  /** `dev-<name>` or `<n>.x-dev`; sorts below every tagged version with the same components. */
  branch: boolean;
  /** The input as given, used for output. */
  raw: string;
}

/** Ordering of stability words; `patch` sorts above the plain release, as in PHP's version_compare. */
const STABILITY_RANK: Record<ComposerStability, number> = {
  dev: 0,
  alpha: 1,
  beta: 2,
  RC: 3,
  stable: 4,
  patch: 5,
};

const STABILITY_ALIASES: Record<string, ComposerStability> = {
  dev: "dev",
  a: "alpha",
  alpha: "alpha",
  b: "beta",
  beta: "beta",
  rc: "RC",
  p: "patch",
  pl: "patch",
  patch: "patch",
  stable: "stable",
};

/** `v1.2.3.4-beta.2+meta`: numeric part, optional separator + stability word + optional number. */
const TAGGED_RE =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:[._-]?(stable|beta|b|rc|alpha|a|patch|pl|p|dev)(?:[.-]?(\d+))?)?(?:\+[0-9A-Za-z.-]+)?$/i;

/** `2.x-dev`, `2.1.x-dev`, `2.*.*-dev`: digits, then only wildcards, then `-dev`. */
const NUMERIC_BRANCH_RE = /^v?(\d+(?:\.\d+)*)(?:\.[xX*])+-dev$/;

function pad(parts: number[]): [number, number, number, number] {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

/** Parses a Composer version. Returns null when the input is not a version (ranges, `latest`). */
export function normalizeComposer(input: string): ComposerVersion | null {
  const text = input.trim();
  if (text === "") return null;

  if (/^dev-./i.test(text)) {
    return {
      components: [0, 0, 0, 0],
      stability: "dev",
      stabilityNumber: 0,
      branch: true,
      raw: input,
    };
  }

  const branch = NUMERIC_BRANCH_RE.exec(text);
  if (branch !== null) {
    const parts = (branch[1] as string).split(".").map(Number);
    if (parts.length > 4) return null;
    return {
      components: pad(parts),
      stability: "dev",
      stabilityNumber: 0,
      branch: true,
      raw: input,
    };
  }

  const m = TAGGED_RE.exec(text);
  if (m === null) return null;
  const parts = [m[1], m[2], m[3], m[4]].filter((p): p is string => p !== undefined).map(Number);
  const word = m[5]?.toLowerCase();
  const stability = word === undefined ? "stable" : STABILITY_ALIASES[word];
  if (stability === undefined) return null;
  const stabilityNumber = stability === "stable" || m[6] === undefined ? 0 : Number(m[6]);
  return { components: pad(parts), stability, stabilityNumber, branch: false, raw: input };
}

function toVersion(v: string | ComposerVersion): ComposerVersion {
  if (typeof v !== "string") return v;
  const parsed = normalizeComposer(v);
  if (parsed === null) throw new UnparseableRange(`"${v}" is not a valid Composer version`);
  return parsed;
}

/**
 * Total order: numeric components, then branch below tagged, then
 * dev < alpha < beta < RC < stable < patch, then the stability number.
 * Throws UnparseableRange when a string argument does not parse.
 */
export function compareComposer(a: string | ComposerVersion, b: string | ComposerVersion): number {
  const va = toVersion(a);
  const vb = toVersion(b);
  for (let i = 0; i < 4; i++) {
    const d = (va.components[i] ?? 0) - (vb.components[i] ?? 0);
    if (d !== 0) return d;
  }
  if (va.branch !== vb.branch) return va.branch ? -1 : 1;
  const rank = STABILITY_RANK[va.stability] - STABILITY_RANK[vb.stability];
  if (rank !== 0) return rank;
  return va.stabilityNumber - vb.stabilityNumber;
}

/** True for dev, alpha, beta, RC and branches; false for stable and patch releases. */
export function isComposerPrerelease(v: string | ComposerVersion): boolean {
  const version = toVersion(v);
  return version.branch || STABILITY_RANK[version.stability] < STABILITY_RANK.stable;
}

/** The version as it was given (the registry's tag), for output. */
export function formatComposer(v: ComposerVersion): string {
  return v.raw;
}
