import { Text, useInput } from "ink";
import { useEffect, useState } from "react";

// A single-line text input with a block caret, full editing key-bindings, paste
// support, and horizontal windowing so the caret stays visible when the text is
// wider than the field. Controlled: the parent owns `value`; the caret position
// is the input's own concern.
export function TextInput({ value, onChange, onSubmit, onCancel, mask, width, focus = true }: {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: (value: string) => void;
  onCancel?: () => void;
  // When set, every character renders as this glyph (secret entry); editing still
  // operates on the real text.
  mask?: string;
  // Visible width in cells. When the text (plus the trailing caret cell) exceeds
  // it the view scrolls to keep the caret in frame. Unset = render the whole line.
  width?: number;
  focus?: boolean;
}) {
  const [cursor, setCursor] = useState(value.length);
  // The value can change from outside (e.g. a reset); never let the caret dangle
  // past the end of the text.
  useEffect(() => {
    if (cursor > value.length) setCursor(value.length);
  }, [value.length, cursor]);

  useInput((input, key) => {
    if (key.return) { onSubmit?.(value); return; }
    if (key.escape) { onCancel?.(); return; }
    // Keys that belong to the surrounding UI, not the field.
    if (key.upArrow || key.downArrow || key.tab) return;

    if (key.leftArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCursor((c) => Math.min(value.length, c + 1)); return; }

    if (key.ctrl && input === "a") { setCursor(0); return; } // home
    if (key.ctrl && input === "e") { setCursor(value.length); return; } // end
    if (key.ctrl && input === "u") { onChange(value.slice(cursor)); setCursor(0); return; } // kill to start
    if (key.ctrl && input === "k") { onChange(value.slice(0, cursor)); return; } // kill to end
    if (key.ctrl && input === "w") {
      // Delete the whitespace-then-word run immediately before the caret.
      const left = value.slice(0, cursor).replace(/\S+\s*$/, "");
      onChange(left + value.slice(cursor));
      setCursor(left.length);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        onChange(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }

    // Plain text insertion. A paste arrives as one multi-character chunk, which
    // this handles the same as a single keypress. Other control combos are ignored.
    if (input && !key.ctrl && !key.meta) {
      onChange(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  }, { isActive: focus });

  const display = mask ? mask.repeat(value.length) : value;
  // Cells to lay out: one per character, plus a trailing cell the caret can sit on
  // when it's at the end of the text.
  const cells = display.split("");
  if (focus && cursor >= cells.length) cells.push(" ");

  // Scroll so the caret stays within `width` cells. When the caret is still within
  // the first window we anchor at the start; past that, the caret rides the right edge.
  const w = width && width > 0 ? width : cells.length;
  let start = 0;
  if (cells.length > w) {
    start = cursor < w ? 0 : cursor - w + 1;
    start = Math.max(0, Math.min(start, cells.length - w));
  }
  const view = cells.slice(start, start + w);
  const caretLocal = cursor - start;

  const before = view.slice(0, caretLocal).join("");
  const caretChar = view[caretLocal] ?? " ";
  const after = view.slice(caretLocal + 1).join("");

  return (
    <Text wrap="truncate-end">
      {before}
      {focus ? <Text inverse>{caretChar}</Text> : caretChar}
      {after}
    </Text>
  );
}
