// Render Formula/menv.rb from the release assets' checksums and push it to the
// Homebrew tap repo. CI-only — needs a token with write access to the tap.
//
//   HOMEBREW_TAP_TOKEN=…  [VERSION=2.0.0]  bun run scripts/update-homebrew.ts
//
// Reads npm/dist/assets/checksums.txt (produced by `bun run build:npm`), so run
// the build first. VERSION defaults to package.json; a leading "v" is stripped.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json";

const VERSION = (process.env.VERSION ?? pkg.version).replace(/^v/, "");
const TOKEN = process.env.HOMEBREW_TAP_TOKEN;
const TAP_REPO = process.env.HOMEBREW_TAP_REPO ?? "nikrabaev/homebrew-tap";
const ROOT = process.cwd();

if (!TOKEN) throw new Error("HOMEBREW_TAP_TOKEN is required");

async function run(cmd: string[], display = cmd.join(" ")): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  // `display` lets callers redact secrets (e.g. tokens in clone/push URLs).
  if (code !== 0) throw new Error(`command failed (exit ${code}): ${display}`);
}

// checksums.txt lines: "<sha256>  <asset>"
const checksums = new Map<string, string>();
const text = await Bun.file(`${ROOT}/npm/dist/assets/checksums.txt`).text();
for (const line of text.trim().split("\n")) {
  const [sha, asset] = line.trim().split(/\s+/);
  if (sha && asset) checksums.set(asset, sha);
}

function shaFor(asset: string): string {
  const sha = checksums.get(asset);
  if (!sha) throw new Error(`no checksum for ${asset} in npm/dist/assets/checksums.txt`);
  return sha;
}

const template = await Bun.file(`${ROOT}/scripts/homebrew-formula.rb.tmpl`).text();
const formula = template
  .replaceAll("{{VERSION}}", VERSION)
  .replaceAll("{{SHA_DARWIN_ARM64}}", shaFor("menv-darwin-arm64"))
  .replaceAll("{{SHA_DARWIN_X64}}", shaFor("menv-darwin-x64"))
  .replaceAll("{{SHA_LINUX_ARM64}}", shaFor("menv-linux-arm64"))
  .replaceAll("{{SHA_LINUX_X64}}", shaFor("menv-linux-x64"));

const work = mkdtempSync(join(tmpdir(), "menv-tap-"));
const authUrl = `https://x-access-token:${TOKEN}@github.com/${TAP_REPO}.git`;
const safeUrl = `https://github.com/${TAP_REPO}.git`;
try {
  await run(["git", "clone", "--depth", "1", authUrl, work], `git clone ${safeUrl}`);
  await Bun.write(`${work}/Formula/menv.rb`, formula);
  await run(["git", "-C", work, "add", "Formula/menv.rb"]);

  const status = Bun.spawnSync(["git", "-C", work, "status", "--porcelain"]).stdout.toString().trim();
  if (!status) {
    console.log(`homebrew: Formula/menv.rb already at ${VERSION} — nothing to push`);
  } else {
    await run([
      "git", "-C", work,
      "-c", "user.name=menv-release",
      "-c", "user.email=menv-release@users.noreply.github.com",
      "commit", "-m", `menv ${VERSION}`,
    ]);
    await run(["git", "-C", work, "push"], `git push ${safeUrl}`);
    console.log(`homebrew: pushed menv ${VERSION} to ${TAP_REPO}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
