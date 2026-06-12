import { MenvError } from "../core/errors.ts";
import { findMarkerRegions } from "../generate/compose.ts";
import { previewGenerate, scopeEntries } from "../generate/generate.ts";
import { hasOwnershipMarker, headerVault } from "../generate/ownership.ts";
import { consumerPaths, envTargets } from "../generate/paths.ts";
import type { Registry } from "../registry/types.ts";
import { resolveVaultAuthOptional } from "../vault/auth.ts";
import type { VaultSession } from "../vault/provider.ts";
import { getProvider } from "../vault/registry.ts";
import type { Io } from "./output.ts";
import { emitResult } from "./output.ts";
import type { MutationFlags } from "./run.ts";

interface Finding {
  severity: "error" | "warning";
  code: string;
  message: string;
}
const err = (code: string, message: string): Finding => ({ severity: "error", code, message });
const warn = (code: string, message: string): Finding => ({ severity: "warning", code, message });

async function gitTracked(root: string): Promise<Set<string> | null> {
  try {
    const proc = Bun.spawn(["git", "-C", root, "ls-files"], { stdout: "pipe", stderr: "ignore" });
    if ((await proc.exited) !== 0) return null;
    const text = await new Response(proc.stdout).text();
    return new Set(text.split("\n").filter((l) => l !== ""));
  } catch {
    return null;
  }
}

// Read-only health gate. Collects every finding, then exits 1 if any is an
// error (the entry point maps the thrown VALIDATION → exit 1, carrying the full
// findings list in details). Warnings never fail the gate.
export async function runCheck(root: string, registry: Registry, flags: MutationFlags, io: Io): Promise<void> {
  const findings: Finding[] = [];
  const sessions = new Map<string, VaultSession>();
  try {
    // Open every vault inside the try so the finally always closes whatever was
    // opened, even if a later vault throws a non-auth error.
    for (const [name, def] of Object.entries(registry.vaults)) {
      try {
        const auth = await resolveVaultAuthOptional(name, { root, flag: flags.vaultAuth[name], env: flags.env });
        sessions.set(name, await getProvider(def.vaultType).init(def.vaultConfig, { root, auth }));
      } catch (e) {
        if (e instanceof MenvError && (e.code === "AUTH_MISSING" || e.code === "AUTH_FAILED")) {
          findings.push(warn("UNVERIFIED_VAULT", `vault "${name}" could not be opened — checks against it skipped`));
        } else throw e;
      }
    }

    // Interpolation, missing values, key existence (MISSING_VALUE) per scope.
    for (const target of envTargets(registry.consumers, registry.defaults, {})) {
      const session = sessions.get(target.vault);
      if (session === undefined) continue;
      const w: { code: string; message: string }[] = [];
      try {
        await scopeEntries(registry, target.consumer, target.vault, session, w);
      } catch (e) {
        if (e instanceof MenvError) findings.push(err("INTERPOLATION", `${target.consumer}/${target.vault}: ${e.message}`));
        else throw e;
      }
      for (const mv of w) findings.push(warn(mv.code, mv.message));
    }

    // Staleness / foreign files, judged against each file's recorded vault.
    const previewCache = new Map<string, Awaited<ReturnType<typeof previewGenerate>>>();
    for (const [consumer, def] of Object.entries(registry.consumers)) {
      const paths = consumerPaths(def);
      const allPaths = [...paths.main, ...paths.local, ...(paths.example !== undefined ? [paths.example] : [])];
      for (const rel of allPaths) {
        const file = Bun.file(`${root}/${rel}`);
        if (!(await file.exists())) continue;
        const content = await file.text();
        if (!hasOwnershipMarker(content)) {
          findings.push(err("FOREIGN_FILE", `${rel} exists but is not menv-managed (no marker)`));
          continue;
        }
        const vault = headerVault(content) ?? registry.defaults.vault;
        const key = `${consumer}|${vault}`;
        let preview = previewCache.get(key);
        if (preview === undefined) {
          try {
            preview = await previewGenerate(root, registry, { consumer, vault }, sessions);
          } catch (e) {
            // A broken ref/cycle already surfaced as INTERPOLATION in the scope
            // loop above; don't let it escape and discard the findings list.
            if (e instanceof MenvError) continue;
            throw e;
          }
          previewCache.set(key, preview);
        }
        if (preview.writes.some((wr) => wr.path === rel)) findings.push(err("STALE", `${rel} differs from what generate would write`));
      }
    }

    // Compose markers ↔ registry.
    for (const cfile of registry.compose.files) {
      const cf = Bun.file(`${root}/${cfile}`);
      if (!(await cf.exists())) {
        findings.push(err("MISSING_COMPOSE_FILE", `registered compose file not found: ${cfile}`));
        continue;
      }
      const { regions, errors } = findMarkerRegions(await cf.text());
      for (const e of errors) findings.push(err("COMPOSE_MARKER", `${cfile}: ${e}`));
      if (regions.length === 0) findings.push(warn("COMPOSE_NO_MARKERS", `${cfile}: bound but has no menv markers`));
      for (const r of regions) {
        if (registry.consumers[r.consumer] === undefined) {
          findings.push(err("COMPOSE_UNKNOWN_CONSUMER", `${cfile}: marker names unknown consumer "${r.consumer}"`));
        }
      }
    }

    // Git-tracking violations.
    const tracked = await gitTracked(root);
    if (tracked === null) {
      findings.push(warn("GIT_UNAVAILABLE", "git not available — tracking checks skipped"));
    } else {
      for (const [name, def] of Object.entries(registry.vaults)) {
        const cfg = def.vaultConfig as { filename?: string; encryption?: boolean };
        if (def.vaultType === "menv-local" && cfg.encryption === false && typeof cfg.filename === "string" && tracked.has(cfg.filename)) {
          findings.push(err("PLAINTEXT_VAULT_TRACKED", `plaintext vault "${name}" file ${cfg.filename} is tracked by git`));
        }
      }
      for (const [consumer, def] of Object.entries(registry.consumers)) {
        const hasSecret = Object.values(registry.variables).some(
          (v) => v.secret === true && Object.values(v.vaultMapping).some((m) => m[consumer] !== undefined),
        );
        if (!hasSecret) continue;
        const paths = consumerPaths(def);
        const split = def.strategyConfig.secretsAsLocalOverrides === true;
        const risky = split ? paths.local : paths.main; // secrets live in .local when split, else in main
        for (const p of risky) {
          if (tracked.has(p)) findings.push(err("SECRET_FILE_TRACKED", `${p} may contain secret values and is tracked by git`));
        }
      }
    }
  } finally {
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
  }

  const errors = findings.filter((f) => f.severity === "error");
  const pretty =
    findings.length === 0
      ? "all checks passed"
      : findings.map((f) => `${f.severity === "error" ? "✖" : "⚠"} ${f.code}: ${f.message}`).join("\n");
  if (errors.length > 0) {
    if (flags.mode === "pretty") io.stdout(`${pretty}\n`);
    throw new MenvError("VALIDATION", `check found ${errors.length} error(s)`, findings);
  }
  emitResult(io, flags.mode, { findings }, pretty);
}
