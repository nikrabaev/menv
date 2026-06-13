// ListRow: the full-width selection band carrier. The test stdout has no color
// support, so we assert on structure (the ▌ bar + segment text) rather than the
// band color, which Ink only paints when the stream supports color.
import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { ListRow } from "../../src/tui/components/listRow.tsx";

describe("ListRow", () => {
  test("a selected+focused row shows the ▌ bar and keeps its segment text", () => {
    const { lastFrame } = render(<ListRow segments={[{ text: "DATABASE_URL", color: "green" }]} selected focused />);
    const f = lastFrame() ?? "";
    expect(f).toContain("▌");
    expect(f).toContain("DATABASE_URL");
  });

  test("a selected but blurred row still shows the bar (you never lose your place)", () => {
    const { lastFrame } = render(<ListRow segments={[{ text: "API_URL" }]} selected focused={false} />);
    expect(lastFrame() ?? "").toContain("▌");
  });

  test("an unselected row has no bar", () => {
    const { lastFrame } = render(<ListRow segments={[{ text: "REDIS_URL" }]} selected={false} focused={false} />);
    const f = lastFrame() ?? "";
    expect(f).not.toContain("▌");
    expect(f).toContain("REDIS_URL");
  });

  test("renders every segment in order", () => {
    const { lastFrame } = render(
      <ListRow segments={[{ text: "NAME" }, { text: " api" }, { text: "●", color: "green" }]} selected={false} focused={false} />,
    );
    expect(lastFrame() ?? "").toContain("NAME api●");
  });
});
