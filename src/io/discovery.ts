import { join, relative, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AppTarget } from "../core/types.ts";

async function readJson(path: string): Promise<any | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  try { return JSON.parse(await f.text()); } catch { return null; }
}

async function workspaceGlobs(root: string): Promise<string[]> {
  const pnpm = Bun.file(join(root, "pnpm-workspace.yaml"));
  if (await pnpm.exists()) {
    const doc = parseYaml(await pnpm.text());
    if (Array.isArray(doc?.packages)) return doc.packages as string[];
  }
  const pkg = await readJson(join(root, "package.json"));
  if (Array.isArray(pkg?.workspaces)) return pkg.workspaces as string[];
  if (Array.isArray(pkg?.workspaces?.packages)) return pkg.workspaces.packages as string[];
  return [];
}

export async function detectApps(root: string): Promise<AppTarget[]> {
  const globs = await workspaceGlobs(root);
  const apps: AppTarget[] = [];
  const seen = new Set<string>();
  for (const g of globs) {
    const glob = new Bun.Glob(`${g}/package.json`);
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      const pkgPath = join(root, rel);
      if (seen.has(pkgPath)) continue;
      seen.add(pkgPath);
      const pkg = await readJson(pkgPath);
      if (!pkg) continue;
      const dir = dirname(rel);
      apps.push({
        kind: "app",
        id: `app:${pkg.name ?? dir}`,
        name: pkg.name ?? dir,
        path: relative(root, join(root, dir)) || ".",
        envFiles: {},
      });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}
