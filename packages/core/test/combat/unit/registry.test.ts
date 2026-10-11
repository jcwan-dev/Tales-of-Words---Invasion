import { describe, expect, it } from "vitest";
import { HIT_HOOK_NAMES, STATUS_IDS, statusDef, statusIndex, statusModule, type HitHookName, type StatusId } from "../../../src/index.ts";
import { HIT_HOOKS } from "../../../src/combat/statuses/registry.ts";

// Which hit hook each status active in M1.1 must implement (spec: Status list, "Hook" column).
const ACTIVE: Partial<Record<StatusId, HitHookName>> = {
  emboldened: "modifyOutgoing",
  enfeebled: "modifyOutgoing",
  kindled: "modifyOutgoing",
  dimmed: "modifyOutgoing",
  piercing: "modifyOutgoing",
  thorns: "onAttacked",
  warded: "modifyIncoming",
  leeching: "onDealtDamage",
  bleeding: "onTookDamage",
};

describe("status registry (builder unit tests)", () => {
  it("every status is registered under its own id", () => {
    for (const id of STATUS_IDS) expect(statusModule(id).def.id).toBe(id);
  });

  it("each active status implements exactly its hit hook; the others have none yet", () => {
    for (const id of STATUS_IDS) {
      const hooks = statusModule(id).hooks;
      const implemented = HIT_HOOK_NAMES.filter((n) => hooks[n] !== undefined);
      const expected = ACTIVE[id];
      expect(implemented).toEqual(expected === undefined ? [] : [expected]);
    }
  });

  it("pre-sorted hook lists hold exactly the statuses that implement each hook, in STATUS_IDS order", () => {
    for (const name of HIT_HOOK_NAMES) {
      const expected = STATUS_IDS.filter((id) => statusModule(id).hooks[name] !== undefined).map(statusIndex);
      expect(HIT_HOOKS[name].map((e) => e.index)).toEqual(expected);
    }
  });

  it("buffs are never resisted", () => {
    for (const id of STATUS_IDS) {
      const def = statusDef(id);
      if (def.kind === "buff") expect(def.resistedBy).toEqual([]);
      else expect(def.resistedBy.length).toBeGreaterThan(0);
    }
  });
});
