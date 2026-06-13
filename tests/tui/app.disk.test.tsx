// End-to-end TUI behavior against a real tmp repo: navigation, masking, the
// plan→confirm→apply gate, generate, check, and the size floor.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRegistry } from "../../src/registry/persist.ts";
import { ARROW_DOWN, ENTER, ESC, renderApp, tick, tuiRegistry } from "./helpers.tsx";

describe("menv tui (app)", () => {
  test("renders the three panes with grouped variables and wiring glyphs", async () => {
    const rig = await renderApp();
    const frame = rig.frame();
    expect(frame).toContain("[1] scopes");
    expect(frame).toContain("[2] tabs");
    expect(frame).toContain("▐ variables ▌"); // active tab renders as a filled pill
    expect(frame).toContain("[3] inspector");
    expect(frame).toContain("Database"); // group header
    expect(frame).toContain("DATABASE_URL");
    expect(frame).toContain("(ungrouped)");
    rig.ui.unmount();
  });

  test("secrets are masked in the inspector; non-secrets show inline", async () => {
    const rig = await renderApp();
    const frame = rig.frame();
    expect(frame).toContain("***");
    expect(frame).not.toContain("postgres://user:pw@host/db");
    rig.ui.unmount();
  });

  test("filter narrows the list and shows a count", async () => {
    const rig = await renderApp();
    await rig.type("/");
    await rig.type("api");
    await rig.type(ENTER);
    const frame = rig.frame();
    expect(frame).toContain("(1/3)");
    expect(frame).toContain("API_URL");
    expect(frame).not.toContain("DATABASE_URL");
    rig.ui.unmount();
  });

  test("define variable flows through the plan modal and lands in menv.json", async () => {
    const rig = await renderApp();
    await rig.type("n"); // define form
    expect(rig.frame()).toContain("Define variable");
    await rig.type("NEW_FLAG");
    await rig.type(ENTER); // name → next field
    await rig.type(ENTER); // group
    await rig.type(ENTER); // secret toggle
    await rig.type(ENTER); // description
    await rig.type(ENTER); // example
    await rig.type(ENTER); // submit row → plan modal
    expect(rig.frame()).toContain("plan: var define NEW_FLAG");
    expect(rig.frame()).toContain("registry set variables.NEW_FLAG");
    await rig.type(ENTER); // apply
    await tick(100);
    const registry = await loadRegistry(rig.root);
    expect(registry.variables.NEW_FLAG).toBeDefined();
    expect(rig.frame()).toContain("applied");
    rig.ui.unmount();
  });

  test("esc cancels a plan without applying", async () => {
    const rig = await renderApp();
    await rig.type("n");
    await rig.type("DROPPED");
    await rig.type(ENTER);
    await rig.type(ENTER);
    await rig.type(ENTER);
    await rig.type(ENTER);
    await rig.type(ENTER);
    await rig.type(ENTER); // plan modal
    await rig.type(ESC);
    await tick(50);
    const registry = await loadRegistry(rig.root);
    expect(registry.variables.DROPPED).toBeUndefined();
    rig.ui.unmount();
  });

  test("set value writes to the vault through plan confirm (keys, never values, in the plan)", async () => {
    const rig = await renderApp();
    // select API_URL (not secret): rows are DATABASE_URL, API_URL, EMPTY_ONE
    await rig.type(ARROW_DOWN);
    await rig.type("s");
    await tick(50);
    // shared-key? API_URL has two distinct keys (api, web) → consumer pick modal
    expect(rig.frame()).toContain("different values per consumer");
    await rig.type(ENTER); // pick "api"
    await tick(50);
    expect(rig.frame()).toContain("Set API_URL");
    await rig.type("https://new.example.com");
    await rig.type(ENTER); // submit field
    await tick(25);
    await rig.type(ENTER); // submit row
    await tick(50);
    const planFrame = rig.frame();
    expect(planFrame).toContain("set key");
    expect(planFrame).not.toContain("https://new.example.com"); // value never in the plan
    await rig.type(ENTER); // apply
    await tick(150);
    const vault = JSON.parse(await Bun.file(join(rig.root, ".menv/vault.json")).text()) as Record<string, string>;
    expect(vault["k-api"]).toBe("https://new.example.com");
    rig.ui.unmount();
  });

  test("var remove with a dependent reference shows a blocker and force-arms", async () => {
    // API_URL's value references ${DATABASE_URL} → removing DATABASE_URL blocks.
    const rig = await renderApp(tuiRegistry(), {
      "k-db": "postgres://h/db",
      "k-api": "https://x/${DATABASE_URL}",
    });
    await rig.type("x"); // remove DATABASE_URL (first row selected)
    await tick(150); // dependency scan
    const frame = rig.frame();
    expect(frame).toContain("DEPENDENT_REFERENCE");
    expect(frame).toContain("blocked — f to arm force");
    await rig.type(ENTER); // blocked: enter must do nothing
    await tick(50);
    expect((await loadRegistry(rig.root)).variables.DATABASE_URL).toBeDefined();
    await rig.type("f");
    expect(rig.frame()).toContain("force armed");
    await rig.type(ENTER);
    await tick(150);
    expect((await loadRegistry(rig.root)).variables.DATABASE_URL).toBeUndefined();
    rig.ui.unmount();
  });

  test("generate previews then writes the .env outputs", async () => {
    const rig = await renderApp();
    await rig.type("g");
    await tick(150); // preview compute
    const preview = rig.frame();
    expect(preview).toContain("generate");
    expect(preview).toContain("would write");
    expect(preview).toContain("apps/api/.env");
    await rig.type(ENTER); // apply
    await tick(200);
    const env = await Bun.file(join(rig.root, "apps/api/.env")).text();
    expect(env).toContain("managed by menv");
    expect(env).toContain("API_URL=");
    expect(env.split("\n")[0]).toContain("DO NOT EDIT");
    rig.ui.unmount();
  });

  test("check overlay lists findings (missing value warning from EMPTY_ONE)", async () => {
    const rig = await renderApp();
    await rig.type("c");
    await tick(300);
    const frame = rig.frame();
    expect(frame).toContain("check —");
    expect(frame).toContain("MISSING_VALUE");
    await rig.type(ESC);
    expect(rig.frame()).not.toContain("MISSING_VALUE");
    rig.ui.unmount();
  });

  test("sidebar: enter switches the active vault; consumer enter filters", async () => {
    const rig = await renderApp();
    await rig.type("1"); // focus sidebar (selection starts on vault "local")
    await rig.type("j"); // → production
    await rig.type(ENTER);
    expect(rig.frame()).toContain("vault: production");
    await rig.type("j"); // → consumer api (skips CONSUMERS header)
    await rig.type(ENTER);
    expect(rig.frame()).toContain("consumer: api");
    rig.ui.unmount();
  });

  test("help overlay comes from the keymap", async () => {
    const rig = await renderApp();
    await rig.type("?");
    const frame = rig.frame();
    expect(frame).toContain("help — every key, by context");
    expect(frame).toContain("make active");
    await rig.type(ESC);
    rig.ui.unmount();
  });

  test("quit modal on q", async () => {
    const rig = await renderApp();
    await rig.type("q");
    expect(rig.frame()).toContain("Quit menv?");
    await rig.type("n");
    expect(rig.frame()).toContain("[2] tabs");
    rig.ui.unmount();
  });

  test("tab cycles focus across the three panes", async () => {
    const rig = await renderApp();
    expect(rig.frame()).toContain("[2] tabs"); // main focused initially
    await rig.type("\t");
    // inspector now focused — its actions hint appears in the footer
    expect(rig.frame()).toContain("wiring rows");
    rig.ui.unmount();
  });
});
