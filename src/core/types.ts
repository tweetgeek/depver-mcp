/**
 * Core domain types. See specs/001-package-version-mcp/data-model.md and GLOSSARY.md.
 * Nothing here knows about any particular registry.
 */

export const ECOSYSTEMS = ["npm", "pypi", "pub", "packagist"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

/** One item of a batch, as the agent sent it (aliases not yet resolved). */
export interface PackageQuery {
  ecosystem: string;
  name: string;
  version?: string | undefined;
}

export type Status = "ok" | "deprecated" | "not_found" | "error";

/** One compact answer. Key presence rules are normative in data-model.md. */
export interface PackageResult {
  e: Ecosystem | string;
  n: string;
  s: Status;
  stable?: string;
  latest?: string;
  v?: string;
  v_exists?: boolean;
  v_yanked?: boolean;
  v_deprecated?: boolean;
  v_match?: string | null;
  msg?: string;
}

export interface VersionEntry {
  /** Version string as published (original form, used for output). */
  version: string;
  prerelease: boolean;
  /** Only ecosystems with a yank/retract concept set this. */
  yanked?: boolean;
  /** Per-version deprecation message (npm). */
  deprecated?: string;
}

export interface VersionInfo {
  kind: "info";
  /** Normalized name as the registry knows it. */
  name: string;
  versions: VersionEntry[];
  /** Registry-declared stable version (npm dist-tags.latest, pub.dev latest.version). */
  stableHint?: string;
  /** Package-level deprecation. */
  deprecated?: { message: string };
}

export interface NotFound {
  kind: "not_found";
  name: string;
  /** Registry-stated reason, e.g. "unpublished from npm". */
  reason?: string;
}

export type FetchOutcome = VersionInfo | NotFound;

export type VersionCheck =
  { kind: "exact"; version: string } | { kind: "range"; matches: (version: string) => boolean };

export interface FetchJsonOptions {
  accept?: string;
  timeoutMs?: number;
}

export interface FetchJsonResponse {
  status: number;
  /** Parsed JSON body; null for non-JSON or empty bodies on non-2xx responses. */
  json: unknown;
}

export type FetchJson = (url: string, opts?: FetchJsonOptions) => Promise<FetchJsonResponse>;

/** The one contract every ecosystem implements (Constitution V). */
export interface Adapter {
  readonly id: Ecosystem;
  /** Max in-flight requests to this registry. */
  readonly concurrency: number;
  /** Ecosystem-specific normalization and syntactic validation; throws InvalidName. */
  normalizeName(raw: string): string;
  /** One registry round-trip. Throws RegistryError on failure. */
  fetch(name: string, http: FetchJson): Promise<FetchOutcome>;
  isPrerelease(version: string): boolean;
  /** Total order on this ecosystem's versions. */
  compare(a: string, b: string): number;
  /** Exact version or range in native syntax; throws UnparseableRange. */
  parseVersionOrRange(input: string): VersionCheck;
}
