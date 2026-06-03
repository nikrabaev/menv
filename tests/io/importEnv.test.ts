import { expect, test } from "bun:test";
import { createStore } from "../../src/store/store.ts";
import { applyFileDrift } from "../../src/io/importEnv.ts";
import type { FileDrift } from "../../src/io/drift.ts";
import type { RepoModel } from "../../src/core/types.ts";

function store() {
  const model: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:web"] }],
    consumers: [{ kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" }],
    values: { "var:PORT": { dev: "3000" } },
    recipients: [],
  };
  return createStore(model);
}

test("applies a changed value to the existing variable", async () => {
  const s = store();
  const drift: FileDrift = {
    rel: "apps/web/.env", consumerId: "app:web", env: "dev", local: false,
    added: [], changed: [{ name: "PORT", varId: "var:PORT", expected: "3000", actual: "4000" }], removed: [],
  };
  applyFileDrift(s, drift);
  expect(s.getModel().values["var:PORT"]!.dev).toBe("4000");
});

test("mints a new (secret-flagged, correctly-local) variable for an added key", async () => {
  const s = store();
  const drift: FileDrift = {
    rel: "apps/web/.env.local", consumerId: "app:web", env: "dev", local: true,
    added: [{ name: "API_TOKEN", value: "abc", description: "the token" }], changed: [], removed: [],
  };
  applyFileDrift(s, drift);
  const v = s.getModel().variables.find((x) => x.name === "API_TOKEN")!;
  expect(v.id).toBe("var:API_TOKEN.local");
  expect(v.local).toBe(true);
  expect(v.secret).toBe(true); // TOKEN matches the secret-name heuristic
  expect(v.consumers).toEqual(["app:web"]);
  expect(v.description).toBe("the token");
  expect(s.getModel().values[v.id]!.dev).toBe("abc");
});

test("leaves a removed key's vault value untouched (report-only)", async () => {
  const s = store();
  const drift: FileDrift = {
    rel: "apps/web/.env", consumerId: "app:web", env: "dev", local: false,
    added: [], changed: [], removed: [{ name: "PORT", varId: "var:PORT" }],
  };
  applyFileDrift(s, drift);
  expect(s.getModel().values["var:PORT"]!.dev).toBe("3000");
  expect(s.getModel().variables.some((v) => v.id === "var:PORT")).toBe(true);
});
