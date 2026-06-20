#!/usr/bin/env node
"use strict";

// Plain-Node launcher for @nikrabaev/menv.
//
// menv is a Bun program shipped as self-contained, per-platform compiled
// binaries (the Bun runtime is embedded — end users need neither Bun nor Node's
// help to run it). npm install pulls in exactly one matching platform package
// via os/cpu-gated optionalDependencies; this shim resolves that binary and
// hands off to it, forwarding argv, stdio (the TUI needs the real TTY), and the
// exit code / terminating signal.
//
// This file is intentionally CommonJS Node — it is the only part of the project
// that must run without Bun. Do not import Bun APIs here.

const { spawnSync } = require("node:child_process");

// `${process.platform} ${process.arch}` -> platform package name.
const PLATFORM_PACKAGES = {
  "darwin arm64": "@nikrabaev/menv-darwin-arm64",
  "darwin x64": "@nikrabaev/menv-darwin-x64",
  "linux arm64": "@nikrabaev/menv-linux-arm64",
  "linux x64": "@nikrabaev/menv-linux-x64",
  "win32 x64": "@nikrabaev/menv-win32-x64",
};

function resolveBinary() {
  const key = `${process.platform} ${process.arch}`;
  const pkg = PLATFORM_PACKAGES[key];
  if (!pkg) {
    throw new Error(
      `menv has no prebuilt binary for ${key}.\n` +
        `Supported platforms: ${Object.keys(PLATFORM_PACKAGES).join(", ")}.\n` +
        `Run from source with Bun instead: https://github.com/nikrabaev/menv`,
    );
  }
  const exe = process.platform === "win32" ? "menv.exe" : "menv";
  try {
    // No `exports` field on the platform package, so the subpath resolves
    // straight to the binary file on disk.
    return require.resolve(`${pkg}/bin/${exe}`);
  } catch {
    throw new Error(
      `menv's platform package "${pkg}" is not installed.\n` +
        `This usually means optional dependencies were skipped at install time.\n` +
        `Reinstall without omitting them:\n` +
        `  npm install -g @nikrabaev/menv\n` +
        `(avoid --no-optional / --omit=optional and lockfiles that filtered it out).`,
    );
  }
}

let binary;
try {
  binary = resolveBinary();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  process.stderr.write(`menv: failed to launch binary: ${result.error.message}\n`);
  process.exit(1);
}
if (result.signal) {
  // Re-raise so the parent shell observes the real termination cause.
  process.kill(process.pid, result.signal);
}
process.exit(result.status === null ? 1 : result.status);
