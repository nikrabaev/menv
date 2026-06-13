// Semantic color tokens. ANSI color NAMES only — the user's terminal theme
// owns the actual palette, and Ink/chalk honor NO_COLOR for monochrome. Every
// color-coded state is also carried by a glyph/letter (see selectors.ts).
export const theme = {
  accent: "cyan", // focus, active scope, titles
  success: "green",
  warning: "yellow",
  error: "red",
  info: "blue",
  secret: "magenta",
  muted: "gray",
  // Selection: a quiet bright-black band fills the full row width (Ink paints it
  // edge-to-edge); the leading ▌ bar + bold carry selection under NO_COLOR.
  selectionBand: "blackBright",
  selectionBar: "cyan", // = accent; the bar when the pane is focused
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
