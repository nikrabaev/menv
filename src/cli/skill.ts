// The menv-usage agent skill, embedded at build time from its canonical source.
// Importing `with { type: "text" }` makes Bun inline the file's contents as a
// string AND bundle it into the standalone `./menv` (`bun build --compile`), so the
// compiled binary can scaffold the skill — not just `bun run menv`.
import skillMd from "../../skills/menv-usage/SKILL.md" with { type: "text" };

// Where `menv init` scaffolds the skill inside a consumer repo, following the
// `.claude/skills/<name>/SKILL.md` convention agents discover.
export const SKILL_REL_PATH = ".claude/skills/menv-usage/SKILL.md";

// Single source of truth: skills/menv-usage/SKILL.md (never hand-copied here).
export const SKILL_CONTENT: string = skillMd;
