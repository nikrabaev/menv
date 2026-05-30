import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { MenvApp } from "../../src/ui/app.tsx";
import { createStore } from "../../src/store/store.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/repo/acme",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", tier: "global", description: "", group: "DB", secret: true, consumers: ["app:api"] },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } }],
  values: { v1: { dev: "pg://x" } },
  recipients: [],
};

test("renders three panes with data", () => {
  const store = createStore(model);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} />);
  expect(lastFrame()).toContain("SCOPES");
  expect(lastFrame()).toContain("VARIABLES");
  expect(lastFrame()).toContain("DATABASE_URL");
  expect(lastFrame()).toContain("acme");
});
