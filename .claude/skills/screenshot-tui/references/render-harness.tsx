// TEMPORARY screenshot harness. Copy this to tests/ui/_shot.test.tsx, edit the
// demo model to taste, run `bun test tests/ui/_shot.test.tsx`, then DELETE it.
//
// Why a bun:test file rather than `bun run`? MenvApp uses React hooks, and Ink
// must resolve the SAME React instance as the component. `bun test` loads the
// project's module graph the way the existing tests/ui/*.test.tsx do, so React
// resolves once. A standalone `bun run` script tends to pull a second React copy
// and dies with "Invalid hook call" / renders an empty frame.
//
// This drives the REAL MenvApp — the screenshot is the actual component, not a
// mock-up. The model below is illustrative sample data; swap in whatever best
// shows the feature you're documenting.
import { test } from "bun:test";
import { render } from "ink-testing-library";
import { MenvApp } from "../../src/ui/app.tsx";
import { createStore } from "../../src/store/store.ts";
import type { RepoModel, Variable, Consumer, Wiring } from "../../src/core/types.ts";

// EDIT: where the captured frame is written. ansi2svg.ts reads this path.
const OUT = "/tmp/menv-shot/frame.ansi";

// EDIT: viewport. Make it wide enough that all three panes render fully — menv's
// panes are scopes(40) + variables(flex) + inspector(60), so < ~150 columns
// clips the inspector. Rows should exceed the variable count so nothing scrolls.
const COLUMNS = 152;
const ROWS = 28;

const v = (
  name: string,
  group: string | null,
  secret: boolean,
  consumers: string[],
  description = "",
  example?: string,
): Variable => ({
  id: `var:${name}`, name, description, group, secret,
  // Wired to every listed consumer, applied in every environment.
  wiring: consumers.map((c) => ({ consumer: c })), example,
});

// A variable wired to its consumers but NOT applied in the given environments: it
// generates commented-out there (`# KEY=value`) and shows a dimmed `# value` in the
// list. This is what `init`/drift infer for a key present in one `.env.<env>` but
// missing from (or commented in) another.
const vOff = (
  name: string,
  group: string | null,
  consumers: string[],
  unapplied: string[],
  description = "",
): Variable => ({
  id: `var:${name}`, name, description, group, secret: false,
  wiring: consumers.map((c): Wiring => ({ consumer: c, unapplied })),
});

// EDIT: the demo data. These two apps + a dozen variables exercise grouping,
// wiring vs. applied (the commented `vOff` row), secrets, single vs. per-env file
// mode, and an unset value.
const WEB = "app:web";
const API = "app:api";

function demoModel(): RepoModel {
  const consumers: Consumer[] = [
    { kind: "app", id: WEB, name: "web", path: "apps/web", envFile: ".env", envMode: "single" },
    // api keeps per-environment files (.env.dev / .env.prod) — tagged "per-env".
    { kind: "app", id: API, name: "api", path: "apps/api", envFile: ".env", envMode: "perenv" },
  ];

  const variables: Variable[] = [
    v("DATABASE_URL", "Database", true, [WEB, API], "Primary Postgres connection string", "postgres://localhost:5432/app"),
    v("REDIS_URL", "Database", true, [WEB, API], "Cache + job queue", "redis://localhost:6379/0"),
    v("LOG_LEVEL", "Observability", false, [WEB, API], "debug | info | warn | error", "info"),
    v("SENTRY_DSN", "Observability", true, [WEB, API], "Error reporting endpoint"),
    v("STRIPE_PUBLISHABLE_KEY", "Payments", false, [WEB], "Browser-safe Stripe key", "pk_test_..."),
    v("STRIPE_SECRET_KEY", "Payments", true, [WEB], "Server-side Stripe key"),
    v("JWT_SECRET", "Secrets", true, [API], "Signs session tokens"),
    v("OPENAI_API_KEY", "Secrets", true, [API], "LLM access"),
    v("SESSION_SECRET", "Secrets", true, [WEB], "Cookie signing key"),
    v("NEXT_PUBLIC_API_URL", "Runtime", false, [WEB], "Public API base URL", "https://api.example.com"),
    v("PORT", "Runtime", false, [API], "HTTP listen port", "8080"),
    v("CONCURRENCY", "Runtime", false, [API], "Background job pool size", "8"),
    // Wired but not applied in dev: renders as a dimmed, commented `# on`.
    vOff("EDGE_CACHE", "Runtime", [WEB, API], ["dev"], "Prod-only — commented out in dev"),
  ];

  const values: RepoModel["values"] = {
    "var:DATABASE_URL": { dev: "postgres://acme:s3cr3t@db:5432/app", prod: "postgres://acme@prod-db/app" },
    "var:REDIS_URL": { dev: "redis://cache:6379/0", prod: "redis://prod-cache:6379/0" },
    "var:LOG_LEVEL": { dev: "debug", prod: "info" },
    "var:SENTRY_DSN": { dev: "https://2f9c@o42.ingest.sentry.io/7" },
    "var:STRIPE_PUBLISHABLE_KEY": { dev: "pk_live_51QkD9aBcDeFgHiJ" },
    "var:STRIPE_SECRET_KEY": { dev: "sk_live_51QkD9aBcDeFgHiJ" },
    "var:JWT_SECRET": { dev: "9f8a7b6c5d4e3f2a1b0c8d7e6f5a4b3c" },
    "var:OPENAI_API_KEY": { dev: "sk-proj-AbCdEfGhIjKlMnOpQrStUv" },
    "var:SESSION_SECRET": {}, // unset on purpose — renders the gray "empty" placeholder
    "var:NEXT_PUBLIC_API_URL": { dev: "https://api.acme.dev" },
    "var:PORT": { dev: "8080" },
    "var:CONCURRENCY": { dev: "8" },
    "var:EDGE_CACHE": { dev: "on", prod: "on" },
  };

  return {
    root: "/Users/you/acme",
    environments: [
      { id: "dev", isDefault: true },
      { id: "prod", isDefault: false },
    ],
    variables,
    consumers,
    values,
    recipients: ["age1ql3z7..."],
    keyBackend: { kind: "keychain" },
  };
}

test("capture screenshot frame", async () => {
  const store = createStore(demoModel());
  const { lastFrame, frames } = render(
    <MenvApp store={store} onSaveStamp={() => "s"} viewportRows={ROWS} viewportColumns={COLUMNS} />,
  );
  // The variable list re-measures its value column on mount (rowWidth 0 -> real),
  // so the first frame differs from the settled one. Wait, then pick the last
  // frame whose line count equals the viewport height — a clean, untorn frame.
  await new Promise((r) => setTimeout(r, 500));
  const clean = [...frames].reverse().find((f) => f.split("\n").length === ROWS) ?? lastFrame() ?? "";
  await Bun.write(OUT, clean);
});
