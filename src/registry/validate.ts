import type { Registry } from "./types.ts";

export interface ValidationIssue {
  path: string;
  message: string;
}

// Env-var-legal names for variables and globals; lower-case slugs for the
// names users invent (vaults, consumers, groups).
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Structural + referential validation of a parsed menv.json. Returns every
// issue found (not just the first); `registry` is non-null iff issues is empty.
export function validateRegistry(input: unknown): {
  registry: Registry | null;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => {
    issues.push({ path, message });
  };

  if (!isRecord(input)) {
    return { registry: null, issues: [{ path: "$", message: "registry must be a JSON object" }] };
  }

  if (input.schemaVersion !== 2) issue("schemaVersion", "must be the number 2");

  const section = (key: string, required: boolean): Record<string, unknown> => {
    const v = input[key];
    if (v === undefined) {
      if (required) issue(key, "section is required");
      return {};
    }
    if (!isRecord(v)) {
      issue(key, "must be an object");
      return {};
    }
    return v;
  };

  const vaults = section("vaults", true);
  const consumers = section("consumers", true);
  const groups = section("groups", false);
  const globals = section("globals", false);
  const variables = section("variables", false);

  const vaultNames = new Set(Object.keys(vaults));
  const consumerNames = new Set(Object.keys(consumers));
  const groupKeys = new Set(Object.keys(groups));

  // defaults
  const defaults = input.defaults;
  if (!isRecord(defaults) || typeof defaults.vault !== "string") {
    issue("defaults.vault", "must name a vault");
  } else if (!vaultNames.has(defaults.vault)) {
    issue("defaults.vault", `unknown vault "${defaults.vault}"`);
  }

  // vaults
  for (const [name, def] of Object.entries(vaults)) {
    if (!SLUG_RE.test(name)) issue(`vaults.${name}`, "invalid vault name (use a-z 0-9 . _ -)");
    if (!isRecord(def)) {
      issue(`vaults.${name}`, "must be an object");
      continue;
    }
    if (typeof def.vaultType !== "string" || def.vaultType === "") {
      issue(`vaults.${name}.vaultType`, "must be a non-empty string");
    }
    if (def.vaultConfig === undefined) issue(`vaults.${name}.vaultConfig`, "is required");
  }

  // consumers
  for (const [name, def] of Object.entries(consumers)) {
    if (!SLUG_RE.test(name)) issue(`consumers.${name}`, "invalid consumer name (use a-z 0-9 . _ -)");
    if (!isRecord(def)) {
      issue(`consumers.${name}`, "must be an object");
      continue;
    }
    const cfg = isRecord(def.strategyConfig) ? def.strategyConfig : null;
    if (cfg === null) issue(`consumers.${name}.strategyConfig`, "must be an object");
    if (cfg && typeof cfg.baseDir !== "string") issue(`consumers.${name}.strategyConfig.baseDir`, "must be a string");
    if (def.strategyType === "single") {
      if (cfg && typeof cfg.filename !== "string") {
        issue(`consumers.${name}.strategyConfig.filename`, "must be a string");
      }
    } else if (def.strategyType === "per-vault") {
      const filenames = cfg && isRecord(cfg.filenames) ? cfg.filenames : null;
      if (filenames === null) {
        issue(`consumers.${name}.strategyConfig.filenames`, "must be an object of vault → filename");
      } else {
        for (const [vault, file] of Object.entries(filenames)) {
          if (!vaultNames.has(vault)) {
            issue(`consumers.${name}.strategyConfig.filenames.${vault}`, `unknown vault "${vault}"`);
          }
          if (typeof file !== "string") {
            issue(`consumers.${name}.strategyConfig.filenames.${vault}`, "filename must be a string");
          }
        }
      }
    } else {
      issue(`consumers.${name}.strategyType`, `must be "single" or "per-vault"`);
    }
  }

  // groups
  for (const [key, def] of Object.entries(groups)) {
    if (!SLUG_RE.test(key)) issue(`groups.${key}`, "invalid group key (use a-z 0-9 . _ -)");
    if (!isRecord(def) || typeof def.title !== "string") issue(`groups.${key}.title`, "must be a string");
  }

  // globals
  for (const [name, def] of Object.entries(globals)) {
    if (!NAME_RE.test(name)) issue(`globals.${name}`, "invalid global name (env-var style)");
    if (!isRecord(def) || !isRecord(def.values)) {
      issue(`globals.${name}.values`, "must be an object of vault → value definition");
      continue;
    }
    for (const [vault, val] of Object.entries(def.values)) {
      if (!vaultNames.has(vault)) {
        issue(`globals.${name}.values.${vault}`, `unknown vault "${vault}"`);
        continue;
      }
      if (!isRecord(val) || (val.source !== "runtime" && val.source !== "static")) {
        issue(`globals.${name}.values.${vault}.source`, `must be "runtime" or "static"`);
        continue;
      }
      if (val.source === "static" && typeof val.value !== "string") {
        issue(`globals.${name}.values.${vault}.value`, "static globals need a string value");
      }
    }
  }

  // variables
  for (const [name, def] of Object.entries(variables)) {
    if (!NAME_RE.test(name)) issue(`variables.${name}`, "invalid variable name (env-var style)");
    if (!isRecord(def)) {
      issue(`variables.${name}`, "must be an object");
      continue;
    }
    if (def.groupKey !== undefined && !groupKeys.has(def.groupKey as string)) {
      issue(`variables.${name}.groupKey`, `unknown group "${String(def.groupKey)}"`);
    }
    const mapping = isRecord(def.vaultMapping) ? def.vaultMapping : null;
    if (mapping === null) {
      issue(`variables.${name}.vaultMapping`, "must be an object (may be empty)");
      continue;
    }
    for (const [vault, byConsumer] of Object.entries(mapping)) {
      if (!vaultNames.has(vault)) {
        issue(`variables.${name}.vaultMapping.${vault}`, `unknown vault "${vault}"`);
        continue;
      }
      if (!isRecord(byConsumer)) {
        issue(`variables.${name}.vaultMapping.${vault}`, "must be an object of consumer → entry");
        continue;
      }
      for (const [consumer, entry] of Object.entries(byConsumer)) {
        if (!consumerNames.has(consumer)) {
          issue(`variables.${name}.vaultMapping.${vault}.${consumer}`, `unknown consumer "${consumer}"`);
        }
        if (!isRecord(entry) || typeof entry.key !== "string" || entry.key === "") {
          issue(`variables.${name}.vaultMapping.${vault}.${consumer}.key`, "must be a non-empty string");
        }
      }
    }
  }

  // compose
  let composeFiles: string[] = [];
  const compose = input.compose;
  if (compose !== undefined) {
    if (!isRecord(compose) || !Array.isArray(compose.files) || compose.files.some((f) => typeof f !== "string")) {
      issue("compose.files", "must be an array of file paths");
    } else {
      composeFiles = compose.files as string[];
    }
  }

  if (issues.length > 0) return { registry: null, issues };

  return {
    registry: {
      schemaVersion: 2,
      defaults: { vault: (input.defaults as { vault: string }).vault },
      vaults: vaults as Registry["vaults"],
      consumers: consumers as Registry["consumers"],
      groups: groups as Registry["groups"],
      globals: globals as Registry["globals"],
      variables: variables as Registry["variables"],
      compose: { files: composeFiles },
    },
    issues: [],
  };
}
