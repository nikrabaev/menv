import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { RepoModel } from "../../src/core/types.ts";
import { createStore } from "../../src/store/store.ts";
import {
  ENTER_FULLSCREEN,
  EXIT_FULLSCREEN,
  enterFullscreen,
  exitFullscreen,
  MenvApp,
} from "../../src/ui/app.tsx";

const model: RepoModel = {
  root: "/repo/acme",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: "DB", secret: true, wiring: [{ consumer: "app:api" }] },
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
  expect(lastFrame()).toContain("TARGETS");
  expect(lastFrame()).toContain("api");
});

test("limits rendered rows to the viewport", () => {
  const manyVars: RepoModel = {
    ...model,
    variables: Array.from({ length: 30 }, (_, i) => ({
      id: `v${i}`,
      name: `VAR_${i}`,
      description: "",
      group: null,
      secret: false,
      wiring: [{ consumer: "app:api" }],
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
    { id: "v1", name: "DATABASE_URL", description: "db", group: null, secret: false, wiring: [{ consumer: "app:api" }], example: "ex" },
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
  expect(lastFrame()).toContain("Value · dev");
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
  expect(lastFrame()).toContain("Description"); // edit-modal title
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
      { id: "v1", name: "DATABASE_URL", description: "", group: null, secret: false, wiring: [] },
      { id: "v2", name: "API_TOKEN", description: "", group: null, secret: false, wiring: [] },
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
      { id: "v1", name: "DATABASE_URL", description: "", group: null, secret: false, wiring: [] },
      { id: "v2", name: "API_TOKEN", description: "", group: null, secret: false, wiring: [] },
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
      { id: "z", name: "ZEBRA", description: "", group: null, secret: false, wiring: [] },
      { id: "a", name: "ALPHA", description: "", group: null, secret: false, wiring: [] },
      { id: "m", name: "MANGO", description: "", group: null, secret: false, wiring: [] },
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
      { id: "g", name: "GA", description: "", group: "Infra", secret: false, wiring: [] },
      { id: "u", name: "UA", description: "", group: null, secret: false, wiring: [] },
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

test("shift+down/up jump the cursor to the next/previous group's first variable", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "g", name: "GA", description: "infra-desc", group: "Infra", secret: false, wiring: [] },
      { id: "u", name: "UA", description: "ungrouped-desc", group: null, secret: false, wiring: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  // Ungrouped sorts first, so UA is the initial selection (shown in the inspector).
  expect(lastFrame()).toContain("ungrouped-desc");
  stdin.write("\x1b[1;2B"); // shift+down -> next group
  await tick();
  expect(lastFrame()).toContain("infra-desc");
  stdin.write("\x1b[1;2A"); // shift+up -> previous group (Ungrouped bucket)
  await tick();
  expect(lastFrame()).toContain("ungrouped-desc");
});

test("editing a variable's group offers existing groups and applies a new one", async () => {
  const model: RepoModel = {
    ...editModel,
    variables: [
      { id: "v1", name: "HAS_GROUP", description: "", group: "DB", secret: false, wiring: [] },
      { id: "v2", name: "NO_GROUP", description: "", group: null, secret: false, wiring: [] },
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
      { id: "a", name: "ALPHA", description: "", group: "PAYMENTS", secret: false, wiring: [] },
      { id: "b", name: "BETA", description: "", group: "PAYMENTS", secret: false, wiring: [] },
    ],
    values: {},
  };
  const store = createStore(model);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={18} viewportColumns={110} />);
  await tick();
  // Focus the scopes pane (vars -> inspector -> scopes) and select the PAYMENTS
  // group scope (All -> [GROUPS] -> PAYMENTS; extra downs clamp at the last row).
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

test("q with unsaved changes shows the save-before-exit prompt", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  store.setValue("v1", "dev", "pg://dirty"); // make the model dirty
  await tick();
  stdin.write("q");
  await tick();
  expect(lastFrame()).toContain("Save changes before exiting?");
  expect(lastFrame()).toContain("[Y/n]");
});

test("Ctrl+C with unsaved changes shows the save-before-exit prompt", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  store.setValue("v1", "dev", "pg://dirty");
  await tick();
  stdin.write("\x03"); // Ctrl+C
  await tick();
  expect(lastFrame()).toContain("Save changes before exiting?");
});

test("esc cancels the quit prompt and returns to browse", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  store.setValue("v1", "dev", "pg://dirty");
  await tick();
  stdin.write("q");
  await tick();
  expect(lastFrame()).toContain("Save changes before exiting?");
  stdin.write("\x1b"); // esc
  await tick();
  expect(lastFrame()).not.toContain("Save changes before exiting?");
  expect(lastFrame()).toContain("move"); // browse footer hint is back
});

const propModel: RepoModel = {
  root: "/repo/acme",
  environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
  variables: [{ id: "v1", name: "API_URL", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] }],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env", envMode: "single" }],
  values: { v1: { dev: "shared", prod: "shared" } },
  recipients: [],
};

test("editing a value shared across environments offers to propagate it", async () => {
  const store = createStore(propModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  stdin.write("\r"); // vars pane: edit value · dev
  await tick();
  expect(lastFrame()).toContain("Value · dev");
  stdin.write("X"); // "shared" -> "sharedX"
  await tick();
  stdin.write("\r"); // submit
  await tick();
  const frame = lastFrame() ?? "";
  expect(frame).toContain("update them too");
  expect(frame).toContain("prod");
  // The current env is saved immediately; prod is untouched until confirmed.
  expect(store.getModel().values.v1!.dev).toBe("sharedX");
  expect(store.getModel().values.v1!.prod).toBe("shared");
  stdin.write("y");
  await tick();
  expect(store.getModel().values.v1!.prod).toBe("sharedX");
  expect(lastFrame()).not.toContain("update them too");
});

test("declining the propagation prompt updates only the current environment", async () => {
  const store = createStore(propModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  stdin.write("\r"); await tick();
  stdin.write("X"); await tick();
  stdin.write("\r"); await tick();
  expect(lastFrame()).toContain("update them too");
  stdin.write("n"); // default No
  await tick();
  expect(store.getModel().values.v1!.dev).toBe("sharedX");
  expect(store.getModel().values.v1!.prod).toBe("shared");
  expect(lastFrame()).not.toContain("update them too");
});

test("editing a value no other environment shares skips the prompt", async () => {
  const store = createStore({ ...propModel, values: { v1: { dev: "a", prod: "b" } } });
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  stdin.write("\r"); await tick();
  stdin.write("X"); await tick(); // "a" -> "aX"
  stdin.write("\r"); await tick();
  expect(lastFrame()).not.toContain("update them too");
  expect(store.getModel().values.v1!.dev).toBe("aX");
});

test("m toggles the file mode of the focused app scope", async () => {
  const store = createStore(propModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  await tick();
  stdin.write("\t"); await tick(); // vars -> inspector
  stdin.write("\t"); await tick(); // inspector -> scopes
  stdin.write("\x1b[B"); await tick(); // All -> api (header skipped)
  stdin.write("m"); await tick();
  expect(store.getModel().consumers.find((c) => c.id === "app:api")!.envMode).toBe("perenv");
  expect(lastFrame()).toContain("per-env"); // tag / status now shows
  stdin.write("m"); await tick();
  expect(store.getModel().consumers.find((c) => c.id === "app:api")!.envMode).toBe("single");
});

test("the footer stays within the layout budget on a narrow terminal", async () => {
  // The footer hint bar is wide; if it wrapped it would exceed bottomHeight (1) and
  // overlap the panes. wrap="truncate-end" must keep the whole frame at <= rows lines.
  const store = createStore(editModel);
  const { lastFrame } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={70} />);
  await tick();
  expect((lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(20);
});
