import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { encryptToRecipients, decryptWithIdentity } from "./age.ts";

function vaultPath(root: string, env: string): string {
  return join(root, ".menv", "values", `${env}.env.age`);
}

export async function saveEnvValues(
  root: string,
  env: string,
  values: Record<string, string>,
  recipients: string[],
): Promise<void> {
  const ct = await encryptToRecipients(JSON.stringify(values), recipients);
  await mkdir(join(root, ".menv", "values"), { recursive: true });
  await Bun.write(vaultPath(root, env), ct);
}

export async function loadEnvValues(
  root: string,
  env: string,
  identity: string,
): Promise<Record<string, string>> {
  const file = Bun.file(vaultPath(root, env));
  if (!(await file.exists())) return {};
  const ct = new Uint8Array(await file.arrayBuffer());
  const text = await decryptWithIdentity(ct, identity);
  return JSON.parse(text) as Record<string, string>;
}
