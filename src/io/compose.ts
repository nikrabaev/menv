import { parse as parseYaml } from "yaml";

export interface ComposeService {
  name: string;
  composeFile: string;
  envFiles: string[];
  environmentKeys: string[];
}

export function parseComposeServices(text: string, composeFile: string): ComposeService[] {
  const doc = parseYaml(text) as any;
  const services = doc?.services ?? {};
  const out: ComposeService[] = [];
  for (const [name, def] of Object.entries<any>(services)) {
    const envFiles = !def?.env_file
      ? []
      : Array.isArray(def.env_file)
        ? def.env_file
        : [def.env_file];

    let environmentKeys: string[] = [];
    if (Array.isArray(def?.environment)) {
      environmentKeys = def.environment.map((e: string) => String(e).split("=")[0]);
    } else if (def?.environment && typeof def.environment === "object") {
      environmentKeys = Object.keys(def.environment);
    }
    out.push({ name, composeFile, envFiles, environmentKeys });
  }
  return out;
}
