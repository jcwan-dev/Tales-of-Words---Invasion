import { describe, expect, it } from "vitest";
import { createCombatContext, createUnit, fireTriggers, TRIGGER_DEPTH_CAP, type ConvertTrigger } from "../../../src/index.ts";

// The recursion guard can't be reached through today's triggers (a gained status sets off nothing),
// so it is tested directly by presetting the context's depth, as a nested trigger would.

const holder = (...converts: ConvertTrigger[]) => createUnit({ id: "u", side: "enemy", maxHp: 10, traits: { converts } });

describe("trigger depth guard (builder unit tests)", () => {
  it("the cap is 4", () => {
    expect(TRIGGER_DEPTH_CAP).toBe(4);
  });

  it("outside any trigger, a trigger fires at depth 1 and the depth goes back to 0", () => {
    const ctx = createCombatContext("guard");
    const u = holder({ on: "attacked", gain: "thorns", stacks: 2 });
    fireTriggers(ctx, u, "attacked");
    expect(ctx.events).toEqual([
      { type: "TriggerFired", unit: "u", on: "attacked", gain: "thorns", stacks: 2, depth: 1 },
      { type: "StatusApplied", unit: "u", status: "thorns", stacks: 2, total: 2 },
    ]);
    expect(ctx.triggerDepth).toBe(0);
  });

  it("inside a depth-3 trigger, a trigger fires at depth 4 (the last allowed) and depth is restored to 3", () => {
    const ctx = createCombatContext("guard");
    ctx.triggerDepth = 3;
    fireTriggers(ctx, holder({ on: "deflect", gain: "kindled", stacks: 1 }), "deflect");
    expect(ctx.events[0]).toMatchObject({ type: "TriggerFired", depth: 4 });
    expect(ctx.triggerDepth).toBe(3);
  });

  it("inside a depth-4 trigger, a trigger is ignored: TriggerCapped (depth 5), no gain", () => {
    const ctx = createCombatContext("guard");
    ctx.triggerDepth = 4;
    const u = holder({ on: "tookDamage", gain: "kindled", stacks: 1 }, { on: "tookDamage", gain: "thorns", stacks: 1 });
    fireTriggers(ctx, u, "tookDamage");
    expect(ctx.events).toEqual([
      { type: "TriggerCapped", unit: "u", on: "tookDamage", depth: 5 },
      { type: "TriggerCapped", unit: "u", on: "tookDamage", depth: 5 },
    ]);
    expect(u.statuses.has("kindled")).toBe(false);
    expect(ctx.triggerDepth).toBe(4);
  });

  it("only converts for the given event fire, in the order listed; a fallen unit fires none", () => {
    const ctx = createCombatContext("guard");
    const u = holder({ on: "attacked", gain: "kindled", stacks: 1 }, { on: "deflect", gain: "thorns", stacks: 1 }, { on: "attacked", gain: "emboldened", stacks: 2 });
    fireTriggers(ctx, u, "attacked");
    expect(ctx.events.filter((e) => e.type === "TriggerFired").map((e) => (e.type === "TriggerFired" ? e.gain : null))).toEqual(["kindled", "emboldened"]);
    const dead = createUnit({ id: "d", side: "enemy", maxHp: 10, hp: 0, traits: { converts: [{ on: "attacked", gain: "kindled", stacks: 1 }] } });
    const before = ctx.events.length;
    fireTriggers(ctx, dead, "attacked");
    expect(ctx.events.length).toBe(before);
  });

  it("a unit without converts fires nothing", () => {
    const ctx = createCombatContext("guard");
    fireTriggers(ctx, createUnit({ id: "u", side: "enemy", maxHp: 10 }), "attacked");
    expect(ctx.events).toEqual([]);
  });
});
