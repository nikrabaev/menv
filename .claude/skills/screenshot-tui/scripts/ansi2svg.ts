// Pure-Bun ANSI-frame -> SVG terminal screenshot (+ an HTML wrapper for headless
// Chrome). No external image tooling required — this exists because vhs / tmux /
// ImageMagick are not installed in this environment, and Bun is.
//
// Usage:
//   bun run ansi2svg.ts <in.ansi> <out.svg> [out.html] [--title "caption"]
//
// The input is a single rendered frame (ANSI SGR colour codes + box-drawing
// characters) as produced by capturing MenvApp via ink-testing-library — see
// references/render-harness.tsx. The output SVG draws a macOS-style terminal
// window around the frame; rasterize it with rasterize.sh.
const argv = Bun.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags.set(argv[i].slice(2), argv[++i] ?? "");
  else positional.push(argv[i]);
}
const [inPath, svgPath, htmlArg] = positional;
const htmlPath = htmlArg ?? svgPath.replace(/\.svg$/, ".html");
const TITLE = flags.get("title") ?? "menv — environment vault";

if (!inPath || !svgPath) {
  console.error('usage: bun run ansi2svg.ts <in.ansi> <out.svg> [out.html] [--title "caption"]');
  process.exit(1);
}

const SRC = await Bun.file(inPath).text();

// ── Tokyo-Night palette ───────────────────────────────────────────────────────
// menv styles with Ink's named colours (gray, cyan, yellow, green, …) plus the
// `inverse`/`dim`/`bold` attributes. Ink emits the standard/bright ANSI SGR codes
// for those names; we map each code to a Tokyo-Night hue so the screenshot reads
// as a coherent dark terminal rather than raw VGA colours.
const BG = "#1a1b26";
const TITLE_BG = "#16161e";
const FG = "#c0caf5";
const PAL: Record<number, string> = {
  30: "#414868", 31: "#f7768e", 32: "#9ece6a", 33: "#e0af68",
  34: "#7aa2f7", 35: "#bb9af7", 36: "#7dcfff", 37: "#a9b1d6",
  90: "#565f89", 91: "#f7768e", 92: "#9ece6a", 93: "#e0af68",
  94: "#7aa2f7", 95: "#bb9af7", 96: "#7dcfff", 97: "#c0caf5",
};
const BGPAL: Record<number, string> = {
  40: "#414868", 41: "#f7768e", 42: "#9ece6a", 43: "#e0af68",
  44: "#7aa2f7", 45: "#bb9af7", 46: "#7dcfff", 47: "#a9b1d6",
  100: "#414868", 101: "#f7768e", 102: "#9ece6a", 103: "#e0af68",
  104: "#7aa2f7", 105: "#bb9af7", 106: "#7dcfff", 107: "#c0caf5",
};

type Style = { fg: string | null; bg: string | null; bold: boolean; dim: boolean; inverse: boolean };
const fresh = (): Style => ({ fg: null, bg: null, bold: false, dim: false, inverse: false });

function applySGR(st: Style, codes: number[]): Style {
  if (codes.length === 0) codes = [0];
  for (const c of codes) {
    if (c === 0) Object.assign(st, fresh());
    else if (c === 1) st.bold = true;
    else if (c === 2) st.dim = true;
    else if (c === 22) { st.bold = false; st.dim = false; }
    else if (c === 7) st.inverse = true;
    else if (c === 27) st.inverse = false;
    else if (c === 39) st.fg = null;
    else if (c === 49) st.bg = null;
    else if (PAL[c]) st.fg = PAL[c];
    else if (BGPAL[c]) st.bg = BGPAL[c];
  }
  return st;
}

type Run = { text: string; fg: string; bg: string | null; bold: boolean; dim: boolean };
function parseLine(line: string, carry: Style): { runs: Run[]; end: Style } {
  const runs: Run[] = [];
  const st: Style = { ...carry };
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const fg0 = st.fg ?? FG;
    const bg0 = st.bg;
    const fg = st.inverse ? (bg0 ?? BG) : fg0;
    const bg = st.inverse ? fg0 : bg0;
    runs.push({ text: buf, fg, bg, bold: st.bold, dim: st.dim && !st.inverse });
    buf = "";
  };
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    buf += line.slice(last, m.index);
    last = re.lastIndex;
    flush();
    applySGR(st, m[1].split(";").filter((s) => s !== "").map(Number));
  }
  buf += line.slice(last);
  flush();
  return { runs, end: st };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── layout ───────────────────────────────────────────────────────────────────
// CW/LH are tuned to the monospace metrics below so box-drawing borders line up
// seamlessly. textLength pins each run to an exact pixel width so glyph-advance
// rounding can't drift the columns apart.
const CW = 8.4;   // cell width (px)
const LH = 19;    // line height (px)
const FS = 14.5;  // font size (px)
const PADX = 18;
const TITLEBAR = 36;
const PADTOP = 14;
const PADBOT = 16;
const MARGIN = 34; // breathing room around the window (holds the drop shadow)

const strip = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "");
let lines = SRC.replace(/\n$/, "").split("\n");
const isBlank = (l: string) => strip(l).trim() === "";
while (lines.length && isBlank(lines[0])) lines.shift();
while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();

// ink-testing-library doesn't pad a pane's rows out to its box width, so the
// rightmost pane's closing "│" hugs the text instead of sitting at the far edge
// (a known test-renderer artifact — a real terminal's alternate screen pads it).
// Re-pad every bordered content row: insert the missing spaces just before the
// final "│" so all panes' right borders align in the screenshot.
const target = Math.max(...lines.map((l) => strip(l).length));
lines = lines.map((l) => {
  const vis = strip(l);
  if (!vis.startsWith("│") || !vis.endsWith("│")) return l; // not a bordered content row
  const gap = target - vis.length;
  if (gap <= 0) return l;
  const at = l.lastIndexOf("│");
  return l.slice(0, at) + " ".repeat(gap) + l.slice(at);
});

const cols = Math.max(...lines.map((l) => strip(l).length));
const winW = Math.ceil(cols * CW + PADX * 2);
const winH = Math.ceil(TITLEBAR + PADTOP + lines.length * LH + PADBOT);
const W = winW + MARGIN * 2;
const H = winH + MARGIN * 2;

const out: string[] = [];
out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace">`,
);
out.push(
  `<defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000000" flood-opacity="0.45"/></filter></defs>`,
);

const x0 = MARGIN;
const y0 = MARGIN;
// window body + title bar
out.push(`<rect x="${x0}" y="${y0}" width="${winW}" height="${winH}" rx="12" fill="${BG}" filter="url(#shadow)"/>`);
out.push(`<path d="M${x0},${y0 + 12} a12,12 0 0 1 12,-12 h${winW - 24} a12,12 0 0 1 12,12 v24 h-${winW} z" fill="${TITLE_BG}"/>`);
// traffic lights
out.push(`<circle cx="${x0 + 20}" cy="${y0 + TITLEBAR / 2}" r="6" fill="#f7768e"/>`);
out.push(`<circle cx="${x0 + 40}" cy="${y0 + TITLEBAR / 2}" r="6" fill="#e0af68"/>`);
out.push(`<circle cx="${x0 + 60}" cy="${y0 + TITLEBAR / 2}" r="6" fill="#9ece6a"/>`);
if (TITLE) {
  out.push(
    `<text x="${x0 + winW / 2}" y="${y0 + TITLEBAR / 2 + 4}" text-anchor="middle" fill="#565f89" font-size="12.5">${esc(TITLE)}</text>`,
  );
}

let carry = fresh();
const top = y0 + TITLEBAR + PADTOP;
for (let i = 0; i < lines.length; i++) {
  const { runs, end } = parseLine(lines[i], carry);
  carry = end;
  const yBox = top + i * LH;
  const yText = yBox + LH - 5;
  let col = 0;
  for (const r of runs) {
    const w = r.text.length * CW;
    if (r.bg) {
      out.push(`<rect x="${(x0 + PADX + col * CW).toFixed(1)}" y="${yBox.toFixed(1)}" width="${(w + 0.5).toFixed(1)}" height="${LH}" fill="${r.bg}"/>`);
    }
    col += r.text.length;
  }
  col = 0;
  for (const r of runs) {
    const w = r.text.length * CW;
    const t = r.text;
    if (t.trim() !== "") {
      const weight = r.bold ? ' font-weight="700"' : "";
      const op = r.dim ? ' opacity="0.6"' : "";
      out.push(
        `<text x="${(x0 + PADX + col * CW).toFixed(1)}" y="${yText.toFixed(1)}" fill="${r.fg}"${weight}${op} font-size="${FS}" textLength="${w.toFixed(1)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(t)}</text>`,
      );
    }
    col += t.length;
  }
}
out.push(`</svg>`);
const svg = out.join("\n");
await Bun.write(svgPath, svg);

const html =
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<style>*{margin:0;padding:0}html,body{background:transparent;width:${W}px;height:${H}px;overflow:hidden}</style>` +
  `</head><body>${svg}</body></html>`;
await Bun.write(htmlPath, html);

// The dimensions line is parsed by rasterize.sh to size the Chrome window.
console.log(`wrote ${svgPath} ${W}x${H} (${lines.length} lines, ${cols} cols) html=${htmlPath}`);
