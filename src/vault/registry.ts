import { MenvError } from "../core/errors.ts";
import type { VaultProvider } from "./provider.ts";
import { localProvider } from "./providers/local.ts";

// Adding a provider = one import + one entry here. Nothing else changes
// (spec: "Modular vaults"). Roadmap providers (hashicorp, aws-ssm, npm-loaded
// plugins) slot into this same map.
const PROVIDERS: ReadonlyMap<string, VaultProvider> = new Map([[localProvider.type, localProvider]]);

export function knownProviderTypes(): string[] {
  return [...PROVIDERS.keys()].sort();
}

export function getProvider(type: string): VaultProvider {
  const p = PROVIDERS.get(type);
  if (p === undefined) {
    throw new MenvError(
      "VALIDATION",
      `unknown vaultType "${type}" (known: ${knownProviderTypes().join(", ")})`,
    );
  }
  return p;
}
