// Human mode end-to-end: H toggles the card layout (no inspector), ENTER drops
// into the consumer/value table, and editing a row's value re-keys a shared
// consumer onto a private key through the normal plan→apply gate.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRegistry } from "../../src/registry/persist.ts";
import { makeRegistry } from "../helpers/fixtures.ts";
import { ARROW_DOWN, ENTER, renderApp, tick } from "./helpers.tsx";

const vaultJson = async (root: string): Promise<Record<string, string>> =>
  JSON.parse(await Bun.file(join(root, ".menv/vault.json")).text()) as Record<string, string>;

describe("human mode", () => {
  test("H shows the card table and hides the inspector", async () => {
    const rig = await renderApp();
    // baseline: the inspector's wiring matrix is on screen
    expect(rig.frame()).toContain("WIRING");
    await rig.type("H");
    const f = rig.frame();
    // DATABASE_URL's table lists its consumers; the secret value is masked
    expect(f).toContain("api");
    expect(f).toContain("web");
    expect(f).toContain("***");
    // the inspector pane is gone in human mode
    expect(f).not.toContain("WIRING");
    rig.ui.unmount();
  });

  test("ENTER focuses the table, ENTER on a row opens the value editor", async () => {
    const rig = await renderApp();
    await rig.type("H");
    await rig.type(ENTER); // focus DATABASE_URL's table
    expect(rig.frame()).toContain("edit value"); // the row-focus footer hint
    await rig.type(ENTER); // open the editor on the first row (api)
    expect(rig.frame()).toContain("Edit DATABASE_URL · api");
    rig.ui.unmount();
  });

  test("setting a unique value re-keys a shared consumer onto a private key", async () => {
    const rig = await renderApp();
    const before = await loadRegistry(rig.root);
    expect(before.variables.DATABASE_URL?.vaultMapping.local?.api?.key).toBe("k-db");
    expect(before.variables.DATABASE_URL?.vaultMapping.local?.web?.key).toBe("k-db"); // shared

    await rig.type("H");
    await rig.type(ENTER); // table focus
    await rig.type(ENTER); // editor for api
    expect(rig.frame()).toContain("Edit DATABASE_URL · api");
    await rig.type("brand-new-secret"); // type a fresh value
    await rig.type(ENTER); // value → toggle row
    await rig.type(ENTER); // toggle → submit row
    await rig.type(ENTER); // submit → plan
    await tick(60);
    expect(rig.frame()).toContain("plan: edit DATABASE_URL · api");
    await rig.type(ENTER); // apply
    await tick(120);

    const after = await loadRegistry(rig.root);
    const mapping = after.variables.DATABASE_URL?.vaultMapping.local;
    expect(mapping?.web?.key).toBe("k-db"); // sharer untouched
    expect(mapping?.api?.key).not.toBe("k-db"); // api isolated onto a new key
    const values = await vaultJson(rig.root);
    expect(values["k-db"]).toBe("postgres://user:pw@host/db"); // old shared value intact
    expect(values[mapping?.api?.key as string]).toBe("brand-new-secret");
    rig.ui.unmount();
  });

  test("adopting another consumer's key shares storage and drops the now-orphaned key", async () => {
    const registry = makeRegistry();
    registry.variables = {
      SHARED_ONE: {
        // api and web each hold their own solo key with a distinct value
        vaultMapping: { local: { api: { key: "kA" }, web: { key: "kB" } } },
      },
    };
    const rig = await renderApp(registry, { kA: "value-A", kB: "value-B" });
    await rig.type("H");
    await rig.type(ENTER); // focus SHARED_ONE's table (rows: api[value-A], web[value-B])
    await rig.type(ENTER); // editor for the first row (api)
    expect(rig.frame()).toContain("Edit SHARED_ONE · api");
    await rig.type(ARROW_DOWN); // move to the adopt-key option (web's key)
    await rig.type(ENTER); // adopt it → cursor jumps to apply
    await rig.type(ENTER); // submit → orphan prompt (api's kA is now unused)
    await tick(40);
    expect(rig.frame()).toContain("Drop now-unused vault key");
    await rig.type("y"); // drop kA
    await tick(40);
    expect(rig.frame()).toContain("plan: edit SHARED_ONE · api");
    await rig.type(ENTER); // apply
    await tick(120);
    const after = await loadRegistry(rig.root);
    const mapping = after.variables.SHARED_ONE?.vaultMapping.local;
    expect(mapping?.api?.key).toBe("kB"); // api now shares web's key
    expect(mapping?.web?.key).toBe("kB");
    const values = await vaultJson(rig.root);
    expect(values.kA).toBeUndefined(); // orphan removed
    expect(values.kB).toBe("value-B"); // shared value
    rig.ui.unmount();
  });

  test("the selection bar spans every line of the selected card, not just the header", async () => {
    const rig = await renderApp();
    await rig.type("H");
    const lines = rig.frame().split("\n");
    // DATABASE_URL is selected by default and has two consumer rows (api, web).
    const headerIdx = lines.findIndex((l) => l.includes("DATABASE_URL"));
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    // the header AND each consumer row below it carry the leading ┃ rail
    expect(lines[headerIdx]).toContain("┃");
    expect(lines[headerIdx + 1]).toContain("┃");
    expect(lines[headerIdx + 2]).toContain("┃");
    rig.ui.unmount();
  });

  test("a long description renders truncated (ellipsis) at rest", async () => {
    const registry = makeRegistry();
    registry.variables = {
      LONG_ONE: {
        description: "this description is far too long to ever fit on a single header line of the card",
        vaultMapping: { local: { api: { key: "k-long" } } },
      },
    };
    const rig = await renderApp(registry, { "k-long": "v" });
    await rig.type("H");
    await tick(25);
    // the at-rest marquee shows the head with an ellipsis (it has not scrolled yet)
    expect(rig.frame()).toContain("this description is");
    expect(rig.frame()).toContain("…");
    rig.ui.unmount();
  });
});
