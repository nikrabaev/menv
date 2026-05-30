#!/usr/bin/env bun
const VERSION = "0.1.0";

const [, , cmd] = Bun.argv;
if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}
console.log("menv: not yet implemented");
