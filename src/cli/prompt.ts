// Value input for `menv set`: argument | piped stdin | masked TTY prompt — in
// that order (spec: "arg | stdin | TTY masked prompt"). Values never need to
// touch shell history: pipe them, or omit the argument on a TTY.

export function stripTrailingNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}

export interface ReadValueDeps {
  isTTY: boolean;
  readStdin: () => Promise<string>;
  prompt: (label?: string) => Promise<string>;
}

export const defaultReadValueDeps: ReadValueDeps = {
  isTTY: process.stdin.isTTY === true,
  readStdin: () => Bun.stdin.text(),
  prompt: promptMasked,
};

export async function readValue(arg: string | undefined, deps: ReadValueDeps = defaultReadValueDeps): Promise<string> {
  if (arg !== undefined) return arg;
  if (!deps.isTTY) return stripTrailingNewline(await deps.readStdin());
  return deps.prompt("value: ");
}

// Raw-mode masked reader. Only ever called on a TTY (readValue gates it);
// echoes "*" per char, supports backspace, ends on Enter, aborts on Ctrl+C.
export async function promptMasked(label = "value: "): Promise<string> {
  process.stderr.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    let value = "";
    for await (const chunk of process.stdin) {
      for (const byte of chunk as Uint8Array) {
        if (byte === 0x03) {
          process.stderr.write("\n");
          process.exit(130); // Ctrl+C
        }
        if (byte === 0x0d || byte === 0x0a) {
          process.stderr.write("\n");
          return value;
        }
        if (byte === 0x7f || byte === 0x08) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stderr.write("\b \b");
          }
          continue;
        }
        value += String.fromCharCode(byte);
        process.stderr.write("*");
      }
    }
    return value;
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
