import { InvalidName, RegistryError } from "../core/errors.js";
import type { Adapter, FetchJson, FetchOutcome, VersionEntry } from "../core/types.js";
import {
  compareComposer,
  isComposerPrerelease,
  normalizeComposer,
  parseComposerCheck,
} from "../versions/composer.js";

/** Static, CDN-served metadata Composer itself uses; tagged releases only (branches live in ~dev). */
const P2 = "https://repo.packagist.org/p2";

// vendor/package, lowercase, as in the composer.json schema.
const NAME_RE = /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/;

interface P2Doc {
  minified?: unknown;
  packages?: unknown;
}

function normalizeName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name))
    throw new InvalidName(`"${raw.trim()}" is not a valid Packagist vendor/package name`);
  return name;
}

/**
 * Expand the `composer/2.0` minified format: the first entry is complete, each later entry lists
 * only the keys that differ from the previous expanded entry, and `"__unset"` deletes a key.
 */
export function expandMinified(
  entries: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let prev: Record<string, unknown> = {};
  for (const entry of entries) {
    const cur: Record<string, unknown> = { ...prev };
    for (const [key, value] of Object.entries(entry)) {
      if (value === "__unset") delete cur[key];
      else cur[key] = value;
    }
    out.push(cur);
    prev = cur;
  }
  return out;
}

async function fetchPackage(name: string, http: FetchJson): Promise<FetchOutcome> {
  const { status, json } = await http(`${P2}/${name}.json`);

  if (status === 404) return { kind: "not_found", name };
  if (status !== 200)
    throw new RegistryError("malformed", `Packagist answered HTTP ${status}`, status);
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new RegistryError("malformed", "Packagist returned an unexpected document", status);
  }
  const doc = json as P2Doc;
  const packages = doc.packages;
  const rawEntries =
    typeof packages === "object" && packages !== null
      ? (packages as Record<string, unknown>)[name]
      : undefined;
  if (!Array.isArray(rawEntries)) {
    throw new RegistryError(
      "malformed",
      "Packagist document has no entries for the package",
      status,
    );
  }

  const entries =
    doc.minified === "composer/2.0"
      ? expandMinified(rawEntries as Array<Record<string, unknown>>)
      : (rawEntries as Array<Record<string, unknown>>);

  const versions: VersionEntry[] = [];
  let abandoned: unknown;
  for (const entry of entries) {
    const version = entry["version"];
    if (typeof version !== "string" || !normalizeComposer(version)) continue;
    versions.push({ version, prerelease: isComposerPrerelease(version) });
    if (abandoned === undefined && entry["abandoned"] !== undefined) abandoned = entry["abandoned"];
  }

  const info: FetchOutcome = { kind: "info", name, versions };
  if (abandoned === true) info.deprecated = { message: "abandoned" };
  else if (typeof abandoned === "string" && abandoned.length > 0) {
    info.deprecated = { message: `abandoned, use ${abandoned}` };
  }
  return info;
}

export const packagistAdapter: Adapter = {
  id: "packagist",
  concurrency: 6,
  normalizeName,
  fetch: fetchPackage,
  isPrerelease: (v) => isComposerPrerelease(v),
  compare: (a, b) => compareComposer(a, b),
  parseVersionOrRange: (input) => parseComposerCheck(input),
};
