import { join } from "node:path";
import type { ConsumerDef } from "../registry/types.ts";

// Every path a consumer's config implies. `local` companions exist only with
// secretsAsLocalOverrides; `example` only with strategyConfig.example.
export interface ConsumerPaths {
  main: string[];
  local: string[];
  example?: string;
}

export function consumerPaths(def: ConsumerDef): ConsumerPaths {
  const files =
    def.strategyType === "single" ? [def.strategyConfig.filename] : Object.values(def.strategyConfig.filenames);
  const base = def.strategyConfig.baseDir;
  const main = files.map((f) => join(base, f));
  const local = def.strategyConfig.secretsAsLocalOverrides === true ? main.map((p) => `${p}.local`) : [];
  return {
    main,
    local,
    ...(def.strategyConfig.example === true ? { example: join(base, ".env.example") } : {}),
  };
}

// The vault each generated env file draws values from.
export interface EnvTarget {
  consumer: string;
  vault: string;
  relPath: string;
  secretsSplit: boolean;
}

export function envTargets(
  consumers: Record<string, ConsumerDef>,
  defaults: { vault: string },
  opts: { vault?: string; consumer?: string },
): EnvTarget[] {
  const out: EnvTarget[] = [];
  for (const [name, def] of Object.entries(consumers)) {
    if (opts.consumer !== undefined && name !== opts.consumer) continue;
    const base = def.strategyConfig.baseDir;
    const split = def.strategyConfig.secretsAsLocalOverrides === true;
    if (def.strategyType === "single") {
      out.push({
        consumer: name,
        vault: opts.vault ?? defaults.vault,
        relPath: join(base, def.strategyConfig.filename),
        secretsSplit: split,
      });
    } else {
      for (const [vault, file] of Object.entries(def.strategyConfig.filenames)) {
        if (opts.vault !== undefined && vault !== opts.vault) continue;
        out.push({ consumer: name, vault, relPath: join(base, file), secretsSplit: split });
      }
    }
  }
  return out;
}
