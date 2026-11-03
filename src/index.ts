import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { debug } from "./core/log.js";
import { createServer, defaultDeps, SERVER_INFO } from "./server.js";

// One cache and one limiter per process; every connection served by the factory shares them.
const deps = defaultDeps();

serveStdio(() => createServer(deps), {
  onerror: (error) => debug("server error:", error),
});

debug(`${SERVER_INFO.name} ${SERVER_INFO.version} listening on stdio`);
