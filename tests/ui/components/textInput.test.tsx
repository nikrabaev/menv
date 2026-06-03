import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import { TextInput } from "../../../src/ui/components/TextInput.tsx";

// Escape sequences understood by Ink's input parser.
const LEFT = "\x1B[D";
const RIGHT = "\x1B[C";
const HOME = "\x01"; // ctrl+a
const END = "\x05"; // ctrl+e
const KILL_TO_START = "\x15"; // ctrl+u
const KILL_TO_END = "\x0B"; // ctrl+k
const DELETE_WORD = "\x17"; // ctrl+w
const BACKSPACE = "\x7F";
const ENTER = "\r";
const ESC = "\x1B";

const tick = () => new Promise((r) => setTimeout(r, 20));

// Drive keys one at a time, letting the re-render flush between them — a faithful
// stand-in for a terminal, where each keystroke is its own event. Writing several
// keys before a single render would read a stale (controlled) value.
async function send(stdin: { write: (s: string) => void }, ...keys: string[]) {
  for (const k of keys) {
    stdin.write(k);
    await tick();
  }
}

// A controlled host that owns the value, mirroring how the modals use TextInput.
function Harness({ initial = "", onSubmit, onCancel, mask, width }: {
  initial?: string;
  onSubmit?: (v: string) => void;
  onCancel?: () => void;
  mask?: string;
  width?: number;
}) {
  const [v, setV] = useState(initial);
  return <TextInput value={v} onChange={setV} onSubmit={onSubmit} onCancel={onCancel} mask={mask} width={width} />;
}

describe("TextInput", () => {
  test("types characters and renders them", async () => {
    const { stdin, lastFrame } = render(<Harness />);
    await tick();
    await send(stdin, "h", "i");
    expect(lastFrame()).toContain("hi");
  });

  test("submits the current value on Enter", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="PORT" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, ENTER);
    expect(submitted).toBe("PORT");
  });

  test("cancels on Escape", async () => {
    let cancelled = false;
    const { stdin } = render(<Harness onCancel={() => { cancelled = true; }} />);
    await tick();
    await send(stdin, ESC);
    expect(cancelled).toBe(true);
  });

  test("left arrow moves the caret so typing inserts mid-string", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, "a", "c", LEFT, "b", ENTER);
    expect(submitted).toBe("abc");
  });

  test("right arrow moves the caret back toward the end", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="ab" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, HOME, RIGHT, "X", ENTER);
    expect(submitted).toBe("aXb");
  });

  test("backspace deletes the character before the caret", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="abc" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, BACKSPACE, ENTER);
    expect(submitted).toBe("ab");
  });

  test("backspace mid-string deletes only the char before the caret", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="abc" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, LEFT, BACKSPACE, ENTER); // caret between b and c, remove b
    expect(submitted).toBe("ac");
  });

  test("Home jumps the caret to the start", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="bc" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, HOME, "a", ENTER);
    expect(submitted).toBe("abc");
  });

  test("End jumps the caret to the end", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="ab" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, HOME, END, "c", ENTER);
    expect(submitted).toBe("abc");
  });

  test("inserts a multi-character paste at the caret", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="ad" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, LEFT, "bc", ENTER); // a paste arrives as one chunk between a and d
    expect(submitted).toBe("abcd");
  });

  test("ctrl+u kills text before the caret", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="abcdef" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, LEFT, LEFT, KILL_TO_START, ENTER); // caret between d and e
    expect(submitted).toBe("ef");
  });

  test("ctrl+k kills text from the caret to the end", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="abcdef" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, HOME, RIGHT, RIGHT, KILL_TO_END, ENTER);
    expect(submitted).toBe("ab");
  });

  test("ctrl+w deletes the word before the caret", async () => {
    let submitted: string | null = null;
    const { stdin } = render(<Harness initial="foo bar" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    await send(stdin, DELETE_WORD, ENTER);
    expect(submitted).toBe("foo ");
  });

  test("masks the value when a mask is given but still edits the real text", async () => {
    let submitted: string | null = null;
    const { stdin, lastFrame } = render(<Harness initial="secret" mask="*" onSubmit={(v) => { submitted = v; }} />);
    await tick();
    expect(lastFrame()).toContain("*****");
    expect(lastFrame()).not.toContain("secret");
    await send(stdin, ENTER);
    expect(submitted).toBe("secret");
  });

  test("windows a value wider than its width, keeping the caret end visible", async () => {
    const { lastFrame } = render(<Harness initial="abcdef" width={4} />);
    await tick();
    const frame = lastFrame() ?? "";
    // Caret sits at the end, so the tail is shown and the head scrolls off.
    expect(frame).toContain("def");
    expect(frame).not.toContain("abc");
  });
});
