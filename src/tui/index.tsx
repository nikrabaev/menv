// `menv tui` entry. Full-screen Ink app on the alternate screen — scrollback
// stays clean and the terminal is restored on every exit path.

import { render } from "ink";
import { MenvError } from "../core/errors.ts";
import { loadRegistry } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";
import { App } from "./app.tsx";
import type { TuiContext } from "./state/data.ts";

export interface TuiOptions {
  vaultAuth: Record<string, string>;
  env: Record<string, string | undefined>;
}

export async function runTui(root: string, opts: TuiOptions): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new MenvError("VALIDATION", "menv tui needs an interactive terminal (TTY)");
  }
  let registry: Registry | null;
  try {
    registry = await loadRegistry(root);
  } catch (e) {
    if (e instanceof MenvError && e.code === "NOT_FOUND") registry = null; // → init wizard
    else throw e;
  }
  const ctx: TuiContext = { root, env: opts.env, auth: new Map(Object.entries(opts.vaultAuth)) };

  const enterAlt = "\u001B[?1049h";
  const leaveAlt = "\u001B[?1049l";
  process.stdout.write(enterAlt);
  const restore = (): void => {
    process.stdout.write(leaveAlt);
  };
  process.once("exit", restore);
  try {
    const { waitUntilExit } = render(<App ctx={ctx} registry={registry} />, { exitOnCtrlC: true });
    await waitUntilExit();
  } finally {
    process.off("exit", restore);
    restore();
  }
}
