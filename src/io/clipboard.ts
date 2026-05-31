// System-clipboard write, the one effect this feature performs. Mirrors the
// Bun.spawn idiom in src/crypto/identity.ts. `clipboardCommand` is split out as a
// pure function so the platform mapping is unit-testable without spawning.

export function clipboardCommand(platform: NodeJS.Platform): string[] | null {
  switch (platform) {
    case "darwin":
      return ["pbcopy"];
    case "win32":
      return ["clip"];
    case "linux":
      return ["xclip", "-selection", "clipboard"];
    default:
      return null;
  }
}

export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const cmd = clipboardCommand(platform);
  if (!cmd) return false;
  try {
    const p = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    p.stdin.write(text);
    await p.stdin.end();
    return (await p.exited) === 0;
  } catch {
    // Tool missing on PATH, spawn rejected, etc. — copy simply didn't happen.
    return false;
  }
}
