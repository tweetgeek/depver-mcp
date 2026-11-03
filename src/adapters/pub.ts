import { InvalidName, RegistryError, UnparseableRange } from "../core/errors.js";
import type { Adapter, FetchJson, FetchOutcome, VersionEntry } from "../core/types.js";
import { compareWithBuildTieBreak, isSemverPrerelease } from "../versions/semver-range.js";

const API = "https://pub.dev/api/packages";
const ACCEPT = "application/vnd.pub.v2+json";

// Dart package names: lowercase letters, digits and underscores, not starting with a digit.
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

interface PubDoc {
  name?: unknown;
  latest?: unknown;
  versions?: unknown;
  isDiscontinued?: unknown;
  replacedBy?: unknown;
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!NAME_RE.test(name)) throw new InvalidName(`"${name}" is not a valid pub.dev package name`);
  return name;
}

async function fetchPackage(name: string, http: FetchJson): Promise<FetchOutcome> {
  const { status, json } = await http(`${API}/${name}`, { accept: ACCEPT });

  // Unknown packages answer 404 with an XML body from the storage bucket; never parse it.
  if (status === 404) return { kind: "not_found", name };
  if (status !== 200) {
    throw new RegistryError("malformed", `pub.dev answered HTTP ${status}`, status);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new RegistryError("malformed", "pub.dev returned an unexpected document", status);
  }
  const doc = json as PubDoc;
  if (!Array.isArray(doc.versions)) {
    throw new RegistryError("malformed", "pub.dev document has no versions list", status);
  }

  const versions: VersionEntry[] = [];
  for (const raw of doc.versions as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as { version?: unknown; retracted?: unknown };
    if (typeof v.version !== "string") continue;
    versions.push({
      version: v.version,
      prerelease: isSemverPrerelease(v.version),
      yanked: v.retracted === true,
    });
  }

  const info: FetchOutcome = { kind: "info", name, versions };
  const latest =
    typeof doc.latest === "object" && doc.latest !== null
      ? (doc.latest as { version?: unknown }).version
      : undefined;
  // pub.dev's `latest` is the newest stable version unless none exists, in which case it is a
  // pre-release and carries no information about stability.
  if (typeof latest === "string" && !isSemverPrerelease(latest)) info.stableHint = latest;
  return info;
}

export const pubAdapter: Adapter = {
  id: "pub",
  concurrency: 6,
  normalizeName,
  fetch: fetchPackage,
  isPrerelease: isSemverPrerelease,
  compare: compareWithBuildTieBreak,
  parseVersionOrRange: () => {
    throw new UnparseableRange("version checks are not implemented yet");
  },
};
