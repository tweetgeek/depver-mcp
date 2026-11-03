# Client configuration

`depver-mcp` is a stdio MCP server. Any client that can launch a command and talk MCP over its
stdin/stdout can use it. Node.js 20 or newer must be on the `PATH`.

## Claude Code

Project scope, in `.mcp.json` at the repository root (commit it so teammates get it too):

```json
{
  "mcpServers": {
    "depver": {
      "command": "npx",
      "args": ["-y", "depver-mcp"]
    }
  }
}
```

Or from the terminal:

```bash
claude mcp add --transport stdio depver --scope project -- npx -y depver-mcp
# use --scope user to enable it for every project
```

## Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "depver": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "depver-mcp"]
    }
  }
}
```

## Other stdio clients

Command: `npx`, arguments: `-y depver-mcp`. The server writes only protocol messages to stdout;
set `DEPVER_MCP_DEBUG=1` in the environment to get diagnostics on stderr.

## Pinning a version

Replace `depver-mcp` with `depver-mcp@0.1.0` (or any published version) in the arguments to pin.
