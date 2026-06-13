// Mutation flows end-to-end: wiring edits, values, import, groups/globals/
// compose tabs, backup/restore — all through the plan→confirm→apply gate.
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadRegistry } from "../../src/registry/persist.ts";
import { ARROW_DOWN, ARROW_RIGHT, ENTER, ESC, renderApp, tick } from "./helpers.tsx";

const vaultJson = async (root: string): Promise<Record<string, string>> =>
  JSON.parse(await Bun.file(join(root, ".menv/vault.json")).text()) as Record<string, string>;

describe("wiring flows", () => {
  test("wire EMPTY_ONE to web with a fresh key", async () => {
    const rig = await renderApp();
    await rig.type(ARROW_DOWN); // API_URL
    await rig.type(ARROW_DOWN); // EMPTY_ONE
    await rig.type("w");
    expect(rig.frame()).toContain("Wire EMPTY_ONE (vault local)");
    // single candidate "web" prefilled → field enter, mode enter, key enter, submit
    await rig.type(ENTER);
    await rig.type(ENTER);
    await rig.type(ENTER);
    await rig.type(ENTER);
    await tick(50);
    expect(rig.frame()).toContain("plan: wire EMPTY_ONE");
    await rig.type(ENTER); // apply
    await tick(100);
    const registry = await loadRegistry(rig.root);
    const mapping = registry.variables.EMPTY_ONE?.vaultMapping.local;
    expect(mapping?.web?.key).toBeDefined();
    expect(mapping?.web?.key).not.toBe(mapping?.api?.key); // fresh key
    rig.ui.unmount();
  });

  test("unwire API_URL from both consumers deletes orphaned keys", async () => {
    const rig = await renderApp();
    await rig.type(ARROW_DOWN); // API_URL
    await rig.type("u");
    await tick(50);
    expect(rig.frame()).toContain("Unwire API_URL (vault local)");
    await rig.type(ENTER); // consumers field prefilled "api,web"
    await rig.type(ENTER); // submit
    await tick(150); // dependency scan
    const plan = rig.frame();
    expect(plan).toContain("plan: unwire API_URL");
    expect(plan).toContain("remove key");
    await rig.type(ENTER); // apply
    await tick(150);
    const registry = await loadRegistry(rig.root);
    expect(registry.variables.API_URL?.vaultMapping.local).toBeUndefined();
    expect((await vaultJson(rig.root))["k-api"]).toBeUndefined(); // orphan removed
    rig.ui.unmount();
  });

  test("disable toggles through the consumer pick", async () => {
    const rig = await renderApp();
    await rig.type("d"); // DATABASE_URL, wired to api+web (one shared key)
    await tick(25);
    expect(rig.frame()).toContain("which consumer?");
    await rig.type(ENTER); // api
    await tick(25);
    expect(rig.frame()).toContain("plan: disable DATABASE_URL for api");
    await rig.type(ENTER);
    await tick(100);
    const registry = await loadRegistry(rig.root);
    expect(registry.variables.DATABASE_URL?.vaultMapping.local?.api?.disabled).toBe(true);
    rig.ui.unmount();
  });

  test("reveal shows a secret only after an explicit confirm", async () => {
    const rig = await renderApp();
    await rig.type("r"); // DATABASE_URL (secret, shared key → no pick needed)
    await tick(25);
    expect(rig.frame()).toContain("Reveal secret");
    expect(rig.frame()).not.toContain("postgres://user:pw@host/db");
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).toContain("postgres://user:pw@host/db");
    await rig.type(ESC);
    await tick(25);
    expect(rig.frame()).not.toContain("postgres://user:pw@host/db");
    rig.ui.unmount();
  });
});

describe("import", () => {
  test("import defines, wires, and sets values (secret heuristic applied)", async () => {
    const rig = await renderApp();
    await Bun.write(join(rig.root, "old.env"), "FOO=bar\nAPP_TOKEN=shhh\n");
    await rig.type("i");
    expect(rig.frame()).toContain("Import a dotenv file");
    await rig.type("old.env");
    await rig.type(ENTER); // file → consumer select (api first)
    await rig.type(ENTER); // consumer → vault select
    await rig.type(ENTER); // vault → submit row
    await rig.type(ENTER); // submit
    await tick(150);
    expect(rig.frame()).toContain("plan: import old.env → api (vault local)");
    await rig.type(ENTER); // apply
    await tick(150);
    const registry = await loadRegistry(rig.root);
    expect(registry.variables.FOO?.secret).toBeUndefined();
    expect(registry.variables.APP_TOKEN?.secret).toBe(true);
    const values = await vaultJson(rig.root);
    const fooKey = registry.variables.FOO?.vaultMapping.local?.api?.key as string;
    expect(values[fooKey]).toBe("bar");
    rig.ui.unmount();
  });
});

describe("other tabs", () => {
  test("globals tab lists per-vault source and defines a static global", async () => {
    const rig = await renderApp();
    await rig.type("]"); // → globals
    expect(rig.frame()).toContain("HOSTNAME");
    expect(rig.frame()).toContain("runtime");
    await rig.type("n");
    expect(rig.frame()).toContain("Define global (vault local)");
    await rig.type("REGION");
    await rig.type(ENTER); // name → source select (runtime)
    await rig.type(ARROW_RIGHT); // cycle → static
    await rig.type(ENTER); // → value
    await rig.type("eu-west-1");
    await rig.type(ENTER); // → description
    await rig.type(ENTER); // → submit
    await rig.type(ENTER);
    await tick(50);
    expect(rig.frame()).toContain("plan: global define REGION");
    await rig.type(ENTER);
    await tick(100);
    const registry = await loadRegistry(rig.root);
    expect(registry.globals.REGION?.values.local).toEqual({ source: "static", value: "eu-west-1" });
    rig.ui.unmount();
  });

  test("groups tab adds a group through the plan gate", async () => {
    const rig = await renderApp();
    await rig.type("]");
    await rig.type("]"); // → groups
    expect(rig.frame()).toContain("Database");
    await rig.type("n");
    await rig.type("cache");
    await rig.type(ENTER);
    await rig.type("Cache layer");
    await rig.type(ENTER);
    await rig.type(ENTER); // submit
    await tick(50);
    await rig.type(ENTER); // apply plan
    await tick(100);
    expect((await loadRegistry(rig.root)).groups.cache?.title).toBe("Cache layer");
    rig.ui.unmount();
  });

  test("compose tab binds a file and explains hand-authored markers", async () => {
    const rig = await renderApp();
    await Bun.write(join(rig.root, "docker-compose.yml"), "services: {}\n");
    await rig.type("[");
    await rig.type("["); // ← wraps: variables → backups → compose
    expect(rig.frame()).toContain("no compose files bound");
    await rig.type("n");
    await rig.type("docker-compose.yml");
    await rig.type(ENTER);
    await rig.type(ENTER); // submit
    await tick(50);
    await rig.type(ENTER); // apply
    await tick(100);
    expect((await loadRegistry(rig.root)).compose.files).toEqual(["docker-compose.yml"]);
    expect(rig.frame()).toContain("hand-authored");
    rig.ui.unmount();
  });

  test("backup snapshots and restore brings the registry back", async () => {
    const rig2 = await renderApp();
    await rig2.type("[");
    expect(rig2.frame()).toContain("no backups yet");
    await rig2.type("n");
    await tick(150);
    expect(rig2.frame()).toContain("backup 20");
    const backups = await readdir(join(rig2.root, ".menv/backups"));
    expect(backups.length).toBe(1);

    // mutate: define a var, then restore the snapshot → it disappears
    await rig2.type("]"); // back to variables
    await rig2.type("n");
    await rig2.type("TEMP_VAR");
    for (let i = 0; i < 6; i++) await rig2.type(ENTER);
    await tick(50);
    await rig2.type(ENTER); // apply plan
    await tick(150);
    expect((await loadRegistry(rig2.root)).variables.TEMP_VAR).toBeDefined();

    await rig2.type("["); // → backups
    await rig2.type(ENTER); // restore selected snapshot
    expect(rig2.frame()).toContain("Restore backup");
    await rig2.type("y");
    await tick(200);
    expect((await loadRegistry(rig2.root)).variables.TEMP_VAR).toBeUndefined();
    rig2.ui.unmount();
  });
});
