import { join } from "node:path";
import { writeFileAtomic } from "./write.ts";

const BEGIN = "# menv (managed block)";
const END = "# end menv";

// Idempotently maintain menv's block in .gitignore: entries are unioned (set
// semantics, original order kept), user lines outside the block are untouched.
export async function upsertManagedBlock(root: string, entries: string[]): Promise<void> {
  const file = Bun.file(join(root, ".gitignore"));
  const text = (await file.exists()) ? await file.text() : "";
  const lines = text.split("\n");
  const begin = lines.indexOf(BEGIN);
  const end = begin === -1 ? -1 : lines.indexOf(END, begin);

  const existing = begin !== -1 && end !== -1 ? lines.slice(begin + 1, end) : [];
  const merged = [...existing];
  for (const e of entries) if (!merged.includes(e)) merged.push(e);
  const block = [BEGIN, ...merged, END];

  let out: string[];
  if (begin !== -1 && end !== -1) {
    out = [...lines.slice(0, begin), ...block, ...lines.slice(end + 1)];
  } else {
    const head = text === "" ? [] : [...lines.slice(0, lines.at(-1) === "" ? -1 : lines.length), ""];
    out = [...head, ...block, ""];
  }
  await writeFileAtomic(root, ".gitignore", out.join("\n"));
}
