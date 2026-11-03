// Guards for the published artifact: single file, shebang, size, cold start (SC-007).
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const FILE = "dist/index.js";
const MAX_BYTES = 1.5 * 1024 * 1024;
const MAX_STARTUP_MS = 1000;

const failures = [];
let size = 0;
try {
  size = statSync(FILE).size;
} catch {
  failures.push(`${FILE} does not exist; run npm run build first`);
}
if (size > MAX_BYTES) failures.push(`${FILE} is ${size} bytes, over the ${MAX_BYTES} byte limit`);
if (size > 0 && !readFileSync(FILE, "utf8").startsWith("#!/usr/bin/env node")) {
  failures.push(`${FILE} does not start with a shebang`);
}

if (size > 0) {
  const started = performance.now();
  const run = spawnSync(process.execPath, [FILE, "--version"], { encoding: "utf8" });
  const elapsed = performance.now() - started;
  if (run.status !== 0) failures.push(`--version exited with ${run.status}: ${run.stderr}`);
  if (run.stdout.length > 0) failures.push(`--version wrote to stdout: ${run.stdout}`);
  if (elapsed > MAX_STARTUP_MS)
    failures.push(`startup took ${Math.round(elapsed)} ms (> ${MAX_STARTUP_MS})`);
  else console.error(`startup ${Math.round(elapsed)} ms, bundle ${(size / 1024).toFixed(0)} KB`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`check-bundle: ${f}`);
  process.exit(1);
}
