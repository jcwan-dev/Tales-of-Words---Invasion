import { describe, expect, it } from "vitest";
import { combineGate, createCombatContext, createGateState, createUnit, GATE, loseTurn, resetGate } from "../../../src/index.ts";

describe("action gate combination (builder unit tests)", () => {
  it("starts at allow with no reason", () => {
    expect(createGateState()).toEqual({ result: GATE.allow, reason: null });
  });

  it("skip beats redirect beats restrict beats allow, whatever the order of answers", () => {
    const g = createGateState();
    combineGate(g, GATE.restrict, "dimmed");
    expect(g).toEqual({ result: GATE.restrict, reason: "dimmed" });
    combineGate(g, GATE.skip, "stunned");
    combineGate(g, GATE.redirect, "paralysed");
    combineGate(g, GATE.allow, "burning");
    expect(g).toEqual({ result: GATE.skip, reason: "stunned" });
  });

  it("on a tie the first answer keeps the reason", () => {
    const g = createGateState();
    combineGate(g, GATE.skip, "ambushed");
    combineGate(g, GATE.skip, "stunned");
    expect(g.reason).toBe("ambushed");
  });

  it("resetGate goes back to allow", () => {
    const g = createGateState();
    combineGate(g, GATE.skip, "ambushed");
    resetGate(g);
    expect(g).toEqual({ result: GATE.allow, reason: null });
  });

  it("loseTurn combines skip and emits TurnSkipped", () => {
    const ctx = createCombatContext("gate");
    const u = createUnit({ id: "u", side: "enemy", maxHp: 5 });
    const g = createGateState();
    loseTurn(ctx, g, u, "stunned");
    expect(g).toEqual({ result: GATE.skip, reason: "stunned" });
    expect(ctx.events).toEqual([{ type: "TurnSkipped", unit: "u", reason: "stunned" }]);
  });
});
