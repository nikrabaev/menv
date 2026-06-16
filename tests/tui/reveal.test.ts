import { describe, expect, test } from "bun:test";
import { toggleReveal } from "../../src/tui/state/mutations.ts";
import type { Action, AppState, Store } from "../../src/tui/state/store.tsx";
import { initialState, reducer } from "../../src/tui/state/store.tsx";
import { makeRegistry } from "../helpers/fixtures.ts";

function makeStore(overrides: Partial<AppState> = {}): Store {
  let state: AppState = { ...initialState(makeRegistry()), ...overrides };
  return {
    get state() {
      return state;
    },
    getState: () => state,
    dispatch: (action: Action) => {
      state = reducer(state, action);
    },
  };
}

describe("toggleReveal", () => {
  test("first reveal asks for confirmation and does not reveal yet", () => {
    const store = makeStore();
    toggleReveal(store);
    expect(store.state.revealSecrets).toBe(false);
    const top = store.state.modals.at(-1);
    expect(top?.kind).toBe("confirm");
    if (top?.kind === "confirm") {
      expect(top.title).toBe("Reveal all secrets");
      void top.onConfirm();
      expect(store.state.revealSecrets).toBe(true);
      expect(store.state.revealConfirmed).toBe(true);
    }
  });

  test("after confirming once, reveal is immediate with no modal", () => {
    const store = makeStore({ revealConfirmed: true });
    toggleReveal(store);
    expect(store.state.revealSecrets).toBe(true);
    expect(store.state.modals).toHaveLength(0);
  });

  test("hiding never asks", () => {
    const store = makeStore({ revealSecrets: true, revealConfirmed: true });
    toggleReveal(store);
    expect(store.state.revealSecrets).toBe(false);
    expect(store.state.modals).toHaveLength(0);
  });
});
