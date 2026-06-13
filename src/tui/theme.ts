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
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
