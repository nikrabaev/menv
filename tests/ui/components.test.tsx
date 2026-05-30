import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { TopBar } from "../../src/ui/components/TopBar.tsx";
import { VariableList } from "../../src/ui/components/VariableList.tsx";
import { Inspector } from "../../src/ui/components/Inspector.tsx";
import type { RepoModel, Variable } from "../../src/core/types.ts";

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

test("Inspector masks secret values", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} env="dev" />);
  expect(lastFrame()).toContain("DATABASE_URL");
  expect(lastFrame()).not.toContain("pg://x");
});
