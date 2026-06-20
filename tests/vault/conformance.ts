import { describe, expect, test } from "bun:test";
import type { VaultSession } from "../../src/vault/provider.ts";

export interface ConformanceTarget {
  label: string;
  // Returns a fresh, empty backing store per call; open() may be called
  // multiple times against the same store (persistence checks).
  create(): Promise<{ open(): Promise<VaultSession> }>;
}

// Every VaultProvider must pass this suite (spec: "Provider conformance
// suite"). Future providers import it and add one runVaultConformance call.
export function runVaultConformance(target: ConformanceTarget): void {
  describe(`vault conformance: ${target.label}`, () => {
    test("get on a missing key returns undefined", async () => {
      const t = await target.create();
      const s = await t.open();
      expect(await s.get("missing")).toBeUndefined();
      await s.close();
    });

    test("set → get round-trips, including empty string", async () => {
      const t = await target.create();
      const s = await t.open();
      await s.set("a", "1");
      await s.set("empty", "");
      expect(await s.get("a")).toBe("1");
      expect(await s.get("empty")).toBe("");
      await s.close();
    });

    test("list returns sorted keys", async () => {
      const t = await target.create();
      const s = await t.open();
      await s.set("b", "2");
      await s.set("a", "1");
      expect(await s.list()).toEqual(["a", "b"]);
      await s.close();
    });

    test("remove deletes; removing a missing key is a no-op", async () => {
      const t = await target.create();
      const s = await t.open();
      await s.set("a", "1");
      await s.remove("a");
      await s.remove("never-existed");
      expect(await s.get("a")).toBeUndefined();
      expect(await s.list()).toEqual([]);
      await s.close();
    });

    test("values persist across sessions", async () => {
      const t = await target.create();
      const s1 = await t.open();
      await s1.set("a", "1");
      await s1.close();
      const s2 = await t.open();
      expect(await s2.get("a")).toBe("1");
      await s2.close();
    });
  });
}
