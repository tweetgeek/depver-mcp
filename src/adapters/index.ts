import { UnknownEcosystem } from "../core/errors.js";
import { ECOSYSTEMS, type Adapter, type Ecosystem } from "../core/types.js";

/** Package-manager and language names agents commonly use, mapped to the canonical ecosystem. */
const ALIASES: Record<string, Ecosystem> = {
  npm: "npm",
  pnpm: "npm",
  yarn: "npm",
  node: "npm",
  pypi: "pypi",
  pip: "pypi",
  python: "pypi",
  uv: "pypi",
  poetry: "pypi",
  pub: "pub",
  dart: "pub",
  flutter: "pub",
  "pub.dev": "pub",
  packagist: "packagist",
  composer: "packagist",
  php: "packagist",
};

export function resolveEcosystem(raw: string): Ecosystem {
  const key = raw.trim().toLowerCase();
  const resolved = ALIASES[key];
  if (!resolved) throw new UnknownEcosystem(raw.trim());
  return resolved;
}

/** Filled in by registerAdapter() as adapters are implemented (one file per ecosystem). */
const ADAPTERS = new Map<Ecosystem, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  ADAPTERS.set(adapter.id, adapter);
}

export function getAdapter(ecosystem: Ecosystem): Adapter {
  const adapter = ADAPTERS.get(ecosystem);
  if (!adapter) throw new Error(`no adapter registered for ${ecosystem}`);
  return adapter;
}

export function listEcosystems(): readonly Ecosystem[] {
  return ECOSYSTEMS;
}
