// System-clipboard write, the one effect this feature performs. Mirrors the
// Bun.spawn idiom in src/crypto/identity.ts. `clipboardCommands` is split out as a
// pure function so the platform mapping is unit-testable without spawning.

// Ordered clipboard-tool candidates for the platform, tried in turn until one
// succeeds. Linux ships either Wayland (wl-copy) or X11 (xclip), and the wrong one
// won't be installed, so we attempt both.
export function clipboardCommands(platform: NodeJS.Platform): string[][] {
  switch (platform) {
    case "darwin":
      return [["pbcopy"]];
    case "win32":
      return [["clip"]];
    case "linux":
      return [["wl-copy"], ["xclip", "-selection", "clipboard"]];
    default:
      return [];
  }
}

export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  for (const cmd of clipboardCommands(platform)) {
    try {
      const p = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      p.stdin.write(text);
      await p.stdin.end();
      if ((await p.exited) === 0) return true;
    } catch {
      // Tool missing on PATH (e.g. wl-copy absent on X11) — try the next candidate.
    }
  }
  return false;
}
