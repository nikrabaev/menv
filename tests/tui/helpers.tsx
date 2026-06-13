// Shared TUI test rig: a real tmp repo (registry + plaintext vault values) and
// an App rendered through ink-testing-library with a fake 120×40 terminal.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { saveRegistry } from "../../src/registry/persist.ts";
import type { Registry } from "../../src/registry/types.ts";
import { App } from "../../src/tui/app.tsx";
import type { TuiContext } from "../../src/tui/state/data.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

export const ARROW_UP = "\u001B[A";
export const ARROW_DOWN = "\u001B[B";
export const ARROW_LEFT = "\u001B[D";
export const ARROW_RIGHT = "\u001B[C";
export const ENTER = "\r";
export const ESC = "\u001B";
export const TAB = "\t";

export function tick(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ink-testing-library's stdout stub hardcodes a 100-column getter on its
// prototype; the app's wide (three-pane) layout starts at 110. Patch the
// prototype once so tests control the terminal size (default 130×40).
const testSize = { columns: 130, rows: 40 };
export function setTestSize(columns: number, rows: number): void {
  testSize.columns = columns;
  testSize.rows = rows;
}
let stdoutPatched = false;
function patchStdoutSize(stdout: NodeJS.WriteStream): void {
  if (stdoutPatched) return;
  stdoutPatched = true;
  const proto = Object.getPrototypeOf(stdout) as object;
  Object.defineProperty(proto, "columns", { configurable: true, get: () => testSize.columns });
  Object.defineProperty(proto, "rows", { configurable: true, get: () => testSize.rows });
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await tick(20);
  }
}

// A registry with wired variables and a vault holding some values.
export function tuiRegistry(): Registry {
  const registry = makeRegistry({
    groups: { db: { title: "Database" } },
  });
  registry.variables = {
    DATABASE_URL: {
      groupKey: "db",
      secret: true,
      description: "postgres DSN",
      vaultMapping: {
        local: { api: { key: "k-db" }, web: { key: "k-db" } }, // shared key
      },
    },
    API_URL: {
      vaultMapping: {
        local: { api: { key: "k-api" }, web: { key: "k-api-web", disabled: true } },
      },
    },
    EMPTY_ONE: {
      vaultMapping: { local: { api: { key: "k-empty" } } },
    },
  };
  registry.globals = {
    HOSTNAME: { description: "platform host", values: { local: { source: "runtime" } } },
  };
  return registry;
}

export interface Rig {
  root: string;
  ctx: TuiContext;
  ui: ReturnType<typeof render>;
  frame: () => string;
  type: (s: string) => Promise<void>;
}

export async function renderApp(
  registry: Registry = tuiRegistry(),
  values?: Record<string, string>,
  opts: { root?: string } = {},
): Promise<Rig> {
  let root: string;
  if (opts.root !== undefined) {
    root = opts.root;
    await mkdir(root, { recursive: true });
    await saveRegistry(root, registry);
  } else {
    root = await tmpRepo(registry);
  }
  await Bun.write(
    join(root, ".menv/vault.json"),
    JSON.stringify(values ?? { "k-db": "postgres://user:pw@host/db", "k-api": "https://api.example.com" }),
  );
  const ctx: TuiContext = { root, env: {}, auth: new Map() };
  const probe = render(<App ctx={ctx} registry={registry} />);
  patchStdoutSize(probe.stdout as unknown as NodeJS.WriteStream);
  probe.unmount(); // the probe rendered at the unpatched 100 cols; re-render
  const ui = render(<App ctx={ctx} registry={registry} />);
  // Startup is done once the active vault's runtime landed in the header (the
  // lock-state Badge uppercases its label: "… UNLOCKED" / "… LOCKED").
  if (testSize.columns >= 80 && testSize.rows >= 20) {
    await waitFor(() => {
      const f = ui.lastFrame() ?? "";
      return f.includes("UNLOCKED") || f.includes("LOCKED");
    }, "startup load");
  } else {
    await tick(50);
  }
  return {
    root,
    ctx,
    ui,
    frame: () => ui.lastFrame() ?? "",
    type: async (s: string) => {
      ui.stdin.write(s);
      await tick();
    },
  };
}