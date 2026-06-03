import { expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { NewVariableModal } from "../../src/ui/components/NewVariableModal.tsx";

test("typing a name and submitting yields a new variable name", async () => {
  let name = "";
  const { stdin } = render(<NewVariableModal onSubmit={(n) => { name = n; }} onCancel={() => {}} />);
  await new Promise((r) => setTimeout(r, 0));
  stdin.write("API_KEY");
  await new Promise((r) => setTimeout(r, 10)); // let the controlled value re-render before Enter
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 10));
  expect(name).toBe("API_KEY");
});
