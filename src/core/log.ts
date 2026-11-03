/** Debug logging to stderr only, enabled with DEPVER_MCP_DEBUG=1. stdout belongs to the protocol. */
export function debug(...args: unknown[]): void {
  if (process.env["DEPVER_MCP_DEBUG"] !== "1") return;
  process.stderr.write(
    args
      .map((a) =>
        typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a),
      )
      .join(" ") + "\n",
  );
}
