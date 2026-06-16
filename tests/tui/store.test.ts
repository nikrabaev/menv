import { describe, expect, test } from "bun:test";
import { initialState, reducer } from "../../src/tui/state/store.tsx";
import { makeRegistry } from "../helpers/fixtures.ts";

const base = () => initialState(makeRegistry());

describe("reducer · human mode", () => {
  test("humanMode defaults off, with no row focus", () => {
    const s = base();
    expect(s.humanMode).toBe(false);
    expect(s.humanRowFocus).toBe(false);
    expect(s.humanRowIndex).toBe(0);
  });

  test("toggling humanMode off drops any row focus", () => {
    let s = base();
    s = reducer(s, { type: "humanMode", enabled: true });
    s = reducer(s, { type: "humanRowFocus", focused: true });
    s = reducer(s, { type: "humanRowIndex", index: 3 });
    expect(s).toMatchObject({ humanMode: true, humanRowFocus: true, humanRowIndex: 3 });
    s = reducer(s, { type: "humanMode", enabled: false });
    expect(s).toMatchObject({ humanMode: false, humanRowFocus: false, humanRowIndex: 0 });
  });

  test("moving to another card drops row focus", () => {
    let s = base();
    s = reducer(s, { type: "humanRowFocus", focused: true });
    s = reducer(s, { type: "humanRowIndex", index: 2 });
    s = reducer(s, { type: "mainIndex", tab: "variables", index: 1 });
    expect(s.humanRowFocus).toBe(false);
    expect(s.humanRowIndex).toBe(0);
  });
});

describe("reducer · reveal secrets", () => {
  test("reveal flags default off", () => {
    const s = base();
    expect(s.revealSecrets).toBe(false);
    expect(s.revealConfirmed).toBe(false);
  });

  test("revealing sets both flags; hiding keeps the session confirmation", () => {
    let s = base();
    s = reducer(s, { type: "revealSecrets", revealed: true });
    expect(s).toMatchObject({ revealSecrets: true, revealConfirmed: true });
    s = reducer(s, { type: "revealSecrets", revealed: false });
    expect(s).toMatchObject({ revealSecrets: false, revealConfirmed: true });
  });
});
