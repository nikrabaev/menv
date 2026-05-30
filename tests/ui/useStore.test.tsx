import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { createStore } from "../../src/store/store.ts";
import { useModel } from "../../src/ui/useStore.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/r", environments: [{ id: "dev", isDefault: true }],
  variables: [{ id: "v1", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] }],
  consumers: [], values: {}, recipients: [],
};

function Probe({ store }: { store: ReturnType<typeof createStore> }) {
  const m = useModel(store);
  return <Text>{m.variables.length}</Text>;
}

test("useModel renders model and reacts to changes", () => {
  const store = createStore(model);
  const { lastFrame, rerender } = render(<Probe store={store} />);
  expect(lastFrame()).toBe("1");
  store.addVariable({ id: "v2", name: "X", tier: "global", description: "", group: null, secret: false, consumers: [] });
  rerender(<Probe store={store} />);
  expect(lastFrame()).toBe("2");
});
