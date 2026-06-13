// Uninitialized repo → the init wizard; plus the terminal size floor.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { App } from "../../src/tui/app.tsx";
import type { TuiContext } from "../../src/tui/state/data.ts";
import { tmpRepo } from "../helpers/fixtures.ts";
import { ENTER, renderApp, setTestSize, tick } from "./helpers.tsx";

describe("init wizard", () => {
  test("no menv.json → wizard; enter creates an encrypted-vault registry", async () => {
    const root = await tmpRepo(); // no registry
    const ctx: TuiContext = { root, env: {}, auth: new Map() };
    const ui = render(<App ctx={ctx} registry={null} />);
    await tick(25);
    expect(ui.lastFrame()).toContain("no menv.json found");
    expect(ui.lastFrame()).toContain("encrypted vault");
    ui.stdin.write(ENTER);
    await tick(150);
    const registry = JSON.parse(await Bun.file(join(root, "menv.json")).text()) as {
      vaults: Record<string, { vaultConfig: { encryption: boolean } }>;
    };
    expect(registry.vaults.local?.vaultConfig.encryption).toBe(true);
    expect(ui.lastFrame()).toContain("[2] variables"); // main app took over
    const gitignore = await Bun.file(join(root, ".gitignore")).text();
    expect(gitignore).toContain(".menv/auth.local.json");
    ui.unmount();
  });

  test("v1 repo (menv.toml) is refused with the migration message", async () => {
    const root = await tmpRepo();
    await Bun.write(join(root, "menv.toml"), "[v1]\n");
    const ctx: TuiContext = { root, env: {}, auth: new Map() };
    const ui = render(<App ctx={ctx} registry={null} />);
    await tick(25);
    ui.stdin.write(ENTER);
    await tick(100);
    expect(ui.lastFrame()).toContain("v1 repo detected");
    ui.unmount();
  });
});

describe("size floor", () => {
  test("below 80×20 renders the too-small notice instead of panes", async () => {
    setTestSize(70, 18);
    try {
      const rig = await renderApp();
      expect(rig.frame()).toContain("terminal too small");
      expect(rig.frame()).not.toContain("[1] scopes");
      rig.ui.unmount();
    } finally {
      setTestSize(130, 40);
    }
  });
});
