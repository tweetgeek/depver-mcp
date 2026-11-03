import { ECOSYSTEMS } from "./types.js";

export type RegistryErrorKind = "timeout" | "network" | "http" | "malformed" | "rate_limited";

/** The registry could not be asked or did not answer in a usable way. Never cached. */
export class RegistryError extends Error {
  override readonly name = "RegistryError";
  constructor(
    readonly kind: RegistryErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The version/range string is not valid in the ecosystem's syntax. */
export class UnparseableRange extends Error {
  override readonly name = "UnparseableRange";
  constructor(message: string) {
    super(message);
  }
}

/** The package name is syntactically invalid for the ecosystem. */
export class InvalidName extends Error {
  override readonly name = "InvalidName";
  constructor(message: string) {
    super(message);
  }
}

export class UnknownEcosystem extends Error {
  override readonly name = "UnknownEcosystem";
  constructor(raw: string) {
    super(`unknown ecosystem "${raw}"; supported: ${ECOSYSTEMS.join(", ")}`);
  }
}
