import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useTerminalSize } from "../../src/ui/useTerminalSize.ts";

// A minimal stdout stand-in: an EventEmitter with mutable rows/columns.
function fakeStdout(columns: number, rows: number) {
  const ee = new EventEmitter() as unknown as NodeJS.WriteStream & { columns: number; rows: number };
  ee.columns = columns;
  ee.rows = rows;
  return ee;
}

function Probe({ stdout }: { stdout: NodeJS.WriteStream }) {
  const { columns, rows } = useTerminalSize(stdout);
  return <Text>{columns}x{rows}</Text>;
}

test("useTerminalSize reports the initial size", () => {
  const stdout = fakeStdout(80, 24);
  const { lastFrame } = render(<Probe stdout={stdout} />);
  expect(lastFrame()).toContain("80x24");
});

test("useTerminalSize re-renders with the new size on resize", async () => {
  const stdout = fakeStdout(80, 24);
  const { lastFrame } = render(<Probe stdout={stdout} />);
  expect(lastFrame()).toContain("80x24");

  stdout.columns = 120;
  stdout.rows = 40;
  stdout.emit("resize");
  await new Promise((r) => setTimeout(r, 20));

  expect(lastFrame()).toContain("120x40");
});
