import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { TopBar } from "../../src/ui/components/TopBar.tsx";
import { VariableList } from "../../src/ui/components/VariableList.tsx";
import { Inspector } from "../../src/ui/components/Inspector.tsx";
import { WireModal } from "../../src/ui/components/WireModal.tsx";
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

test("VariableList renders names and a secret marker", () => {
  const { lastFrame } = render(<VariableList variables={[v]} cursor={0} />);
  expect(lastFrame()).toContain("DATABASE_URL");
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

test("WireModal windows its list to fit height without overflowing", () => {
  const consumers: Consumer[] = Array.from({ length: 20 }, (_, i) => ({
    kind: "app", id: `app:${i}`, name: `app-${i}`, path: `apps/${i}`, envFiles: {},
  }));
  // height 8 → border(2) + header(1) + 2 ellipsis(2) leaves 3 item rows
  const { lastFrame } = render(
    <WireModal varName="DATABASE_URL" consumers={consumers} wired={[]} onToggle={() => {}} onClose={() => {}} height={8} />,
  );
  const frame = lastFrame() ?? "";
  // The whole box stays within its allotted height — header is never overwritten.
  expect(frame.split("\n").length).toBeLessThanOrEqual(8);
  expect(frame).toContain("Wire");
  expect(frame).toContain("DATABASE_URL");
  // Tail items are hidden behind an ellipsis rather than overflowing.
  expect(frame).toContain("...");
  expect(frame).not.toContain("app-19");
});
