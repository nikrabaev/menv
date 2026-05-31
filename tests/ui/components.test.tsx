import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { TopBar } from "../../src/ui/components/TopBar.tsx";
import { VariableList } from "../../src/ui/components/VariableList.tsx";
import { Inspector } from "../../src/ui/components/Inspector.tsx";
import { WireModal } from "../../src/ui/components/WireModal.tsx";
import { MoreIndicator } from "../../src/ui/components/MoreIndicator.tsx";
import { ScopeTree } from "../../src/ui/components/ScopeTree.tsx";
import type { Consumer, RepoModel, Variable } from "../../src/core/types.ts";
import type { Scope } from "../../src/ui/scopes.ts";

const v: Variable = { id: "v1", name: "DATABASE_URL", tier: "global", description: "db", group: "DB", secret: true, consumers: ["app:api"] };
const model: RepoModel = {
  root: "/repo/acme", environments: [{ id: "dev", isDefault: true }],
  variables: [v], consumers: [], values: { v1: { dev: "pg://x" } }, recipients: [],
};

test("TopBar shows repo, every environment, and the dirty indicator", () => {
  const { lastFrame } = render(<TopBar root={model.root} env="dev" environments={["dev", "prod", "staging"]} dirty={true} unsaved={3} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("acme");
  // Every environment is listed, not just the current one.
  expect(frame).toContain("dev");
  expect(frame).toContain("prod");
  expect(frame).toContain("staging");
  expect(frame).toContain("3");
});

test("VariableList renders the name and masks a secret's value", () => {
  const { lastFrame } = render(<VariableList variables={[v]} cursor={0} model={model} env="dev" />);
  expect(lastFrame()).toContain("DATABASE_URL");
  expect(lastFrame()).toContain("***");
  expect(lastFrame()).not.toContain("pg://x");
});

test("VariableList shows a plain value and masks a secret in the value column", () => {
  const secret: Variable = { ...v, id: "s", name: "TOKEN", secret: true, consumers: [] };
  const plain: Variable = { ...v, id: "p", name: "PORT", secret: false, consumers: [] };
  const m: RepoModel = { ...model, variables: [secret, plain], values: { s: { dev: "supersecret" }, p: { dev: "3000" } } };
  const { lastFrame } = render(<VariableList variables={[secret, plain]} cursor={0} model={m} env="dev" />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("3000"); // plain value shown
  expect(frame).toContain("***"); // secret masked
  expect(frame).not.toContain("supersecret"); // real secret value never rendered
});

test("VariableList truncates a value too long for the line", async () => {
  const longVal = "x".repeat(200);
  const plain: Variable = { ...v, id: "p", name: "URL", secret: false, consumers: [] };
  const m: RepoModel = { ...model, variables: [plain], values: { p: { dev: longVal } } };
  const { lastFrame } = render(<VariableList variables={[plain]} cursor={0} height={10} model={m} env="dev" />);
  await new Promise((r) => setTimeout(r, 20));
  const frame = lastFrame() ?? "";
  expect(frame).not.toContain(longVal); // never rendered in full
  expect(frame).toContain("…"); // cut with an ellipsis
});

test("VariableList groups variables under headers, ungrouped first", () => {
  const a: Variable = { ...v, id: "a", name: "ALPHA", secret: false, group: null, consumers: [] };
  const b: Variable = { ...v, id: "b", name: "BETA", secret: false, group: "Storage", consumers: [] };
  const m: RepoModel = { ...model, variables: [b, a], values: { a: { dev: "x" }, b: { dev: "y" } } };
  const { lastFrame } = render(<VariableList variables={[b, a]} cursor={0} grouped model={m} env="dev" />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("Ungrouped");
  expect(frame).toContain("Storage");
  // Ungrouped bucket (ALPHA) renders before the Storage group (BETA).
  expect(frame.indexOf("Ungrouped")).toBeLessThan(frame.indexOf("ALPHA"));
  expect(frame.indexOf("ALPHA")).toBeLessThan(frame.indexOf("Storage"));
  expect(frame.indexOf("Storage")).toBeLessThan(frame.indexOf("BETA"));
});

test("VariableList encloses group header names in brackets", () => {
  const a: Variable = { ...v, id: "a", name: "ALPHA", secret: false, group: null, consumers: [] };
  const b: Variable = { ...v, id: "b", name: "BETA", secret: false, group: "Storage", consumers: [] };
  const m: RepoModel = { ...model, variables: [b, a], values: {} };
  const { lastFrame } = render(<VariableList variables={[b, a]} cursor={0} grouped model={m} env="dev" />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("[Ungrouped]");
  expect(frame).toContain("[Storage]");
});

test("ScopeTree renders scope labels", () => {
  const scopes: Scope[] = [
    { id: "all", label: "All", kind: "all" },
    { id: "group:DB", label: "DB", kind: "group" },
    { id: "app:api", label: "api", kind: "app" },
  ];
  const { lastFrame } = render(<ScopeTree scopes={scopes} cursor={0} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("DB");
  expect(frame).toContain("api");
});

test("VariableList stays flat with no headers when not grouped", () => {
  const a: Variable = { ...v, id: "a", name: "ALPHA", secret: false, group: null, consumers: [] };
  const b: Variable = { ...v, id: "b", name: "BETA", secret: false, group: "Storage", consumers: [] };
  const m: RepoModel = { ...model, variables: [b, a], values: {} };
  const { lastFrame } = render(<VariableList variables={[b, a]} cursor={0} model={m} env="dev" />);
  expect(lastFrame()).not.toContain("Ungrouped");
});

test("VariableList shows 'empty' for a variable with no value in the current env", () => {
  const plain: Variable = { ...v, id: "p", name: "PORT", secret: false, consumers: [] };
  const m: RepoModel = { ...model, variables: [plain], values: {} };
  const { lastFrame } = render(<VariableList variables={[plain]} cursor={0} model={m} env="dev" />);
  expect(lastFrame()).toContain("empty");
});

test("VariableList shows 'empty' for a secret with no value, not the mask", () => {
  const secret: Variable = { ...v, id: "s", name: "TOKEN", secret: true, consumers: [] };
  const m: RepoModel = { ...model, variables: [secret], values: {} };
  const { lastFrame } = render(<VariableList variables={[secret]} cursor={0} model={m} env="dev" />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("empty");
  expect(frame).not.toContain("***"); // no value to mask
});

test("VariableList header announces the active filter query", () => {
  const { lastFrame } = render(<VariableList variables={[v]} cursor={0} filter="data" />);
  expect(lastFrame()).toContain("filter: data");
});

test("VariableList header omits filter when none is applied", () => {
  const { lastFrame } = render(<VariableList variables={[v]} cursor={0} />);
  expect(lastFrame()).not.toContain("filter:");
});

test("VariableList shows scope wiring in All mode", () => {
  const consumers: Consumer[] = [
    { kind: "app", id: "app:api", name: "api", path: "apps/api" },
    { kind: "app", id: "app:inbox", name: "inbox", path: "apps/inbox" },
  ];
  const wiredVar: Variable = { ...v, consumers: ["app:api", "app:inbox"] };
  const { lastFrame } = render(<VariableList variables={[wiredVar]} cursor={0} consumers={consumers} showScopes />);
  expect(lastFrame()).toContain("app:api");
  expect(lastFrame()).toContain("app:inbox");
});

test("VariableList aligns value/scope columns across rows of differing name length", () => {
  const consumers: Consumer[] = [
    { kind: "app", id: "app:api", name: "api", path: "apps/api" },
  ];
  const short: Variable = { ...v, id: "s", name: "X", secret: true, consumers: ["app:api"] };
  const long: Variable = { ...v, id: "l", name: "A_MUCH_LONGER_NAME", secret: true, consumers: ["app:api"] };
  const m: RepoModel = { ...model, variables: [short, long], values: { s: { dev: "a" }, l: { dev: "b" } } };
  const { lastFrame } = render(<VariableList variables={[short, long]} cursor={0} consumers={consumers} showScopes model={m} env="dev" />);
  const lines = (lastFrame() ?? "").split("\n").filter((l) => l.includes("***"));
  expect(lines.length).toBe(2);
  // The masked value starts at the same column on both rows...
  const valueCols = lines.map((l) => l.indexOf("***"));
  expect(valueCols[0]).toBe(valueCols[1]);
  // ...and so does the scopes column.
  const scopeCols = lines.map((l) => l.indexOf("app:api"));
  expect(scopeCols[0]).toBe(scopeCols[1]);
});

test("VariableList pads rows to the full pane width so the highlight spans the row", async () => {
  const consumers: Consumer[] = [{ kind: "app", id: "app:api", name: "api", path: "apps/api" }];
  const short: Variable = { ...v, id: "s", name: "X", secret: true, consumers: ["app:api"] };
  const long: Variable = { ...v, id: "l", name: "A_MUCH_LONGER_NAME", secret: false, consumers: ["app:api"] };
  const { lastFrame } = render(<VariableList variables={[short, long]} cursor={0} height={10} consumers={consumers} showScopes />);
  // Width is measured after layout, so let the effect-driven re-render flush.
  await new Promise((r) => setTimeout(r, 20));
  const rows = (lastFrame() ?? "").split("\n").filter((l) => l.includes("app:api"));
  expect(rows.length).toBe(2);
  // Both rows fill the full pane: rendered width is identical regardless of content...
  expect(rows[0]!.length).toBe(rows[1]!.length);
  // ...and the short-name row carries trailing fill before the right border.
  expect(rows.find((l) => l.includes(" X "))).toMatch(/ {2,}│$/);
});

test("VariableList labels global variables in the scopes column", () => {
  const consumers: Consumer[] = [{ kind: "app", id: "app:api", name: "api", path: "apps/api" }];
  const globalVar: Variable = { ...v, id: "g", name: "NODE_ENV", tier: "global", secret: false, consumers: [] };
  const localVar: Variable = { ...v, id: "l", name: "IMAP_HOST", tier: "local", ownerApp: "app:api", secret: false, consumers: ["app:api"] };
  const { lastFrame } = render(<VariableList variables={[globalVar, localVar]} cursor={0} consumers={consumers} showScopes />);
  const lines = (lastFrame() ?? "").split("\n");
  // The global variable's scopes cell starts with "global"; the local one does not.
  expect(lines.find((l) => l.includes("NODE_ENV"))).toContain("global");
  expect(lines.find((l) => l.includes("IMAP_HOST"))).not.toContain("global");
});

test("VariableList truncates wiring hint beyond 3 consumers", () => {
  const consumers: Consumer[] = Array.from({ length: 5 }, (_, i) => ({
    kind: "app" as const, id: `app:c${i}`, name: `c${i}`, path: `apps/c${i}`,
  }));
  const varWithMany: Variable = { ...v, consumers: consumers.map((c) => c.id) };
  const { lastFrame } = render(<VariableList variables={[varWithMany]} cursor={0} consumers={consumers} showScopes />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("app:c0, app:c1, app:c2");
  expect(frame).not.toContain("app:c3");
  expect(frame).toContain("and 2 more");
});

test("Inspector lists fields and masks a secret value", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} env="dev" />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("DATABASE_URL");
  expect(frame).toContain("Description");
  expect(frame).toContain("Secret");
  expect(frame).not.toContain("pg://x"); // value column masked
});

test("Inspector shows 'empty' for an unset value field", () => {
  const plain: Variable = { ...v, secret: false };
  const m: RepoModel = { ...model, values: {} };
  const { lastFrame } = render(<Inspector model={m} variable={plain} env="dev" height={14} />);
  expect(lastFrame()).toContain("empty");
});

test("Inspector shows 'empty' for a secret value field with no value, not the mask", () => {
  const secret: Variable = { ...v, secret: true };
  const m: RepoModel = { ...model, values: {} };
  const { lastFrame } = render(<Inspector model={m} variable={secret} env="dev" height={14} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("empty");
  expect(frame).not.toContain("***"); // no value to mask
});

test("Inspector marks the selected field with a caret when focused", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} env="dev" active cursor={0} height={14} />);
  expect(lastFrame()).toContain("▸");
});

test("Inspector shows no caret when unfocused", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} env="dev" cursor={0} height={14} />);
  expect(lastFrame()).not.toContain("▸");
});

test("Inspector shows only the current environment's value", () => {
  const multi: RepoModel = {
    ...model,
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    values: { v1: { dev: "DEVVAL", prod: "PRODVAL" } },
  };
  const plain: Variable = { ...v, secret: false };
  const { lastFrame } = render(<Inspector model={multi} variable={plain} env="prod" height={14} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("PRODVAL"); // the selected env's value
  expect(frame).not.toContain("DEVVAL"); // other environments are not shown
});

test("MoreIndicator shows the hidden count with a direction arrow", () => {
  expect(render(<MoreIndicator direction="up" count={8} />).lastFrame()).toContain("↑ 8 more");
  expect(render(<MoreIndicator direction="down" count={7} />).lastFrame()).toContain("↓ 7 more");
});

test("MoreIndicator renders nothing when nothing is hidden", () => {
  expect(render(<MoreIndicator direction="up" count={0} />).lastFrame()).toBe("");
});

test("WireModal windows its list to fit height without overflowing", () => {
  const consumers: Consumer[] = Array.from({ length: 20 }, (_, i) => ({
    kind: "app", id: `app:${i}`, name: `app-${i}`, path: `apps/${i}`,
  }));
  // height 8 → border(2) + header(1) leaves 4 content rows. Cursor is at the top,
  // so there's no top marker: 4 item rows + the bottom marker.
  const { lastFrame } = render(
    <WireModal varName="DATABASE_URL" consumers={consumers} wired={[]} onToggle={() => {}} onClose={() => {}} height={8} />,
  );
  const frame = lastFrame() ?? "";
  // The whole box stays within its allotted height — header is never overwritten.
  expect(frame.split("\n").length).toBeLessThanOrEqual(8);
  expect(frame).toContain("Wire");
  expect(frame).toContain("DATABASE_URL");
  // Tail items are hidden behind an overflow marker that counts them (4 shown, 16 below).
  expect(frame).toContain("↓ 16 more");
  expect(frame).not.toContain("app-19");
});
