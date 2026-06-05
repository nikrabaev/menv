import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import type { FileDrift } from "../../src/io/drift.ts";
import { DriftReconciler } from "../../src/ui/driftReconcile.tsx";

const ESC = "\x1B";
const tick = () => new Promise((r) => setTimeout(r, 20));
async function send(stdin: { write: (s: string) => void }, ...keys: string[]) {
  for (const k of keys) { stdin.write(k); await tick(); }
}

const drifts: FileDrift[] = [
  {
    rel: "apps/web/.env", consumerId: "app:web", env: "dev", local: false,
    added: [{ name: "EXTRA", value: "hi", description: "", active: true }],
    changed: [{ name: "PORT", varId: "var:PORT", expected: "3000", actual: "4000" }],
    applied: [{ name: "GONE", varId: "var:GONE", to: false }],
  },
  {
    rel: "apps/web/.env.local", consumerId: "app:web", env: "dev", local: true,
    added: [], changed: [{ name: "TOKEN", varId: "var:TOKEN.local", expected: "a", actual: "b" }], applied: [],
  },
];

describe("DriftReconciler", () => {
  test("shows the first file's changes, additions and applied changes", async () => {
    const { lastFrame } = render(<DriftReconciler drifts={drifts} onDone={() => {}} onCancel={() => {}} />);
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("apps/web/.env");
    expect(f).toContain("PORT");
    expect(f).toContain("EXTRA");
    expect(f).toContain("GONE");
    expect(f).toContain("(1/2)");
  });

  test("y imports the first file, n keeps the second — only the imported rel is returned", async () => {
    let result: Set<string> | null = null;
    const { stdin } = render(
      <DriftReconciler drifts={drifts} onDone={(r) => { result = r; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "y", "n");
    expect(result).toEqual(new Set(["apps/web/.env"]));
  });

  test("Y imports all remaining files at once", async () => {
    let result: Set<string> | null = null;
    const { stdin } = render(
      <DriftReconciler drifts={drifts} onDone={(r) => { result = r; }} onCancel={() => {}} />,
    );
    await tick();
    await send(stdin, "Y");
    expect(result).toEqual(new Set(["apps/web/.env", "apps/web/.env.local"]));
  });

  test("Esc cancels the whole reconciliation", async () => {
    let cancelled = false;
    const { stdin } = render(
      <DriftReconciler drifts={drifts} onDone={() => {}} onCancel={() => { cancelled = true; }} />,
    );
    await tick();
    await send(stdin, ESC);
    expect(cancelled).toBe(true);
  });
});
