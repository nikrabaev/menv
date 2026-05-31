import { expect, test, describe } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { BackupSelectModal, ConflictResolver } from "../../src/ui/restore.tsx";

const DOWN = "\x1B[B";
const ENTER = "\r";
const ESC = "\x1B";
const tick = () => new Promise((r) => setTimeout(r, 20));
async function send(stdin: { write: (s: string) => void }, ...keys: string[]) {
  for (const k of keys) { stdin.write(k); await tick(); }
}

describe("BackupSelectModal", () => {
  test("lists the backup keys", async () => {
    const { lastFrame } = render(
      <BackupSelectModal keys={["20260102000000", "20260101000000"]} onSelect={() => {}} onCancel={() => {}} />,
    );
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("20260102000000");
    expect(f).toContain("20260101000000");
  });

  test("down arrow + Enter selects the second key", async () => {
    let selected: string | null = null;
    const { stdin } = render(
      <BackupSelectModal keys={["20260102000000", "20260101000000"]} onSelect={(k) => { selected = k; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, DOWN, ENTER);
    expect(selected).toBe("20260101000000");
  });

  test("Esc cancels", async () => {
    let cancelled = false;
    const { stdin } = render(
      <BackupSelectModal keys={["k1"]} onSelect={() => {}} onCancel={() => { cancelled = true; }} />,
    );
    await tick();
    await send(stdin, ESC);
    expect(cancelled).toBe(true);
  });
});

describe("ConflictResolver", () => {
  test("y then n produces per-file answers", async () => {
    let answers: Record<string, boolean> | null = null;
    const { stdin } = render(
      <ConflictResolver conflicts={["a/.env", "b/.env"]} onDone={(x) => { answers = x; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "y", "n");
    expect(answers).toEqual({ "a/.env": true, "b/.env": false });
  });

  test("Y answers yes-to-all for the remaining files", async () => {
    let answers: Record<string, boolean> | null = null;
    const { stdin } = render(
      <ConflictResolver conflicts={["a/.env", "b/.env", "c/.env"]} onDone={(x) => { answers = x; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "n", "Y"); // a: no, then yes-to-all for b and c
    expect(answers).toEqual({ "a/.env": false, "b/.env": true, "c/.env": true });
  });

  test("N answers no-to-all immediately", async () => {
    let answers: Record<string, boolean> | null = null;
    const { stdin } = render(
      <ConflictResolver conflicts={["a/.env", "b/.env"]} onDone={(x) => { answers = x; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "N");
    expect(answers).toEqual({ "a/.env": false, "b/.env": false });
  });

  test("Esc cancels", async () => {
    let cancelled = false;
    const { stdin } = render(
      <ConflictResolver conflicts={["a/.env"]} onDone={() => {}} onCancel={() => { cancelled = true; }} />,
    );
    await tick();
    await send(stdin, ESC);
    expect(cancelled).toBe(true);
  });
});
