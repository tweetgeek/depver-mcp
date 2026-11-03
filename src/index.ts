import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { HELP_TEXT, parseCliArgs } from "./cli.js";
import { debug } from "./core/log.js";
import { createServer, defaultDeps, SERVER_INFO } from "./server.js";

const action = parseCliArgs(process.argv.slice(2));

if (action === "help") {
  process.stderr.write(HELP_TEXT);
  process.exit(0);
}
if (action === "version") {
  process.stderr.write(`${SERVER_INFO.name} ${SERVER_INFO.version}\n`);
  process.exit(0);
}

// One cache and one limiter per process; every connection served by the factory shares them.
const deps = defaultDeps();

serveStdio(() => createServer(deps), {
  onerror: (error) => debug("server error:", error),
});

debug(`${SERVER_INFO.name} ${SERVER_INFO.version} listening on stdio`);
