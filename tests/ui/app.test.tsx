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
  expect(lastFrame()).toContain("All");
  expect(lastFrame()).toContain("Root");
  expect(lastFrame()).toContain("APPS");
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

const editModel: RepoModel = {
  root: "/repo/acme",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", tier: "global", description: "db", group: null, secret: false, consumers: ["app:api"], example: "ex" },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } }],
  values: { v1: { dev: "pg://x" } },
  recipients: [],
};

const tick = () => new Promise((r) => setTimeout(r, 20));

test("tab focuses the inspector and switches the footer to field hints", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick(); // wait for useInput effect to register
  stdin.write("\t"); // vars -> inspector
  await tick();
  expect(lastFrame()).toContain("▸");   // selected-field caret
  expect(lastFrame()).toContain("esc"); // inspector footer hint
});

test("enter in the variable list edits the current environment value", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick(); // wait for useInput effect to register
  stdin.write("\r"); // vars pane is default
  await tick();
  expect(lastFrame()).toContain("value · dev");
  stdin.write("Z");
  stdin.write("\r");
  await tick();
  expect(store.getModel().values.v1!.dev).toBe("pg://xZ");
});

test("editing the description in the inspector persists via the store", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick(); // wait for useInput effect to register
  stdin.write("\t"); // inspector, cursor 0 = description
  await tick();
  stdin.write("\r"); // open modal
  await tick();
  expect(lastFrame()).toContain("description");
  stdin.write("X");
  stdin.write("\r");
  await tick();
  expect(store.getModel().variables[0]!.description).toBe("dbX");
});

test("c copies the selected inspector field via the injected copy fn", async () => {
  const store = createStore(editModel);
  let copied = "";
  const { lastFrame, stdin } = render(
    <MenvApp store={store} onSaveStamp={() => "s"} copy={async (t) => { copied = t; return true; }} viewportRows={20} viewportColumns={100} />,
  );
  await tick(); // wait for useInput effect to register
  stdin.write("\t"); // inspector, cursor 0 = description ("db")
  await tick();
  stdin.write("c");
  await tick();
  expect(copied).toBe("db");
  expect(lastFrame()).toContain("copied DATABASE_URL");
});

test("c in the variable list copies the current environment value", async () => {
  const store = createStore(editModel);
  let copied = "";
  const { lastFrame, stdin } = render(
    <MenvApp store={store} onSaveStamp={() => "s"} copy={async (t) => { copied = t; return true; }} viewportRows={20} viewportColumns={100} />,
  );
  await tick(); // wait for useInput effect to register
  stdin.write("c"); // vars pane (default), env=dev, value "pg://x"
  await tick();
  expect(copied).toBe("pg://x");
  expect(lastFrame()).toContain("copied DATABASE_URL (dev)");
});

test("c reports when the clipboard tool is unavailable", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(
    <MenvApp store={store} onSaveStamp={() => "s"} copy={async () => false} viewportRows={20} viewportColumns={100} />,
  );
  await tick(); // wait for useInput effect to register
  stdin.write("c"); // vars pane: copy current env value
  await tick();
  expect(lastFrame()).toContain("clipboard unavailable");
});

test("enter on the secret field toggles secret", async () => {
  const store = createStore(editModel);
  const { stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick(); // wait for useInput effect to register
  stdin.write("\t"); // inspector cursor 0
  await tick();
  stdin.write("\x1b[B"); stdin.write("\x1b[B"); stdin.write("\x1b[B"); // -> 3 secret
  await tick();
  stdin.write("\r");
  await tick();
  expect(store.getModel().variables[0]!.secret).toBe(true);
});

test("enter on the wiring field opens the wire modal", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick(); // wait for useInput effect to register
  stdin.write("\t");
  await tick();
  for (let i = 0; i < 4; i++) stdin.write("\x1b[B"); // -> 4 wiring
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("Wire");
});

test("enter on a value row edits that environment's value", async () => {
  const store = createStore(editModel);
  const { stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick(); // wait for useInput effect to register
  stdin.write("\t");
  await tick();
  for (let i = 0; i < 5; i++) stdin.write("\x1b[B"); // -> 5 value:dev
  await tick();
  stdin.write("\r");
  await tick();
  stdin.write("Y");
  stdin.write("\r");
  await tick();
  expect(store.getModel().values.v1!.dev).toBe("pg://xY");
});

test("the footer stays within the layout budget on a narrow terminal", async () => {
  // The footer hint bar is wide; if it wrapped it would exceed bottomHeight (1) and
  // overlap the panes. wrap="truncate-end" must keep the whole frame at <= rows lines.
  const store = createStore(editModel);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={70} />);
  await tick();
  expect((lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(20);
});
