// Dev-only, network-using check for SC-002: for a reference set of well-known packages, compare
// what the built server reports with what each registry says directly. Never run by `npm test`.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const REFERENCE = {
  npm: [
    "react",
    "vue",
    "lodash",
    "express",
    "typescript",
    "next",
    "axios",
    "zod",
    "vite",
    "eslint",
    "prettier",
    "jest",
    "vitest",
    "tailwindcss",
    "@types/node",
    "react-dom",
    "svelte",
    "webpack",
    "dayjs",
    "commander",
  ],
  pypi: [
    "requests",
    "numpy",
    "pandas",
    "flask",
    "django",
    "fastapi",
    "pydantic",
    "httpx",
    "pytest",
    "black",
    "ruff",
    "sqlalchemy",
    "boto3",
    "pillow",
    "typing-extensions",
    "rich",
    "click",
    "jinja2",
    "pyyaml",
    "uvicorn",
  ],
  pub: [
    "http",
    "provider",
    "flutter_bloc",
    "dio",
    "go_router",
    "riverpod",
    "intl",
    "path",
    "shared_preferences",
    "url_launcher",
    "equatable",
    "collection",
    "get_it",
    "json_annotation",
    "freezed_annotation",
    "uuid",
    "logger",
    "meta",
    "yaml",
    "args",
  ],
  packagist: [
    "monolog/monolog",
    "laravel/framework",
    "symfony/console",
    "guzzlehttp/guzzle",
    "phpunit/phpunit",
    "doctrine/orm",
    "psr/log",
    "nesbot/carbon",
    "vlucas/phpdotenv",
    "symfony/http-foundation",
    "ramsey/uuid",
    "league/flysystem",
    "twig/twig",
    "nikic/php-parser",
    "phpstan/phpstan",
    "friendsofphp/php-cs-fixer",
    "composer/semver",
    "symfony/yaml",
    "spatie/laravel-permission",
    "laravel/sanctum",
  ],
};

const UA = "depver-mcp-reference-check (+https://github.com/tweetgeek/depver-mcp)";

async function fromRegistry(ecosystem, name) {
  const get = async (url, accept) => {
    const r = await fetch(url, { headers: { "user-agent": UA, ...(accept ? { accept } : {}) } });
    return r.json();
  };
  if (ecosystem === "npm") {
    const d = await get(
      `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
      "application/vnd.npm.install-v1+json",
    );
    return d["dist-tags"]?.latest;
  }
  if (ecosystem === "pypi") {
    const d = await get(`https://pypi.org/pypi/${name}/json`);
    return d.info?.version;
  }
  if (ecosystem === "pub") {
    const d = await get(`https://pub.dev/api/packages/${name}`);
    return d.latest?.version;
  }
  const d = await get(`https://repo.packagist.org/p2/${name}.json`);
  const entries = d.packages?.[name] ?? [];
  // p2 is newest-first; first stable tag is the registry's view of "stable"
  return entries.map((e) => e.version).find((v) => !/-(dev|alpha|beta|rc|a|b)\d*/i.test(v));
}

function startServer() {
  const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  let id = 0;
  const call = (method, params) =>
    new Promise((resolve) => {
      const myId = ++id;
      pending.set(myId, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  return { call, notify, close: () => child.stdin.end() };
}

const server = startServer();
await server.call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "reference-check", version: "0" },
});
server.notify("notifications/initialized");

const packages = Object.entries(REFERENCE).flatMap(([ecosystem, names]) =>
  names.map((name) => ({ ecosystem, name })),
);
const started = performance.now();
const response = await server.call("tools/call", {
  name: "check_packages",
  arguments: { packages },
});
const elapsed = Math.round(performance.now() - started);
server.close();
const { results } = JSON.parse(response.result.content[0].text);

let mismatches = 0;
const rows = [];
for (let i = 0; i < packages.length; i++) {
  const { ecosystem, name } = packages[i];
  const ours = results[i];
  const registry = await fromRegistry(ecosystem, name);
  const ok = ours.s !== "error" && ours.stable === registry;
  if (!ok) mismatches++;
  rows.push(
    `| ${ecosystem} | ${name} | ${ours.s} | ${ours.stable ?? ""} | ${registry ?? ""} | ${ok ? "yes" : "NO"} |`,
  );
}
console.log(`| ecosystem | package | status | depver stable | registry | match |`);
console.log(`|---|---|---|---|---|---|`);
console.log(rows.join("\n"));
console.log(
  `\n${packages.length} packages, ${mismatches} mismatches, batch answered in ${elapsed} ms`,
);
process.exit(mismatches === 0 ? 0 : 1);
