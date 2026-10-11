import { describe, expect, it } from "vitest";
import { HOOK_NAMES, STATUS_IDS, statusDef, statusIndex, statusModule, type HookName, type StatusId } from "../../../src/index.ts";
import { DISPATCH_ORDER, GATE_HOOKS, HIT_HOOKS, TAGGED, TURN_HOOKS } from "../../../src/combat/statuses/registry.ts";

// The hooks each status must implement (spec: Status list "Hook" column; Turn details; Stacking).
const EXPECTED: Record<StatusId, readonly HookName[]> = {
  burning: ["onTurnStart"],
  poisoned: ["onTurnStart"],
  bleeding: ["onTurnStart"], // spec 1.5: no onTookDamage (Bleed power replaced the +1 on a physical hit)
  stunned: ["gateAction"],
  paralysed: ["gateAction"],
  ambushed: ["gateAction"],
  enfeebled: ["modifyOutgoing", "onTurnEnd"],
  dimmed: ["modifyOutgoing", "onTurnEnd"],
  emboldened: ["modifyOutgoing", "onTurnEnd"],
  kindled: ["modifyOutgoing", "onTurnEnd"],
  warded: ["modifyIncoming"],
  thorns: ["onAttacked", "onTurnEnd"],
  leeching: ["onDealtDamage", "onTurnEnd"],
  piercing: ["modifyOutgoing"],
};

const ids = (list: readonly { id: StatusId }[]): StatusId[] => list.map((e) => e.id);

describe("status registry (builder unit tests)", () => {
  it("every status is registered under its own id", () => {
    for (const id of STATUS_IDS) expect(statusModule(id).def.id).toBe(id);
  });

  it("each status implements exactly its hooks", () => {
    for (const id of STATUS_IDS) {
      const hooks = statusModule(id).hooks;
      expect(HOOK_NAMES.filter((n) => hooks[n] !== undefined)).toEqual(EXPECTED[id]);
    }
  });

  it("orders come from data: turn start Burning, Bleeding, Poisoned; gate Ambushed, Stunned, Paralysed", () => {
    expect(ids(TURN_HOOKS.onTurnStart)).toEqual(["burning", "bleeding", "poisoned"]);
    expect(ids(GATE_HOOKS)).toEqual(["ambushed", "stunned", "paralysed"]);
    // Ticking decay at turn end: every ticking status except damage over time.
    expect(ids(TURN_HOOKS.onTurnEnd).sort()).toEqual(["dimmed", "emboldened", "enfeebled", "kindled", "leeching", "thorns"]);
  });

  it("dispatch order sorts by priority, ties in STATUS_IDS order; every list follows it", () => {
    const pos = (id: StatusId): number => DISPATCH_ORDER.indexOf(id);
    for (let k = 1; k < DISPATCH_ORDER.length; k++) {
      const a = DISPATCH_ORDER[k - 1] as StatusId;
      const b = DISPATCH_ORDER[k] as StatusId;
      const pa = statusDef(a).priority;
      const pb = statusDef(b).priority;
      expect(pa < pb || (pa === pb && STATUS_IDS.indexOf(a) < STATUS_IDS.indexOf(b))).toBe(true);
    }
    const lists = [...Object.values(HIT_HOOKS), ...Object.values(TURN_HOOKS), GATE_HOOKS];
    for (const list of lists) {
      const order = list.map((e) => pos(e.id));
      expect(order).toEqual([...order].sort((x, y) => x - y));
      for (const e of list) expect(e.index).toBe(statusIndex(e.id));
    }
  });

  it("buffs are never resisted; debuffs always are", () => {
    for (const id of STATUS_IDS) {
      const def = statusDef(id);
      if (def.kind === "buff") expect(def.resistedBy).toEqual([]);
      else expect(def.resistedBy.length).toBeGreaterThan(0);
    }
  });

  it("no status implements onTookDamage any more (the hook point stays for later effects)", () => {
    expect(HIT_HOOKS.onTookDamage).toEqual([]);
  });

  it("the dot tag index lists exactly Burning, Bleeding and Poisoned", () => {
    expect([...TAGGED.dot].sort()).toEqual((["burning", "bleeding", "poisoned"] as const).map((id) => statusIndex(id)).sort());
    for (const id of STATUS_IDS) expect(TAGGED.dot.includes(statusIndex(id))).toBe(statusDef(id).tags.includes("dot"));
  });
});
