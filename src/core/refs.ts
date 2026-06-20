import { extractRefs } from "./interpolate.ts";

// Who references ${target}? Used by var/global remove, unwire and vault remove
// to build DEPENDENT_REFERENCE blockers (spec: "Dependency detection"). The
// caller assembles records from every vault it can open; vaults it cannot open
// become UNVERIFIED_REFERENCES warnings at the planning layer.
export interface ValueRecord {
  variable: string;
  vault: string;
  consumer: string;
  raw: string;
}

export interface Dependent {
  variable: string;
  vault: string;
  consumer: string;
}

export function findDependents(target: string, records: Iterable<ValueRecord>): Dependent[] {
  const out: Dependent[] = [];
  for (const r of records) {
    if (extractRefs(r.raw).includes(target)) {
      out.push({ variable: r.variable, vault: r.vault, consumer: r.consumer });
    }
  }
  return out;
}
