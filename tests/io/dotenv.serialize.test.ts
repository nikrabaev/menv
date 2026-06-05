import { describe, expect, test } from "bun:test";
import { parseDotenv, serializeDotenv } from "../../src/io/dotenv.ts";

describe("serializeDotenv", () => {
  test("emits description as a comment above the key", () => {
    const out = serializeDotenv([{ key: "FOO", value: "bar", description: "hi" }]);
    expect(out).toBe("# hi\nFOO=bar\n");
  });

  test("quotes values containing spaces or newlines", () => {
    const out = serializeDotenv([{ key: "A", value: "x y", description: "" }]);
    expect(out).toBe('A="x y"\n');
    const nl = serializeDotenv([{ key: "B", value: "a\nb", description: "" }]);
    expect(nl).toBe('B="a\\nb"\n');
  });

  test("omits value but keeps comment in example mode", () => {
    const out = serializeDotenv([{ key: "SECRET", value: "shh", description: "token" }], { valuesFree: true });
    expect(out).toBe("# token\nSECRET=\n");
  });

  test("renders a group header banner", () => {
    const out = serializeDotenv(
      [{ key: "A", value: "1", description: "", group: "DB" }],
      { groupHeaders: true },
    );
    expect(out).toBe("# ─── DB ───\nA=1\n");
  });

  // --- commented-out variables ("wired but not applied") ---

  test("comments out an inactive entry", () => {
    const out = serializeDotenv([{ key: "FOO", value: "bar", description: "", active: false }]);
    expect(out).toBe("# FOO=bar\n");
  });

  test("keeps the description above a commented-out var", () => {
    const out = serializeDotenv([{ key: "FOO", value: "bar", description: "hi", active: false }]);
    expect(out).toBe("# hi\n# FOO=bar\n");
  });

  test("an explicit active:true entry is uncommented", () => {
    const out = serializeDotenv([{ key: "FOO", value: "bar", description: "", active: true }]);
    expect(out).toBe("FOO=bar\n");
  });

  test("round-trips the active flag through parse∘serialize, including quoting", () => {
    const entries = [
      { key: "A", value: "plain", description: "", active: true },
      { key: "B", value: "x y", description: "note", active: false },
    ];
    const out = serializeDotenv(entries);
    expect(parseDotenv(out)).toEqual([
      { key: "A", value: "plain", description: "", active: true },
      { key: "B", value: "x y", description: "note", active: false },
    ]);
  });
});
