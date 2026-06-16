import { describe, expect, test } from "bun:test";
import { CTRL_R, renderApp, tick } from "./helpers.tsx";

describe("global reveal — behavior", () => {
  test("ctrl+r confirms once, then flips freely", async () => {
    const rig = await renderApp();
    await rig.type(CTRL_R);
    await tick(25);
    expect(rig.frame()).toContain("Reveal all secrets"); // confirm modal
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).toContain("secrets revealed"); // status

    await rig.type(CTRL_R); // hide — no confirm
    await tick(25);
    expect(rig.frame()).toContain("secrets hidden");
    expect(rig.frame()).not.toContain("Reveal all secrets");

    await rig.type(CTRL_R); // reveal again — confirmed already, no modal
    await tick(25);
    expect(rig.frame()).not.toContain("Reveal all secrets");
    expect(rig.frame()).toContain("secrets revealed");
    rig.ui.unmount();
  });

  test("the per-value r peek is unavailable while revealed", async () => {
    const rig = await renderApp();
    await rig.type(CTRL_R);
    await tick(25);
    await rig.type("y"); // revealed + confirmed
    await tick(25);
    await rig.type("r"); // attempt the peek
    await tick(25);
    expect(rig.frame()).not.toContain("Reveal secret"); // no peek confirm modal
    expect(rig.frame()).toContain("already revealed"); // info status instead
    rig.ui.unmount();
  });
});
