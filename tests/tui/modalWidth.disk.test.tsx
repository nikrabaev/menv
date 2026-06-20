// ModalFrame width is adaptive: the requested width is capped at 80% of the
// terminal so a modal never overflows on a narrow terminal.
import { afterEach, describe, expect, test } from "bun:test";
import { renderApp, setTestSize } from "./helpers.tsx";

// Distance between the round-border corners on the modal's top edge. In modal
// view the ModalFrame is the only round-bordered box, so this is its width.
function modalWidth(frame: string): number {
  for (const line of frame.split("\n")) {
    const l = line.indexOf("╭");
    const r = line.indexOf("╮");
    if (l !== -1 && r !== -1 && r > l) return r - l + 1;
  }
  throw new Error("no modal border found in frame");
}

describe("ModalFrame adaptive width", () => {
  afterEach(() => setTestSize(130, 40));

  test("caps the modal at 80% of a narrow terminal", async () => {
    setTestSize(80, 24);
    const rig = await renderApp();
    await rig.type("?"); // help modal requests width 80
    expect(modalWidth(rig.frame())).toBe(64); // floor(80 * 0.8)
    rig.ui.unmount();
  });

  test("keeps the requested width when the terminal is wide", async () => {
    setTestSize(130, 40);
    const rig = await renderApp();
    await rig.type("?"); // requests 80; floor(130 * 0.8) = 104, so uncapped
    expect(modalWidth(rig.frame())).toBe(80);
    rig.ui.unmount();
  });
});
