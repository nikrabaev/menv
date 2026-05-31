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
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
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
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
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
  await tick(); // let the controlled value re-render before Enter
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
  await tick(); // let the controlled value re-render before Enter
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
  await tick(); // let the controlled value re-render before Enter
  stdin.write("\r");
  await tick();
  expect(store.getModel().values.v1!.dev).toBe("pg://xY");
});

test("filter mode narrows the variable list as the query is typed", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "v1", name: "DATABASE_URL", tier: "global", description: "", group: null, secret: false, consumers: [] },
      { id: "v2", name: "API_TOKEN", tier: "global", description: "", group: null, secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  stdin.write("/"); // enter filter mode
  await tick();
  for (const ch of "token") { stdin.write(ch); await tick(); } // case-insensitive substring
  const frame = lastFrame() ?? "";
  expect(frame).toContain("API_TOKEN");
  expect(frame).not.toContain("DATABASE_URL");
});

test("backspace in filter mode widens the match again", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "v1", name: "DATABASE_URL", tier: "global", description: "", group: null, secret: false, consumers: [] },
      { id: "v2", name: "API_TOKEN", tier: "global", description: "", group: null, secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  stdin.write("/");
  await tick();
  for (const ch of "tokenZ") { stdin.write(ch); await tick(); } // matches nothing
  expect(lastFrame() ?? "").not.toContain("API_TOKEN");
  stdin.write("\x7F"); // backspace removes the stray Z
  await tick();
  expect(lastFrame() ?? "").toContain("API_TOKEN");
});

test("the variable list is sorted by name regardless of model order", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "z", name: "ZEBRA", tier: "global", description: "", group: null, secret: false, consumers: [] },
      { id: "a", name: "ALPHA", tier: "global", description: "", group: null, secret: false, consumers: [] },
      { id: "m", name: "MANGO", tier: "global", description: "", group: null, secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  const frame = lastFrame() ?? "";
  expect(frame.indexOf("ALPHA")).toBeLessThan(frame.indexOf("MANGO"));
  expect(frame.indexOf("MANGO")).toBeLessThan(frame.indexOf("ZEBRA"));
});

test("the variable list shows group headers when at least one group exists", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "g", name: "GA", tier: "global", description: "", group: "Infra", secret: false, consumers: [] },
      { id: "u", name: "UA", tier: "global", description: "", group: null, secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  const frame = lastFrame() ?? "";
  expect(frame).toContain("Ungrouped");
  expect(frame).toContain("Infra");
});

test("ctrl+down jumps the cursor to the next group's first variable", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "g", name: "GA", tier: "global", description: "infra-desc", group: "Infra", secret: false, consumers: [] },
      { id: "u", name: "UA", tier: "global", description: "ungrouped-desc", group: null, secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  // Ungrouped sorts first, so UA is the initial selection (shown in the inspector).
  expect(lastFrame()).toContain("ungrouped-desc");
  stdin.write("\x1b[1;5B"); // ctrl+down
  await tick();
  expect(lastFrame()).toContain("infra-desc");
  stdin.write("\x1b[1;5A"); // ctrl+up, back to the Ungrouped bucket
  await tick();
  expect(lastFrame()).toContain("ungrouped-desc");
});

test("editing a variable's group offers existing groups and applies a new one", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "v1", name: "HAS_GROUP", tier: "global", description: "", group: "DB", secret: false, consumers: [] },
      { id: "v2", name: "NO_GROUP", tier: "global", description: "", group: null, secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  // Ungrouped sorts first, so NO_GROUP is selected. Focus the inspector and move to
  // the group field (description -> example -> group), then open the picker.
  stdin.write("\t");
  await tick();
  stdin.write("\x1b[B"); await tick(); // example
  stdin.write("\x1b[B"); await tick(); // group
  stdin.write("\r"); await tick();
  expect(lastFrame()).toContain("DB"); // the existing group is proposed
  for (const ch of "Cache") { stdin.write(ch); await tick(); }
  stdin.write("\r"); await tick();
  expect(store.getModel().variables.find((v) => v.id === "v2")!.group).toBe("Cache");
});

test("a group scope drops the redundant group header from the list", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "a", name: "ALPHA", tier: "global", description: "", group: "PAYMENTS", secret: false, consumers: [] },
      { id: "b", name: "BETA", tier: "global", description: "", group: "PAYMENTS", secret: false, consumers: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={18} viewportColumns={110} />);
  await tick();
  // Focus the scopes pane (vars -> inspector -> scopes) and select the PAYMENTS
  // group scope (All -> Global -> Root -> [GROUPS] -> PAYMENTS).
  stdin.write("\t"); await tick();
  stdin.write("\t"); await tick();
  stdin.write("\x1b[B"); await tick();
  stdin.write("\x1b[B"); await tick();
  stdin.write("\x1b[B"); await tick();
  const frame = lastFrame() ?? "";
  expect(frame).toContain("ALPHA");
  expect(frame).toContain("BETA");
  // "PAYMENTS" still appears in the scope tree, the list title, and the inspector
  // group field — but NOT as an in-list header (that would be a 4th occurrence).
  expect(frame.split("PAYMENTS").length - 1).toBe(3);
});

test("the footer stays within the layout budget on a narrow terminal", async () => {
  // The footer hint bar is wide; if it wrapped it would exceed bottomHeight (1) and
  // overlap the panes. wrap="truncate-end" must keep the whole frame at <= rows lines.
  const store = createStore(editModel);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={70} />);
  await tick();
  expect((lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(20);
});
