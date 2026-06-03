import type { EnvFileMode } from "../core/types.ts";
import type { KeyBackend } from "../crypto/identity.ts";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { defaultEnv, loadModel, resolveConsumer } from "./context.ts";

export interface ModeOpts {
  backend?: KeyBackend;
  env?: string;
  stamp?: string;
}

// Set a consumer's .env file layout: "single" (one `.env`) or "perenv" (one
// `.env.<env>` per environment). Regenerates the consumer's files on save.
export async function runMode(root: string, consumer: string, mode: EnvFileMode, opts: ModeOpts = {}): Promise<void> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const cid = resolveConsumer(model, consumer);
  const store = createStore(model);
  store.setEnvMode(cid, mode);
  await saveModel(store.getModel(), defaultEnv(model, opts.env), opts.stamp ?? "mode");
}
