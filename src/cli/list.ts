import { valueOf } from "../core/model.ts";
import { loadModel, defaultEnv, resolveConsumer } from "./context.ts";
import type { KeyBackend } from "../crypto/identity.ts";
import type { Variable } from "../core/types.ts";

// Mirrors the TUI: secret values are masked, an absent value reads "empty".
const SECRET_MASK = "***";
const EMPTY_LABEL = "empty";

export interface ListOpts {
  backend?: KeyBackend;
  scope?: string; // filter to variables wired to this consumer
  group?: string; // filter to this group ("" = ungrouped)
  env?: string;
  json?: boolean;
}

// List variables (optionally filtered), returning text ready to print. Human mode
// is an aligned NAME / VALUE / WIRING table; --json emits the full records.
export async function runList(root: string, opts: ListOpts = {}): Promise<string> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const env = defaultEnv(model, opts.env);

  let vars = model.variables;
  if (opts.scope !== undefined) {
    const cid = resolveConsumer(model, opts.scope);
    vars = vars.filter((v) => v.consumers.includes(cid));
  }
  if (opts.group !== undefined) {
    vars = vars.filter((v) => (v.group ?? "") === opts.group);
  }
  vars = [...vars].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  if (opts.json) {
    return JSON.stringify(
      vars.map((v) => ({
        id: v.id,
        name: v.name,
        secret: v.secret,
        group: v.group,
        description: v.description,
        example: v.example ?? null,
        consumers: v.consumers,
        value: valueOf(model, v.id, env),
      })),
      null,
      2,
    );
  }

  if (vars.length === 0) return "";
  const shownValue = (v: Variable) => {
    const raw = valueOf(model, v.id, env);
    return raw === "" ? EMPTY_LABEL : v.secret ? SECRET_MASK : raw;
  };
  const nameW = Math.max(4, ...vars.map((v) => v.name.length));
  const valW = Math.max(5, ...vars.map((v) => shownValue(v).length));
  const row = (a: string, b: string, c: string) => `${a.padEnd(nameW)}  ${b.padEnd(valW)}  ${c}`;
  const lines = [row("NAME", "VALUE", `WIRING (${env})`)];
  for (const v of vars) {
    lines.push(row(v.name, shownValue(v), v.consumers.length ? v.consumers.join(", ") : "(unwired)"));
  }
  return lines.join("\n");
}
