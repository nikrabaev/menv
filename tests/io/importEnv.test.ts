import { expect, test } from "bun:test";
import { consumerIdsOf, wiringFor } from "../../src/core/model.ts";
import type { RepoModel } from "../../src/core/types.ts";
import type { FileDrift } from "../../src/io/drift.ts";
import { applyFileDrift } from "../../src/io/importEnv.ts";
import { createStore } from "../../src/store/store.ts";

function store() {
  const model: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "var:PORT", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:web" }] }],
    consumers: [{ kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" }],
    values: { "var:PORT": { dev: "3000" } },
    recipients: [],
  };
  return createStore(model);
}

const emptyDrift = (over: Partial<FileDrift>): FileDrift => ({
  rel: "apps/web/.env", consumerId: "app:web", env: "dev", local: false,
  added: [], changed: [], applied: [], ...over,
});

test("applies a changed value to the existing variable", async () => {
  const s = store();
  applyFileDrift(s, emptyDrift({ changed: [{ name: "PORT", varId: "var:PORT", expected: "3000", actual: "4000" }] }));
  expect(s.getModel().values["var:PORT"]!.dev).toBe("4000");
});

test("mints a new (secret-flagged, correctly-local) variable for an added key", async () => {
  const s = store();
  applyFileDrift(s, emptyDrift({
    rel: "apps/web/.env.local", local: true,
    added: [{ name: "API_TOKEN", value: "abc", description: "the token", active: true }],
  }));
  const v = s.getModel().variables.find((x) => x.name === "API_TOKEN")!;
  expect(v.id).toBe("var:API_TOKEN.local");
  expect(v.local).toBe(true);
  expect(v.secret).toBe(true); // TOKEN matches the secret-name heuristic
  expect(consumerIdsOf(v)).toEqual(["app:web"]);
  expect(v.description).toBe("the token");
  expect(s.getModel().values[v.id]!.dev).toBe("abc");
});

test("an added commented-out key lands wired-but-unapplied", async () => {
  const s = store();
  applyFileDrift(s, emptyDrift({
    added: [{ name: "EXTRA", value: "x", description: "", active: false }],
  }));
  const v = s.getModel().variables.find((x) => x.name === "EXTRA")!;
  expect(wiringFor(v, "app:web")?.unapplied).toEqual(["dev"]);
  expect(s.getModel().values[v.id]!.dev).toBe("x");
});

test("an applied:false change unapplies the variable, keeping its value", async () => {
  const s = store();
  applyFileDrift(s, emptyDrift({ applied: [{ name: "PORT", varId: "var:PORT", to: false }] }));
  const v = s.getModel().variables.find((x) => x.id === "var:PORT")!;
  expect(wiringFor(v, "app:web")?.unapplied).toEqual(["dev"]);
  expect(s.getModel().values["var:PORT"]!.dev).toBe("3000"); // value untouched
});
