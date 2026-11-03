import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  // Inline every dependency so the published package has no runtime dependencies.
  noExternal: [/.*/],
  minify: false,
  sourcemap: false,
  clean: true,
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
