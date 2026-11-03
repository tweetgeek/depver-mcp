import { InvalidName, RegistryError } from "../core/errors.js";
import type { Adapter, FetchJson, FetchOutcome, VersionEntry } from "../core/types.js";
import {
  comparePep440,
  isPep440Prerelease,
  parsePep440,
  parsePep440Check,
} from "../versions/pep440.js";

const SIMPLE = "https://pypi.org/simple";
/** PEP 691 JSON form of the Simple API: versions (PEP 700), per-file yanked, project status (PEP 792). */
const ACCEPT = "application/vnd.pypi.simple.v1+json";

// PEP 508 project name: alphanumerics, with ., -, _ allowed only between them.
const NAME_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

interface SimpleDoc {
  name?: unknown;
  versions?: unknown;
  files?: unknown;
  "project-status"?: unknown;
}

/** PEP 503 normalization: runs of `-`, `_`, `.` become `-`, lowercase. */
function normalizeName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name))
    throw new InvalidName(`"${raw.trim()}" is not a valid PyPI project name`);
  return name.replace(/[-_.]+/g, "-");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Files in the Simple API do not carry a version field; the version is recovered from the file
 * name: `<name>-<version>.tar.gz`, `<name>-<version>.zip`, `<name>-<version>-<tags>.whl`.
 * The name part may use `-`, `_` or `.` interchangeably and any case.
 */
function fileVersion(filename: string, name: string): string | undefined {
  const namePattern = name.split("-").map(escapeRegex).join("[-_.]+");
  const m = new RegExp(
    `^${namePattern}-([^-]+?)(?:-.*\\.whl|\\.tar\\.gz|\\.zip|\\.tar\\.bz2|\\.egg)$`,
    "i",
  ).exec(filename);
  return m?.[1];
}

function isYankedFlag(v: unknown): boolean {
  return v === true || (typeof v === "string" && v.length > 0);
}

async function fetchPackage(name: string, http: FetchJson): Promise<FetchOutcome> {
  const { status, json } = await http(`${SIMPLE}/${name}/`, { accept: ACCEPT });

  if (status === 404) return { kind: "not_found", name };
  if (status !== 200) throw new RegistryError("malformed", `PyPI answered HTTP ${status}`, status);
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new RegistryError("malformed", "PyPI returned an unexpected document", status);
  }
  const doc = json as SimpleDoc;

  const projectStatus =
    typeof doc["project-status"] === "object" && doc["project-status"] !== null
      ? (doc["project-status"] as { status?: unknown }).status
      : undefined;
  if (projectStatus === "quarantined")
    return { kind: "not_found", name, reason: "quarantined by PyPI" };

  if (!Array.isArray(doc.versions)) {
    throw new RegistryError("malformed", "PyPI document has no versions list", status);
  }

  // Yanked is per file; a release is yanked when it has files and every file is yanked.
  const filesByVersion = new Map<string, { total: number; yanked: number }>();
  if (Array.isArray(doc.files)) {
    for (const raw of doc.files as unknown[]) {
      if (typeof raw !== "object" || raw === null) continue;
      const f = raw as { filename?: unknown; yanked?: unknown };
      if (typeof f.filename !== "string") continue;
      const version = fileVersion(f.filename, name);
      if (!version) continue;
      const tally = filesByVersion.get(version) ?? { total: 0, yanked: 0 };
      tally.total++;
      if (isYankedFlag(f.yanked)) tally.yanked++;
      filesByVersion.set(version, tally);
    }
  }

  const versions: VersionEntry[] = [];
  for (const raw of doc.versions as unknown[]) {
    if (typeof raw !== "string") continue;
    const parsed = parsePep440(raw);
    if (!parsed) continue; // legacy, non-PEP 440 versions cannot be ordered or matched
    const tally = filesByVersion.get(raw);
    versions.push({
      version: raw,
      prerelease: isPep440Prerelease(parsed),
      yanked: tally !== undefined && tally.total > 0 && tally.yanked === tally.total,
    });
  }

  const info: FetchOutcome = { kind: "info", name, versions };
  if (projectStatus === "deprecated")
    info.deprecated = { message: "project marked deprecated on PyPI" };
  return info;
}

export const pypiAdapter: Adapter = {
  id: "pypi",
  concurrency: 6,
  normalizeName,
  fetch: fetchPackage,
  isPrerelease: (v) => isPep440Prerelease(v),
  compare: (a, b) => comparePep440(a, b),
  parseVersionOrRange: (input) => parsePep440Check(input),
};
