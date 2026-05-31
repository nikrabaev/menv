import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { EditFieldModal } from "../../src/ui/components/EditFieldModal.tsx";

test("renders the field label and submits the typed value", async () => {
  let submitted = "";
  const { lastFrame, stdin } = render(
    <EditFieldModal label="description" initial="" onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
  );
  expect(lastFrame()).toContain("description");
  await new Promise((r) => setTimeout(r, 0));
  stdin.write("hello");
  await new Promise((r) => setTimeout(r, 10)); // let the controlled value re-render before Enter
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 10));
  expect(submitted).toBe("hello");
});

test("esc cancels", async () => {
  let cancelled = false;
  const { stdin } = render(
    <EditFieldModal label="value · dev" initial="x" onSubmit={() => {}} onCancel={() => { cancelled = true; }} />,
  );
  await new Promise((r) => setTimeout(r, 0));
  stdin.write("\x1b");
  await new Promise((r) => setTimeout(r, 10));
  expect(cancelled).toBe(true);
});
