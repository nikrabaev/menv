// ScrollList: windowing + the above/below counts and the scrollbar gutter that
// only appear when the list overflows its height.
import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { ScrollList } from "../../src/tui/components/scrollList.tsx";

const row = (it: string, _i: number, sel: boolean) => (
  <Text key={it}>
    {it}
    {sel ? "*" : ""}
  </Text>
);

describe("ScrollList", () => {
  test("no overflow renders every row and no indicators", () => {
    const { lastFrame } = render(<ScrollList items={["a", "b", "c"]} selected={0} height={10} renderItem={row} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("a");
    expect(f).toContain("c");
    expect(f).not.toContain("more");
    expect(f).not.toContain("█");
  });

  test("overflow at the top shows the below count and a thumb", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item${i}`);
    const { lastFrame } = render(<ScrollList items={items} selected={0} height={10} renderItem={row} />);
    const f = lastFrame() ?? "";
    // height 10 → reserve 2 → window 8 → 30-8 = 22 hidden below.
    expect(f).toContain("↓ 22 more");
    expect(f).toContain("█"); // scrollbar thumb
  });

  test("scrolled to the bottom shows the above count", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item${i}`);
    const { lastFrame } = render(<ScrollList items={items} selected={29} height={10} renderItem={row} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("↑ 22 more");
  });

  test("keeps the selected row inside the window", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item${i}`);
    const { lastFrame } = render(<ScrollList items={items} selected={15} height={10} renderItem={row} />);
    expect(lastFrame() ?? "").toContain("item15*");
  });

  test("centers the selection so scrolling begins at the middle, not the bottom", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item${i}`);
    // height 10 → reserve 2 → window 8. Centering the selection keeps an equal
    // count hidden above and below, so scrolling starts once the cursor passes
    // the middle row rather than pinning it to the bottom edge.
    const { lastFrame } = render(<ScrollList items={items} selected={15} height={10} renderItem={row} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("↑ 11 more");
    expect(f).toContain("↓ 11 more");
  });

  test("does not scroll until the selection reaches the middle of the window", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item${i}`);
    // window 8, middle row is index 4. Selecting row 4 must not have scrolled
    // yet (item0 still visible, nothing hidden above).
    const { lastFrame } = render(<ScrollList items={items} selected={4} height={10} renderItem={row} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("item0");
    expect(f).not.toContain("↑ ");
  });
});
