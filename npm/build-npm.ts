// Release build: cross-compile per-platform binaries and assemble the npm
// launcher + platform packages, version-stamped from package.json.
//
// Run under Bun from the repo root:  bun run build:npm
//
// Output (git-ignored) lands under npm/dist/:
//   npm/dist/menv/             the @nikrabaev/menv launcher package (bin + README)
//   npm/dist/menv-<os>-<cpu>/  one platform package per target (os/cpu-gated, one binary)
//   npm/dist/assets/           uniquely-named binaries + checksums.txt for the GitHub Release
//
// The compiled binary reads its own version from package.json at build time
// (src/cli/program.ts imports it, Bun inlines it into the executable), so
// package.json is the single source of truth: release-please bumps it and both
// the binary and every generated package follow. Platform packages are published
// BEFORE the launcher (its optionalDependencies pin them at the exact version).

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import pkg from "../package.json";

const SCOPE = "@nikrabaev";
const ROOT = process.cwd();
const DIST = `${ROOT}/npm/dist`;
const ASSETS = `${DIST}/assets`;
const VERSION = pkg.version;

type Target = {
  triple: string;
  os: "darwin" | "linux" | "win32";
  cpu: "arm64" | "x64";
  exe: "menv" | "menv.exe";
  asset: string;
};

const TARGETS: Target[] = [
  { triple: "bun-darwin-arm64", os: "darwin", cpu: "arm64", exe: "menv", asset: "menv-darwin-arm64" },
  { triple: "bun-darwin-x64", os: "darwin", cpu: "x64", exe: "menv", asset: "menv-darwin-x64" },
  { triple: "bun-linux-arm64", os: "linux", cpu: "arm64", exe: "menv", asset: "menv-linux-arm64" },
  { triple: "bun-linux-x64", os: "linux", cpu: "x64", exe: "menv", asset: "menv-linux-x64" },
  { triple: "bun-windows-x64", os: "win32", cpu: "x64", exe: "menv.exe", asset: "menv-windows-x64.exe" },
];

const platformPackage = (t: Target): string => `${SCOPE}/menv-${t.os}-${t.cpu}`;

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`command failed (exit ${code}): ${cmd.join(" ")}`);
}

async function sha256(path: string): Promise<string> {
  const buf = await Bun.file(path).arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(buf).digest("hex");
}

if (!(await Bun.file(`${ROOT}/src/index.ts`).exists())) {
  throw new Error(`run from the repo root (src/index.ts not found under ${ROOT})`);
}

console.log(`menv: building npm packages for v${VERSION}`);
rmSync(DIST, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });

const template = await Bun.file(`${ROOT}/npm/platform/template.package.json`).text();
const checksums: string[] = [];

for (const t of TARGETS) {
  const pkgDir = `${DIST}/menv-${t.os}-${t.cpu}`;
  const binPath = `${pkgDir}/bin/${t.exe}`;
  mkdirSync(`${pkgDir}/bin`, { recursive: true });

  console.log(`  • ${platformPackage(t)}  (${t.triple})`);
  await run(["bun", "build", "--compile", `--target=${t.triple}`, "--outfile", binPath, "src/index.ts"]);
  if (t.exe === "menv") chmodSync(binPath, 0o755);

  await Bun.write(
    `${pkgDir}/package.json`,
    template
      .replaceAll("{{NAME}}", platformPackage(t))
      .replaceAll("{{VERSION}}", VERSION)
      .replaceAll("{{OS}}", t.os)
      .replaceAll("{{CPU}}", t.cpu)
      .replaceAll("{{EXE}}", t.exe),
  );

  // uniquely-named copy for the GitHub Release + its checksum
  const assetPath = `${ASSETS}/${t.asset}`;
  await Bun.write(assetPath, Bun.file(binPath));
  checksums.push(`${await sha256(assetPath)}  ${t.asset}`);
}

// launcher: stamp the version and pin every platform package to it
const launcherDir = `${DIST}/menv`;
mkdirSync(`${launcherDir}/bin`, { recursive: true });
const launcher = JSON.parse(await Bun.file(`${ROOT}/npm/launcher/package.json`).text());
launcher.version = VERSION;
launcher.optionalDependencies = Object.fromEntries(TARGETS.map((t) => [platformPackage(t), VERSION]));
await Bun.write(`${launcherDir}/package.json`, `${JSON.stringify(launcher, null, 2)}\n`);
await Bun.write(`${launcherDir}/bin/menv.js`, Bun.file(`${ROOT}/npm/launcher/bin/menv.js`));
await Bun.write(`${launcherDir}/README.md`, Bun.file(`${ROOT}/npm/launcher/README.md`));

await Bun.write(`${ASSETS}/checksums.txt`, `${checksums.join("\n")}\n`);

console.log(`menv: done → ${DIST}`);
console.log(`  launcher : ${SCOPE}/menv@${VERSION}`);
console.log(`  platforms: ${TARGETS.map((t) => `${t.os}-${t.cpu}`).join(", ")}`);
console.log(`  assets   : ${ASSETS}/ (+ checksums.txt)`);
