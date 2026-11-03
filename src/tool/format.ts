import { RegistryError } from "../core/errors.js";
import type {
  Adapter,
  Ecosystem,
  FetchOutcome,
  PackageQuery,
  PackageResult,
  VersionEntry,
  VersionInfo,
} from "../core/types.js";

export const MAX_MSG_LENGTH = 160;

/** First sentence, whitespace collapsed, hard-capped. Deprecation notices can be essays. */
export function truncateSentence(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const m = /^(.*?[.!?])(?=\s|$)/.exec(collapsed);
  const sentence = m?.[1] ?? collapsed;
  return sentence.length > max ? sentence.slice(0, max).trimEnd() : sentence;
}

function highest(entries: VersionEntry[], adapter: Adapter): VersionEntry | undefined {
  let best: VersionEntry | undefined;
  for (const entry of entries) {
    if (!best || adapter.compare(entry.version, best.version) > 0) best = entry;
  }
  return best;
}

/** Highest non-pre-release, non-yanked version; the registry's hint wins when it qualifies. */
export function pickStable(info: VersionInfo, adapter: Adapter): string | undefined {
  const candidates = info.versions.filter((v) => !v.prerelease && !v.yanked);
  if (info.stableHint !== undefined) {
    const hinted = candidates.find((v) => v.version === info.stableHint);
    if (hinted) return hinted.version;
  }
  return highest(candidates, adapter)?.version;
}

/** Highest non-yanked version overall, pre-releases included. */
export function pickLatest(info: VersionInfo, adapter: Adapter): string | undefined {
  return highest(
    info.versions.filter((v) => !v.yanked),
    adapter,
  )?.version;
}

function errorMessage(err: unknown): string {
  if (err instanceof RegistryError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Drop keys whose value is undefined, null (except v_match) or an empty string (Constitution I). */
function stripEmpty(result: PackageResult): PackageResult {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined || value === "") continue;
    if (value === null && key !== "v_match") continue;
    out[key] = value;
  }
  return out as unknown as PackageResult;
}

/**
 * Turn one item's outcome into its compact result. `ecosystem`, `name` and `adapter` are
 * undefined when the item failed before an adapter could be chosen (unknown ecosystem).
 */
export function formatResult(
  query: PackageQuery,
  ecosystem: Ecosystem | undefined,
  name: string | undefined,
  outcome: FetchOutcome | unknown,
  adapter: Adapter | undefined,
): PackageResult {
  const base: PackageResult = {
    e: ecosystem ?? query.ecosystem,
    n: name ?? query.name,
    s: "error",
  };

  const isOutcome =
    typeof outcome === "object" &&
    outcome !== null &&
    !(outcome instanceof Error) &&
    ((outcome as { kind?: unknown }).kind === "info" ||
      (outcome as { kind?: unknown }).kind === "not_found");
  if (!isOutcome || adapter === undefined) {
    return stripEmpty({
      ...base,
      s: "error",
      msg: truncateSentence(errorMessage(outcome), MAX_MSG_LENGTH),
    });
  }

  const fetched = outcome as FetchOutcome;
  if (fetched.kind === "not_found") {
    return stripEmpty({
      ...base,
      s: "not_found",
      ...(fetched.reason !== undefined
        ? { msg: truncateSentence(fetched.reason, MAX_MSG_LENGTH) }
        : {}),
    });
  }

  const stable = pickStable(fetched, adapter);
  const latest = pickLatest(fetched, adapter);
  const result: PackageResult = { ...base, s: "ok" };
  if (stable !== undefined) result.stable = stable;
  if (latest !== undefined) result.latest = latest;
  if (latest === undefined && fetched.versions.length > 0) result.msg = "all versions yanked";

  if (fetched.deprecated) {
    result.s = "deprecated";
    result.msg = truncateSentence(fetched.deprecated.message, MAX_MSG_LENGTH);
  }

  return stripEmpty(result);
}
