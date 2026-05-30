import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import {
  ENTER_FULLSCREEN,
  EXIT_FULLSCREEN,
  MenvApp,
  enterFullscreen,
  exitFullscreen,
} from "../../src/ui/app.tsx";
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

test("limits rendered rows to the viewport", () => {
  const manyVars: RepoModel = {
    ...model,
    variables: Array.from({ length: 30 }, (_, i) => ({
      id: `v${i}`,
      name: `VAR_${i}`,
      tier: "global",
      description: "",
      group: null,
      secret: false,
      consumers: ["app:api"],
    })),
    values: {},
  };
  const store = createStore(manyVars);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={10} viewportColumns={80} />);

  expect(lastFrame()).toContain("VAR_0");
  expect(lastFrame()).not.toContain("VAR_29");
});

test("fullscreen helpers use alternate screen and restore it", () => {
  let out = "";
  const stdout = {
    isTTY: true,
    write(chunk: string) {
      out += chunk;
      return true;
    },
  } as unknown as NodeJS.WriteStream;

  enterFullscreen(stdout);
  exitFullscreen(stdout);

  expect(out).toBe(ENTER_FULLSCREEN + EXIT_FULLSCREEN);
});

test("fullscreen helpers do nothing for non-interactive output", () => {
  let out = "";
  const stdout = {
    isTTY: false,
    write(chunk: string) {
      out += chunk;
      return true;
    },
  } as unknown as NodeJS.WriteStream;

  enterFullscreen(stdout);
  exitFullscreen(stdout);

  expect(out).toBe("");
});
