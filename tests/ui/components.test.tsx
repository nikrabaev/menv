import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { TopBar } from "../../src/ui/components/TopBar.tsx";
import { VariableList } from "../../src/ui/components/VariableList.tsx";
import { Inspector } from "../../src/ui/components/Inspector.tsx";
import { WireModal } from "../../src/ui/components/WireModal.tsx";
import { MoreIndicator } from "../../src/ui/components/MoreIndicator.tsx";
import type { Consumer, RepoModel, Variable } from "../../src/core/types.ts";

const v: Variable = { id: "v1", name: "DATABASE_URL", tier: "global", description: "db", group: "DB", secret: true, consumers: ["app:api"] };
const model: RepoModel = {
  root: "/repo/acme", environments: [{ id: "dev", isDefault: true }],
  variables: [v], consumers: [], values: { v1: { dev: "pg://x" } }, recipients: [],
};

test("TopBar shows repo, env, and dirty indicator", () => {
  const { lastFrame } = render(<TopBar root={model.root} env="dev" dirty={true} unsaved={3} />);
  expect(lastFrame()).toContain("acme");
  expect(lastFrame()).toContain("dev");
  expect(lastFrame()).toContain("3");
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
    { kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} },
    { kind: "app", id: "app:inbox", name: "inbox", path: "apps/inbox", envFiles: {} },
  ];
  const wiredVar: Variable = { ...v, consumers: ["app:api", "app:inbox"] };
  const { lastFrame } = render(<VariableList variables={[wiredVar]} cursor={0} consumers={consumers} showScopes />);
  expect(lastFrame()).toContain("app:api");
  expect(lastFrame()).toContain("app:inbox");
});

test("VariableList aligns value/scope columns across rows of differing name length", () => {
  const consumers: Consumer[] = [
    { kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} },
  ];
  const short: Variable = { ...v, id: "s", name: "X", secret: true, consumers: ["app:api"] };
  const long: Variable = { ...v, id: "l", name: "A_MUCH_LONGER_NAME", secret: true, consumers: ["app:api"] };
  const { lastFrame } = render(<VariableList variables={[short, long]} cursor={0} consumers={consumers} showScopes />);
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
  const consumers: Consumer[] = [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} }];
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
  const consumers: Consumer[] = [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} }];
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
    kind: "app" as const, id: `app:c${i}`, name: `c${i}`, path: `apps/c${i}`, envFiles: {},
  }));
  const varWithMany: Variable = { ...v, consumers: consumers.map((c) => c.id) };
  const { lastFrame } = render(<VariableList variables={[varWithMany]} cursor={0} consumers={consumers} showScopes />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("app:c0, app:c1, app:c2");
  expect(frame).not.toContain("app:c3");
  expect(frame).toContain("and 2 more");
});

test("Inspector masks secret values", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} env="dev" />);
  expect(lastFrame()).toContain("DATABASE_URL");
  expect(lastFrame()).not.toContain("pg://x");
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
    kind: "app", id: `app:${i}`, name: `app-${i}`, path: `apps/${i}`, envFiles: {},
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
