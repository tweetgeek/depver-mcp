import * as z from "zod";

export const MAX_BATCH = 100;

const Item = z
  .object({
    ecosystem: z.string().trim(),
    name: z.string().trim().min(1),
    version: z.string().trim().optional(),
  })
  .strict();

export const CheckPackagesInput = z
  .object({
    packages: z.array(Item).superRefine((items, ctx) => {
      if (items.length < 1 || items.length > MAX_BATCH) {
        ctx.addIssue({
          code: "custom",
          message: `packages must contain between 1 and ${MAX_BATCH} items (got ${items.length})`,
        });
      }
    }),
  })
  .strict();

export type CheckPackagesInput = z.infer<typeof CheckPackagesInput>;

function pathString(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc ? `${acc}.${String(seg)}` : String(seg);
  }, "");
}

/** One English sentence describing the first validation problem (contracts/check_packages.md). */
export function formatEnvelopeError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid input";
  const path = pathString(issue.path);
  const last = issue.path[issue.path.length - 1];

  if (issue.code === "custom") return issue.message;
  if (issue.code === "unrecognized_keys")
    return `${path || "input"} has unknown keys: ${issue.keys.join(", ")}`;
  if (path === "packages") return `packages must be an array of 1 to ${MAX_BATCH} items`;
  if (last === "name") return `${path} must be a non-empty string`;
  if (last === "ecosystem" || last === "version") return `${path} must be a string`;
  return `${path || "input"}: ${issue.message}`;
}
