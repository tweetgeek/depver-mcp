/** Command-line flags for people who run `npx depver-mcp` by hand instead of from an MCP client. */
export type CliAction = "serve" | "help" | "version";

export const HELP_TEXT = `depver-mcp: local MCP server that checks package versions on npm, PyPI, pub.dev and Packagist.

This program speaks the Model Context Protocol over stdin/stdout and is meant to be started by an
MCP client, not used directly. Add it to your client configuration, for example .mcp.json:

  { "mcpServers": { "depver": { "command": "npx", "args": ["-y", "depver-mcp"] } } }

or, with Claude Code:

  claude mcp add --transport stdio depver --scope project -- npx -y depver-mcp

Options:
  --help, -h       Show this message and exit
  --version, -v    Print the version and exit

Environment:
  DEPVER_MCP_DEBUG=1   Print diagnostics to stderr (stdout is reserved for the protocol)

Docs: https://github.com/tweetgeek/depver-mcp
`;

export function parseCliArgs(argv: readonly string[]): CliAction {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-v")) return "version";
  return "serve";
}
