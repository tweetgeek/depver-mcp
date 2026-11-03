/**
 * PEP 440 version parsing and ordering (research.md R7). No dependencies.
 *
 * Mirrors `packaging.version.Version`: the canonical VERSION_PATTERN with alias normalization
 * (alpha→a, beta→b, c/pre/preview→rc, rev/r/-N→post) and the `_cmpkey` ordering
 * (dev < a < b < rc < final < post; local above the same public version).
 */
import { UnparseableRange } from "../core/errors.js";

export type Pep440PreLetter = "a" | "b" | "rc";

export interface Pep440Version {
  epoch: number;
  release: number[];
  pre?: [Pep440PreLetter, number];
  post?: number;
  dev?: number;
  local?: Array<string | number>;
  /** The input as given (used for output). */
  raw: string;
}

// packaging's VERSION_PATTERN, anchored and with optional surrounding whitespace.
const VERSION_RE = new RegExp(
  "^\\s*v?" +
    "(?:(?<epoch>[0-9]+)!)?" +
    "(?<release>[0-9]+(?:\\.[0-9]+)*)" +
    "(?:[-_.]?(?<preL>alpha|a|beta|b|preview|pre|c|rc)[-_.]?(?<preN>[0-9]+)?)?" +
    "(?<post>-(?<postN1>[0-9]+)|[-_.]?(?:post|rev|r)[-_.]?(?<postN2>[0-9]+)?)?" +
    "(?<dev>[-_.]?dev[-_.]?(?<devN>[0-9]+)?)?" +
    "(?:\\+(?<local>[a-z0-9]+(?:[-_.][a-z0-9]+)*))?" +
    "\\s*$",
  "i",
);

const PRE_ALIASES: Record<string, Pep440PreLetter> = {
  a: "a",
  alpha: "a",
  b: "b",
  beta: "b",
  c: "rc",
  rc: "rc",
  pre: "rc",
  preview: "rc",
};

function toNumber(digits: string | undefined): number {
  return digits === undefined ? 0 : Number.parseInt(digits, 10);
}

export function parsePep440(input: string): Pep440Version | null {
  const m = VERSION_RE.exec(input);
  if (m === null || m.groups === undefined) return null;
  const g = m.groups;
  const version: Pep440Version = {
    epoch: toNumber(g["epoch"]),
    release: (g["release"] as string).split(".").map((s) => Number.parseInt(s, 10)),
    raw: input,
  };
  if (g["preL"] !== undefined) {
    const letter = PRE_ALIASES[g["preL"].toLowerCase()];
    if (letter === undefined) return null;
    version.pre = [letter, toNumber(g["preN"])];
  }
  if (g["post"] !== undefined) version.post = toNumber(g["postN1"] ?? g["postN2"]);
  if (g["dev"] !== undefined) version.dev = toNumber(g["devN"]);
  if (g["local"] !== undefined) {
    version.local = g["local"]
      .toLowerCase()
      .split(/[-_.]/)
      .map((part) => (/^[0-9]+$/.test(part) ? Number.parseInt(part, 10) : part));
  }
  return version;
}

function toVersion(v: string | Pep440Version): Pep440Version {
  if (typeof v !== "string") return v;
  const parsed = parsePep440(v);
  if (parsed === null) throw new UnparseableRange(`"${v}" is not a valid PEP 440 version`);
  return parsed;
}

/** A value in a comparison key: -Infinity/Infinity stand for packaging's sentinels. */
type KeyPart = number | string | number[] | Array<[number, string]>;

/** packaging's `_cmpkey`: an ordered tuple where every slot compares with `compareParts`. */
function cmpKey(v: Pep440Version): KeyPart[] {
  const release = [...v.release];
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();
  // Versions with only a dev segment sort before any pre-release of the same release.
  const pre =
    v.pre === undefined
      ? v.post === undefined && v.dev !== undefined
        ? -Infinity
        : Infinity
      : [v.pre[0] === "a" ? 0 : v.pre[0] === "b" ? 1 : 2, v.pre[1]];
  const post = v.post ?? -Infinity;
  const dev = v.dev ?? Infinity;
  // Numeric local segments compare greater than lexicographic ones (PEP 440).
  const local: KeyPart =
    v.local === undefined
      ? -Infinity
      : v.local.map((s): [number, string] => (typeof s === "number" ? [s, ""] : [-Infinity, s]));
  return [v.epoch, release, pre, post, dev, local];
}

function compareScalars(a: number | string, b: number | string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareParts(a: KeyPart, b: KeyPart): number {
  // A sentinel (-Infinity / Infinity) sorts below / above every tuple.
  if (!Array.isArray(a) && !Array.isArray(b)) return compareScalars(a, b);
  if (!Array.isArray(a)) return a === -Infinity ? -1 : 1;
  if (!Array.isArray(b)) return b === -Infinity ? 1 : -1;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number | [number, string];
    const y = b[i] as number | [number, string];
    const c = Array.isArray(x)
      ? compareScalars(x[0], (y as [number, string])[0]) ||
        compareScalars(x[1], (y as [number, string])[1])
      : compareScalars(x, y as number);
    if (c !== 0) return c;
  }
  return compareScalars(a.length, b.length);
}

/** Total order per PEP 440. Throws `UnparseableRange` when a string argument does not parse. */
export function comparePep440(a: string | Pep440Version, b: string | Pep440Version): number {
  const ka = cmpKey(toVersion(a));
  const kb = cmpKey(toVersion(b));
  for (let i = 0; i < ka.length; i++) {
    const c = compareParts(ka[i] as KeyPart, kb[i] as KeyPart);
    if (c !== 0) return c;
  }
  return 0;
}

/** True for a/b/rc and dev releases (`packaging`'s `is_prerelease`); post releases are final. */
export function isPep440Prerelease(v: string | Pep440Version): boolean {
  const version = toVersion(v);
  return version.pre !== undefined || version.dev !== undefined;
}
