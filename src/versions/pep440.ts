/**
 * PEP 440 version parsing and ordering (research.md R7). No dependencies.
 *
 * Mirrors `packaging.version.Version`: the canonical VERSION_PATTERN with alias normalization
 * (alpha→a, beta→b, c/pre/preview→rc, rev/r/-N→post) and the `_cmpkey` ordering
 * (dev < a < b < rc < final < post; local above the same public version).
 *
 * Version specifiers (`parsePep440Check`, `filterPep440Matches`) mirror `packaging.specifiers`
 * (checked against packaging 26.2): the operator rules of PEP 440 "Version specifiers" and the
 * pre-release handling of `SpecifierSet.contains` / `SpecifierSet.filter`.
 */
import { UnparseableRange } from "../core/errors.js";
import type { VersionCheck } from "../core/types.js";

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

// ---------------------------------------------------------------------------------------------
// Version specifiers (PEP 440 "Version specifiers", as implemented by `packaging.specifiers`).
// ---------------------------------------------------------------------------------------------

type Operator = "===" | "~=" | "==" | "!=" | "<=" | ">=" | "<" | ">";

interface Clause {
  op: Operator;
  /** The version text after the operator, trimmed; `===` compares against it verbatim. */
  text: string;
  /** Parsed `text`; absent for `==X.*` / `!=X.*` and for a `===` text that is not a version. */
  version?: Pep440Version;
  /** `[epoch, ...release]` of a `==X.*` / `!=X.*` prefix. */
  prefix?: number[];
}

interface SpecifierSet {
  clauses: Clause[];
  /**
   * packaging's `SpecifierSet.prereleases` autodetect: true when some clause names a pre-release
   * version. `!=` and `==X.*` clauses never do.
   */
  allowsPrereleases: boolean;
}

const OPERATOR_RE = /^(===|~=|==|!=|<=|>=|<|>)([\s\S]*)$/;
const WILDCARD_PREFIX_RE = /^v?(?:([0-9]+)!)?([0-9]+(?:\.[0-9]+)*)$/i;
const ARBITRARY_RE = /^[^\s;)]+$/;

/** `packaging`'s `Version.__replace__`, limited to what the operators need: `null` removes. */
function replace(
  v: Pep440Version,
  changes: { post?: null; dev?: number | null; local?: null },
): Pep440Version {
  const out: Pep440Version = { epoch: v.epoch, release: v.release, raw: v.raw };
  if (v.pre !== undefined) out.pre = v.pre;
  if (changes.post === undefined && v.post !== undefined) out.post = v.post;
  if (changes.dev === undefined) {
    if (v.dev !== undefined) out.dev = v.dev;
  } else if (changes.dev !== null) {
    out.dev = changes.dev;
  }
  if (changes.local === undefined && v.local !== undefined) out.local = v.local;
  return out;
}

function publicVersion(v: Pep440Version): Pep440Version {
  return v.local === undefined ? v : replace(v, { local: null });
}

function parseClause(raw: string): Clause | null {
  const m = OPERATOR_RE.exec(raw.trim());
  if (m === null) return null;
  const op = m[1] as Operator;
  const text = (m[2] as string).trim();
  if (op === "===") {
    if (!ARBITRARY_RE.test(text)) return null;
    const version = parsePep440(text);
    return version === null ? { op, text } : { op, text, version };
  }
  if ((op === "==" || op === "!=") && text.endsWith(".*")) {
    const p = WILDCARD_PREFIX_RE.exec(text.slice(0, -2));
    if (p === null) return null;
    const release = (p[2] as string).split(".").map((s) => Number.parseInt(s, 10));
    return { op, text, prefix: [toNumber(p[1]), ...release] };
  }
  const version = parsePep440(text);
  if (version === null) return null;
  if (op !== "==" && op !== "!=" && version.local !== undefined) return null;
  if (op === "~=" && version.release.length < 2) return null;
  return { op, text, version };
}

function namesPrerelease(c: Clause): boolean {
  return (
    c.op !== "!=" &&
    c.prefix === undefined &&
    c.version !== undefined &&
    isPep440Prerelease(c.version)
  );
}

function parseSpecifierSet(input: string): SpecifierSet | null {
  const clauses: Clause[] = [];
  for (const part of input.split(",")) {
    const clause = parseClause(part);
    if (clause === null) return null;
    clauses.push(clause);
  }
  return { clauses, allowsPrereleases: clauses.some(namesPrerelease) };
}

/** `==X.*`: the candidate's `[epoch, ...release]`, zero-padded, starts with the prefix. */
function matchesPrefix(candidate: Pep440Version, prefix: number[]): boolean {
  const parts = [candidate.epoch, ...candidate.release];
  for (let i = 0; i < prefix.length; i++) {
    if ((parts[i] ?? 0) !== prefix[i]) return false;
  }
  return true;
}

function equals(candidate: Pep440Version, c: Clause): boolean {
  if (c.prefix !== undefined) return matchesPrefix(candidate, c.prefix);
  const spec = c.version as Pep440Version;
  // Without a local label in the specifier, the candidate's local label is ignored.
  const subject = spec.local === undefined ? publicVersion(candidate) : candidate;
  return comparePep440(subject, spec) === 0;
}

function lessThan(candidate: Pep440Version, spec: Pep440Version): boolean {
  if (comparePep440(candidate, spec) >= 0) return false;
  // "<V MUST NOT allow a pre-release of the specified version unless the specified version is
  // itself a pre-release": V.dev0 is the earliest pre-release of V.
  if (
    !isPep440Prerelease(spec) &&
    isPep440Prerelease(candidate) &&
    comparePep440(candidate, replace(spec, { dev: 0, local: null })) >= 0
  ) {
    return false;
  }
  return true;
}

function greaterThan(candidate: Pep440Version, spec: Pep440Version): boolean {
  if (comparePep440(candidate, spec) <= 0) return false;
  // ">V MUST NOT allow a post-release of the specified version unless the specified version is
  // itself a post-release."
  if (
    spec.post === undefined &&
    candidate.post !== undefined &&
    comparePep440(replace(candidate, { post: null, dev: null, local: null }), spec) === 0
  ) {
    return false;
  }
  // ">V MUST NOT match a local version of the specified version."
  if (candidate.local !== undefined && comparePep440(publicVersion(candidate), spec) === 0) {
    return false;
  }
  return true;
}

/** One clause against one parsed candidate (`raw` is the candidate as given, for `===`). */
function satisfies(c: Clause, candidate: Pep440Version, raw: string): boolean {
  if (c.op === "===") return raw.toLowerCase() === c.text.toLowerCase();
  if (c.op === "==") return equals(candidate, c);
  if (c.op === "!=") return !equals(candidate, c);
  const spec = c.version as Pep440Version;
  switch (c.op) {
    case "<=":
      return comparePep440(publicVersion(candidate), spec) <= 0;
    case ">=":
      return comparePep440(publicVersion(candidate), spec) >= 0;
    case "<":
      return lessThan(candidate, spec);
    case ">":
      return greaterThan(candidate, spec);
    case "~=":
      // ~=V ≡ >=V, ==<V minus its last release segment>.*
      return (
        comparePep440(publicVersion(candidate), spec) >= 0 &&
        matchesPrefix(candidate, [spec.epoch, ...spec.release.slice(0, -1)])
      );
  }
}

/** Every clause holds for `raw`, ignoring the pre-release gate. */
function satisfiesAll(set: SpecifierSet, raw: string): boolean {
  const candidate = parsePep440(raw);
  if (candidate === null) {
    // Only `===` can match a string that is not a version.
    return set.clauses.every((c) => c.op === "===" && raw.toLowerCase() === c.text.toLowerCase());
  }
  return set.clauses.every((c) => satisfies(c, candidate, raw));
}

/** The specifier set behind each range check built here, for `filterPep440Matches`. */
const SPECIFIER_SETS = new WeakMap<VersionCheck, SpecifierSet>();

/**
 * Parses a PyPI version or version specifier set.
 *
 * - A bare version (after trimming) gives `{ kind: "exact", version }`.
 * - Otherwise a comma-separated specifier set with the operators `==`, `!=`, `<=`, `>=`, `<`,
 *   `>`, `~=`, `===` and `==X.*` / `!=X.*` prefix matching, whitespace around commas and after
 *   operators tolerated. `matches(version)` applies `packaging`'s per-candidate rule: a
 *   pre-release candidate matches only if some clause names a pre-release version (the
 *   `prereleases` autodetect; `!=` and `==X.*` do not enable them). A candidate that is not a
 *   PEP 440 version matches only through `===`. For the full `SpecifierSet.filter` semantics
 *   over a candidate list (pre-releases as a fallback when no final matches) use
 *   `filterPep440Matches`.
 *
 * Throws `UnparseableRange` for anything else (unknown operator, `~=` with one release segment,
 * `==2.*.*`, `==*`, empty clauses, local labels with ordered operators, `^1.0`, `1.x`, ...).
 */
export function parsePep440Check(input: string): VersionCheck {
  const trimmed = input.trim();
  if (parsePep440(trimmed) !== null) return { kind: "exact", version: trimmed };
  const set = trimmed === "" ? null : parseSpecifierSet(trimmed);
  if (set === null) {
    throw new UnparseableRange(`cannot parse PyPI version or specifier "${input}"`);
  }
  const check: VersionCheck = {
    kind: "range",
    matches: (version) =>
      (set.allowsPrereleases || !isPrereleaseOrInvalid(version)) && satisfiesAll(set, version),
  };
  SPECIFIER_SETS.set(check, set);
  return check;
}

/** True for pre-releases; false for finals and for strings that are not versions. */
function isPrereleaseOrInvalid(version: string): boolean {
  const parsed = parsePep440(version);
  return parsed !== null && isPep440Prerelease(parsed);
}

/**
 * `packaging`'s `SpecifierSet.filter`: the candidates (in input order) that satisfy `check`.
 * Unless a clause names a pre-release version, pre-releases are returned only when no final
 * release matches. An exact check filters by PEP 440 equality (`2.31` equals `2.31.0`), with the
 * candidate's local label ignored unless the exact version carries one. A range check that was
 * not built by `parsePep440Check` is filtered through its `matches` alone.
 */
export function filterPep440Matches(versions: string[], check: VersionCheck): string[] {
  let set: SpecifierSet | undefined;
  if (check.kind === "exact") {
    const version = parsePep440(check.version);
    if (version === null) {
      throw new UnparseableRange(`cannot parse PyPI version or specifier "${check.version}"`);
    }
    const clause: Clause = { op: "==", text: check.version, version };
    set = { clauses: [clause], allowsPrereleases: namesPrerelease(clause) };
  } else {
    set = SPECIFIER_SETS.get(check);
    if (set === undefined) return versions.filter((v) => check.matches(v));
  }
  const spec = set;
  const hits = versions.filter((v) => satisfiesAll(spec, v));
  if (spec.allowsPrereleases) return hits;
  const finals = hits.filter((v) => !isPrereleaseOrInvalid(v));
  // Strings that are not versions (matched through `===`) count as finals once a final exists;
  // with no final at all, everything that matched is returned.
  return finals.some((v) => parsePep440(v) !== null) ? finals : hits;
}
