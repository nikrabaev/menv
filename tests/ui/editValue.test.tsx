import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { EditValueModal } from "../../src/ui/components/EditValueModal.tsx";

test("submitting calls onSubmit with the typed value", async () => {
  let submitted = "";
  const { stdin } = render(
    <EditValueModal varName="PORT" env="dev" initial="" onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
  );
  await new Promise((r) => setTimeout(r, 0));
  stdin.write("8080");
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 10));
  expect(submitted).toBe("8080");
});
