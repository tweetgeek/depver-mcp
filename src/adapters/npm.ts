import { InvalidName, RegistryError, UnparseableRange } from "../core/errors.js";
import type { Adapter, FetchJson, FetchOutcome, VersionEntry } from "../core/types.js";
import { compareSemver, isSemverPrerelease } from "../versions/semver-range.js";

const REGISTRY = "https://registry.npmjs.org";
/** Abbreviated metadata: dist-tags, versions and per-version `deprecated`, a fraction of the full doc. */
const ACCEPT = "application/vnd.npm.install-v1+json";

// Unscoped: lowercase URL-safe name; scoped: @scope/name. Mirrors validate-npm-package-name's rules
// closely enough for lookups (names are lowercase-only on the registry).
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

interface AbbreviatedDoc {
  name?: unknown;
  "dist-tags"?: unknown;
  versions?: unknown;
}

function normalizeName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name || name.startsWith(".") || !NAME_RE.test(name) || name.length > 214) {
    throw new InvalidName(`"${raw.trim()}" is not a valid npm package name`);
  }
  return name;
}

function encodeName(name: string): string {
  return name.replace("/", "%2F");
}

async function fetchPackage(name: string, http: FetchJson): Promise<FetchOutcome> {
  const { status, json } = await http(`${REGISTRY}/${encodeName(name)}`, { accept: ACCEPT });

  if (status === 404) return { kind: "not_found", name };
  if (status !== 200) {
    throw new RegistryError("malformed", `npm registry answered HTTP ${status}`, status);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new RegistryError("malformed", "npm registry returned an unexpected document", status);
  }
  const doc = json as AbbreviatedDoc;

  // A fully unpublished package still answers 200, but the abbreviated doc has no versions.
  if (doc.versions === undefined)
    return { kind: "not_found", name, reason: "unpublished from npm" };
  if (typeof doc.versions !== "object" || doc.versions === null) {
    throw new RegistryError("malformed", "npm registry document has no versions object", status);
  }

  const versions: VersionEntry[] = [];
  for (const [version, meta] of Object.entries(doc.versions as Record<string, unknown>)) {
    const entry: VersionEntry = { version, prerelease: isSemverPrerelease(version) };
    const deprecated =
      typeof meta === "object" && meta !== null
        ? (meta as { deprecated?: unknown }).deprecated
        : undefined;
    if (typeof deprecated === "string" && deprecated.length > 0) entry.deprecated = deprecated;
    versions.push(entry);
  }

  const tags = doc["dist-tags"];
  const latestTag =
    typeof tags === "object" && tags !== null ? (tags as { latest?: unknown }).latest : undefined;

  const info: FetchOutcome = { kind: "info", name, versions };
  if (typeof latestTag === "string" && latestTag.length > 0) info.stableHint = latestTag;
  return info;
}

export const npmAdapter: Adapter = {
  id: "npm",
  concurrency: 6,
  normalizeName,
  fetch: fetchPackage,
  isPrerelease: isSemverPrerelease,
  compare: compareSemver,
  parseVersionOrRange: () => {
    throw new UnparseableRange("version checks are not implemented yet");
  },
};
