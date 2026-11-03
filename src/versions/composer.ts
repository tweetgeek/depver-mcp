/**
 * Composer version normalization and ordering, following composer/semver's VersionParser:
 * optional leading `v`, 1 to 4 numeric components padded with zeros, an optional stability
 * suffix (`dev`, `alpha`/`a`, `beta`/`b`, `RC`/`rc`, `patch`/`pl`/`p`, `stable`) with an optional
 * number, and branch forms `dev-<name>` and `<n>.x-dev`. See research.md R6/R7 and ADR 0002.
 * Constraint parsing (`parseComposerCheck`) follows VersionParser::parseConstraints and builds on
 * `normalizeComposer` and `compareComposer`.
 */
import { UnparseableRange } from "../core/errors.js";
import type { VersionCheck } from "../core/types.js";

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

// ---------------------------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------------------------

type BoundOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

interface Bound {
  op: BoundOp;
  version: ComposerVersion;
}

/** A conjunction of bounds; an empty list matches every version (`*`). */
type AndGroup = Bound[];

/** `@dev`, `@alpha`, `@beta`, `@RC`, `@stable` at the end of an atom; parsed and ignored. */
const STABILITY_FLAG_RE = /^(.*?)@(dev|alpha|beta|rc|stable)$/i;

const MATCH_ALL_RE = /^v?[xX*](?:\.[xX*])*$/;

const COMPARATOR_RE = /^(<>|!=|>=|<=|==|=|>|<)\s*(.+)$/;

/** Operator-only token, as in `>= 1.0` written with a space. */
const OPERATOR_ONLY_RE = /^(?:<>|!=|>=|<=|==|=|>|<)$/;

/** `1.0.*`, `1.*`, `1.0.x`: one to three numeric components followed by wildcards only. */
const WILDCARD_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.[xX*])+$/;

/** Leading numeric components of a version text, used to decide how much a bound was given. */
const LEADING_NUMERIC_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/;

function componentsVersion(components: [number, number, number, number]): ComposerVersion {
  return {
    components,
    stability: "stable",
    stabilityNumber: 0,
    branch: false,
    raw: components.join("."),
  };
}

/** Parses a tagged (non-branch) version or returns null. */
function taggedVersion(text: string): ComposerVersion | null {
  const v = normalizeComposer(text);
  return v === null || v.branch ? null : v;
}

/** The number of numeric components written in the text (1 to 4), or null when it has none. */
function givenComponents(text: string): number | null {
  const m = LEADING_NUMERIC_RE.exec(text);
  if (m === null) return null;
  return [m[1], m[2], m[3], m[4]].filter((p) => p !== undefined).length;
}

/** `[1, 2, 0, 0]` with position 1 incremented and everything after it zeroed: `[1, 3, 0, 0]`. */
function nextAt(
  components: [number, number, number, number],
  position: number,
): [number, number, number, number] {
  const next: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < position; i++) next[i] = components[i] ?? 0;
  next[position] = (components[position] ?? 0) + 1;
  return next;
}

/** `A - B`: `>=A` and, for a partial B, `<` the next minor/major; a full B is inclusive. */
function hyphenBounds(from: string, to: string): AndGroup | null {
  const low = taggedVersion(from);
  const high = taggedVersion(to);
  const given = givenComponents(to);
  if (low === null || high === null || given === null) return null;
  if (given >= 3)
    return [
      { op: ">=", version: low },
      { op: "<=", version: high },
    ];
  const upper = componentsVersion(nextAt(high.components, given - 1));
  return [
    { op: ">=", version: low },
    { op: "<", version: upper },
  ];
}

/** `~1.2.3` ≡ `>=1.2.3 <1.3.0`; `~1.2` ≡ `>=1.2 <2.0.0`; `~1` ≡ `>=1 <2`. */
function tildeBounds(text: string): AndGroup | null {
  const low = taggedVersion(text);
  const given = givenComponents(text);
  if (low === null || given === null) return null;
  const position = given === 1 ? 0 : given - 2;
  const upper = componentsVersion(nextAt(low.components, position));
  return [
    { op: ">=", version: low },
    { op: "<", version: upper },
  ];
}

/** `^1.2.3` ≡ `>=1.2.3 <2.0.0`; `^0.3` ≡ `<0.4.0`; `^0.0.3` ≡ `<0.0.4`. At most 3 components. */
function caretBounds(text: string): AndGroup | null {
  const low = taggedVersion(text);
  const given = givenComponents(text);
  if (low === null || given === null || given > 3) return null;
  const [major, minor] = low.components;
  let position: number;
  if (major !== 0 || given === 1) position = 0;
  else if (minor !== 0 || given === 2) position = 1;
  else position = 2;
  const upper = componentsVersion(nextAt(low.components, position));
  return [
    { op: ">=", version: low },
    { op: "<", version: upper },
  ];
}

/** `1.0.*` ≡ `>=1.0 <1.1`; `1.*` ≡ `>=1 <2`. */
function wildcardBounds(m: RegExpExecArray): AndGroup {
  const parts = [m[1], m[2], m[3]].filter((p): p is string => p !== undefined).map(Number);
  const low = componentsVersion(pad(parts));
  const upper = componentsVersion(nextAt(low.components, parts.length - 1));
  return [
    { op: ">=", version: low },
    { op: "<", version: upper },
  ];
}

/** One atom of an AND group, with its `@stability` flag already removed. Null when invalid. */
function parseAtom(atom: string): AndGroup | null {
  if (atom === "" || MATCH_ALL_RE.test(atom)) return [];

  const wildcard = WILDCARD_RE.exec(atom);
  if (wildcard !== null) return wildcardBounds(wildcard);

  if (atom.startsWith("~")) return tildeBounds(atom.slice(1));
  if (atom.startsWith("^")) return caretBounds(atom.slice(1));

  const comparator = COMPARATOR_RE.exec(atom);
  if (comparator !== null) {
    const version = taggedVersion(comparator[2] as string);
    if (version === null) return null;
    const raw = comparator[1] as string;
    const op: BoundOp = raw === "<>" ? "!=" : raw === "=" ? "==" : (raw as BoundOp);
    return [{ op, version }];
  }

  const exact = taggedVersion(atom);
  return exact === null ? null : [{ op: "==", version: exact }];
}

function stripStabilityFlag(text: string): string {
  const m = STABILITY_FLAG_RE.exec(text);
  return m === null ? text : (m[1] as string);
}

/**
 * Splits an AND group into atoms: whitespace or commas separate atoms, an operator-only token
 * joins the next token (`>= 1.0`), and `A - B` with spaces around the hyphen is one atom.
 */
function parseAndGroup(group: string): AndGroup | null {
  const tokens = group.split(/[\s,]+/).filter((t) => t !== "");
  if (tokens.length === 0) return null;
  const bounds: AndGroup = [];
  let i = 0;
  while (i < tokens.length) {
    let token = tokens[i] as string;
    if (token === "-") return null;
    if (OPERATOR_ONLY_RE.test(token)) {
      const next = tokens[i + 1];
      if (next === undefined || next === "-") return null;
      token += next;
      i += 1;
    }
    const after = tokens[i + 1];
    let atomBounds: AndGroup | null;
    if (after === "-") {
      const to = tokens[i + 2];
      if (to === undefined || to === "-") return null;
      atomBounds = hyphenBounds(stripStabilityFlag(token), stripStabilityFlag(to));
      i += 3;
    } else {
      atomBounds = parseAtom(stripStabilityFlag(token));
      i += 1;
    }
    if (atomBounds === null) return null;
    bounds.push(...atomBounds);
  }
  return bounds;
}

function satisfies(bound: Bound, version: ComposerVersion): boolean {
  const cmp = compareComposer(version, bound.version);
  switch (bound.op) {
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "==":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
  }
}

/**
 * Parses an exact Composer version (`1.2.3`, `=1.2.3`, `==1.2.3`, `v1.2.3`) or a constraint
 * (`1.0.*`, `>=1.0 <2.0`, `1.0 - 2.0`, `~1.2`, `^1.2.3`, `^1.0 || ^2.0`, trailing `@dev` and
 * other stability flags). Branch versions (`dev-main`, `2.x-dev`), `#commit` references,
 * `X as Y` aliases and anything else that is not a constraint throw UnparseableRange.
 *
 * Bounds use the plain ordering of `compareComposer`, so `<2.0.0` admits `2.0.0-RC1` (which sorts
 * below `2.0.0`). Composer adds `-dev` suffixes to some bounds to shape this; the tool only ever
 * asks `matches` about stable candidates (the adapter drops pre-releases before resolving
 * `v_match`), so those rules are deliberately not reproduced here.
 */
export function parseComposerCheck(input: string): VersionCheck {
  const fail = (): never => {
    throw new UnparseableRange(`cannot parse Composer version or constraint "${input}"`);
  };
  const text = input.trim();
  if (text === "") return fail();

  const bare = stripStabilityFlag(text).replace(/^==?\s*/, "");
  const single = normalizeComposer(bare);
  if (single !== null) {
    if (single.branch) return fail();
    return { kind: "exact", version: bare.trim() };
  }

  const groups: AndGroup[] = [];
  for (const group of text.split(/\s*\|\|?\s*/)) {
    const bounds = parseAndGroup(group);
    if (bounds === null) return fail();
    groups.push(bounds);
  }

  return {
    kind: "range",
    matches: (version: string): boolean => {
      const candidate = normalizeComposer(version);
      if (candidate === null || candidate.branch) return false;
      return groups.some((group) => group.every((bound) => satisfies(bound, candidate)));
    },
  };
}
