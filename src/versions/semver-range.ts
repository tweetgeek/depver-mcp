/**
 * Semver ordering and range matching shared by the npm and pub.dev adapters (research.md R7).
 */
import semver from "semver";
import { UnparseableRange } from "../core/errors.js";
import type { VersionCheck } from "../core/types.js";

function parse(v: string): semver.SemVer {
  const parsed = semver.parse(v, { loose: true });
  if (parsed === null) throw new UnparseableRange(`invalid version "${v}"`);
  return parsed;
}

/** Strict semver order; build metadata is ignored, as the spec demands. Throws on invalid input. */
export function compareSemver(a: string, b: string): number {
  return parse(a).compare(parse(b));
}

/** True when the version carries pre-release identifiers (`1.0.0-beta.1`); build metadata alone does not count. */
export function isSemverPrerelease(v: string): boolean {
  return parse(v).prerelease.length > 0;
}

const NUMERIC = /^\d+$/;

function compareBuildIdentifier(a: string, b: string): number {
  if (NUMERIC.test(a) && NUMERIC.test(b)) {
    const diff = Number(a) - Number(b);
    return diff === 0 ? 0 : diff < 0 ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver order, then build metadata ascending (pub.dev semantics: `1.2.3 < 1.2.3+1 < 1.2.3+2`). */
export function compareWithBuildTieBreak(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const order = pa.compare(pb);
  if (order !== 0) return order;

  const len = Math.min(pa.build.length, pb.build.length);
  for (let i = 0; i < len; i++) {
    const diff = compareBuildIdentifier(pa.build[i] ?? "", pb.build[i] ?? "");
    if (diff !== 0) return diff;
  }
  // Shorter build list (including none at all) sorts first.
  return Math.sign(pa.build.length - pb.build.length);
}

export type SemverDialect = "npm" | "pub";

const RANGE_OPTIONS = { includePrerelease: false } as const;

/** A full `major.minor.patch` version with optional pre-release and build parts (no `v`, no wildcards). */
const FULL_VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const PUB_CARET = new RegExp(String.raw`^\^(${FULL_VERSION})$`);
const PUB_COMPARATOR = new RegExp(String.raw`^(?:>=|>|<=|<)(${FULL_VERSION})$`);

/**
 * Translates a pub.dev constraint onto node-semver syntax, or returns null when the input is not
 * one of the forms pub accepts: `any`, `^x.y.z` with a full version, or comparators (`>=`, `>`,
 * `<=`, `<`) each followed by a full version and separated by single spaces. `~`, `x`/`*`
 * wildcards, hyphen ranges and `||` do not exist in pub and are rejected.
 */
function translatePubConstraint(input: string): string | null {
  if (input === "any") return "*";

  const caret = PUB_CARET.exec(input);
  if (caret !== null) {
    return semver.valid(caret[1] ?? "") === null ? null : input;
  }

  const parts = input.split(" ");
  for (const part of parts) {
    const comparator = PUB_COMPARATOR.exec(part);
    if (comparator === null || semver.valid(comparator[1] ?? "") === null) return null;
  }
  return parts.join(" ");
}

function buildRange(source: string): semver.Range | null {
  try {
    return new semver.Range(source, RANGE_OPTIONS);
  } catch {
    return null;
  }
}

/**
 * Parses an exact version or a range in the given dialect (research.md R7).
 * An input that `semver.valid` accepts (loosely, so a leading `v` passes) is returned as-is as an
 * exact version; the adapter compares it with its own comparator. Anything else is a range
 * evaluated with `includePrerelease: false`, so `^18` never matches `18.0.0-beta.1` while
 * `>=1.0.0-alpha` may match pre-releases of `1.0.0` only.
 * Throws UnparseableRange on input the dialect cannot express.
 */
export function parseSemverCheck(input: string, opts: { dialect: SemverDialect }): VersionCheck {
  const trimmed = input.trim();
  const fail = (): never => {
    const what = opts.dialect === "npm" ? "npm version or range" : "pub.dev version constraint";
    throw new UnparseableRange(`cannot parse ${what} "${trimmed}"`);
  };

  if (trimmed === "") return fail();
  if (semver.valid(trimmed, { loose: true }) !== null) {
    return { kind: "exact", version: trimmed };
  }

  const source = opts.dialect === "npm" ? trimmed : translatePubConstraint(trimmed);
  if (source === null) return fail();

  const range = buildRange(source);
  if (range === null) return fail();

  return {
    kind: "range",
    matches: (version) => semver.satisfies(version, range, RANGE_OPTIONS),
  };
}
