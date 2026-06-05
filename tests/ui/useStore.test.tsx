import { expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import type { RepoModel } from "../../src/core/types.ts";
import { createStore } from "../../src/store/store.ts";
import { useModel } from "../../src/ui/useStore.ts";

const model: RepoModel = {
  root: "/r", environments: [{ id: "dev", isDefault: true }],
  variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] }],
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
  store.addVariable({ id: "v2", name: "X", description: "", group: null, secret: false, wiring: [] });
  rerender(<Probe store={store} />);
  expect(lastFrame()).toBe("2");
});
