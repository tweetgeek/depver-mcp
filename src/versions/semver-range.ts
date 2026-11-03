/**
 * Semver ordering shared by the npm and pub.dev adapters (research.md R7).
 * Range matching lives in a later task; this file only orders versions.
 */
import semver from "semver";
import { UnparseableRange } from "../core/errors.js";

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
