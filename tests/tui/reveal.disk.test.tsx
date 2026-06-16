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

describe("global reveal — masking", () => {
  test("ctrl+r unmasks secret values in the inspector, then re-masks", async () => {
    const rig = await renderApp(undefined, {
      "k-db": "SHORTSECRET",
      "k-api": "https://api.example.com",
    });
    // The masked placeholder shows on the (shared-key) wiring rows; the bare
    // "***" in the inspector legend is excluded by keying off "*** ⧉shared".
    expect(rig.frame()).toContain("*** ⧉shared"); // DATABASE_URL masked in the inspector
    expect(rig.frame()).not.toContain("SHORTSECRET");

    await rig.type(CTRL_R);
    await tick(25);
    expect(rig.frame()).not.toContain("SHORTSECRET"); // still masked behind the confirm
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).toContain("SHORTSECRET"); // revealed
    expect(rig.frame()).not.toContain("*** ⧉shared");

    await rig.type(CTRL_R); // hide again
    await tick(25);
    expect(rig.frame()).not.toContain("SHORTSECRET");
    expect(rig.frame()).toContain("*** ⧉shared");
    rig.ui.unmount();
  });
});
