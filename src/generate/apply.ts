import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileOp } from "../core/plan.ts";
import { writeFileAtomic } from "../io/write.ts";
import { hasOwnershipMarker, stripDisclaimer } from "./ownership.ts";

// Applies a release/delete file op under the ownership rule: a file without the
// marker (the user took it over) or a missing file is left untouched. `write`
// ops are applied by applyPreview, which already carries the content.
export async function applyFileOp(root: string, op: FileOp): Promise<void> {
  if (op.action === "write") return;
  const abs = join(root, op.path);
  const file = Bun.file(abs);
  if (!(await file.exists())) return;
  if (!hasOwnershipMarker(await file.text())) return;
  if (op.action === "release") {
    await writeFileAtomic(root, op.path, stripDisclaimer(await file.text()));
  } else {
    await rm(abs);
  }
}
