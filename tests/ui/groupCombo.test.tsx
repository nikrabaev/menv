import { expect, test, describe } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { GroupComboModal } from "../../src/ui/components/GroupComboModal.tsx";

const DOWN = "\x1B[B";
const ENTER = "\r";
const ESC = "\x1B";
const tick = () => new Promise((r) => setTimeout(r, 20));
async function send(stdin: { write: (s: string) => void }, ...keys: string[]) {
  for (const k of keys) { stdin.write(k); await tick(); }
}

describe("GroupComboModal", () => {
  test("lists the existing groups as suggestions", async () => {
    const { lastFrame } = render(
      <GroupComboModal initial="" groups={["Auth", "DB", "Storage"]} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Auth");
    expect(frame).toContain("DB");
    expect(frame).toContain("Storage");
  });

  test("typing filters the suggestions", async () => {
    const { lastFrame, stdin } = render(
      <GroupComboModal initial="" groups={["Auth", "DB", "Storage"]} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "s", "t");
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Storage");
    expect(frame).not.toContain("Auth");
  });

  test("Enter accepts the typed text as a brand-new group", async () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <GroupComboModal initial="" groups={["DB"]} onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "N", "e", "w", ENTER);
    expect(submitted).toBe("New");
  });

  test("down arrow highlights a suggestion and Enter accepts it", async () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <GroupComboModal initial="" groups={["Auth", "DB"]} onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, DOWN, ENTER); // highlight first suggestion (Auth, sorted), accept
    expect(submitted).toBe("Auth");
  });

  test("Enter with empty input submits an empty string (clears the group)", async () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <GroupComboModal initial="" groups={["DB"]} onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, ENTER);
    expect(submitted).toBe("");
  });

  test("Esc cancels", async () => {
    let cancelled = false;
    const { stdin } = render(
      <GroupComboModal initial="DB" groups={["DB"]} onSubmit={() => {}} onCancel={() => { cancelled = true; }} />,
    );
    await tick();
    await send(stdin, ESC);
    expect(cancelled).toBe(true);
  });

  test("starts with the current group prefilled", async () => {
    let submitted: string | null = null;
    const { stdin } = render(
      <GroupComboModal initial="DB" groups={["DB", "Auth"]} onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, ENTER); // accept the prefilled text untouched
    expect(submitted).toBe("DB");
  });
});
