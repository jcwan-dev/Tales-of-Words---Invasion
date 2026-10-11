import { describe, expect, it } from "vitest";
import { endTurn, resolveAttack, resolveHit, startTurn, type AttackSpec, type CombatUnit } from "../../src/index.ts";
import { enemy, fight, pass, phys, player } from "./turn-helpers.ts";

// Spec 1.4, Turn details, "Cooldowns": a skill with cooldown N can't be used on its owner's next N turns.
// Cooldown 1: used on turn 1, not ready on turn 2, ready on turn 3. Counters go down at the end of each
// of the owner's turns, skipped turns included, except on the turn the skill was used.

const card = (cardId: string, cooldown: number): AttackSpec => ({ hits: [phys(1)], cardId, cooldown });

/** Player-first fight against a sturdy enemy; returns helpers to run the player's turns. */
function setup(over: Parameters<typeof player>[0] = {}) {
  const p = player({ maxHp: 200, ...over });
  const e = enemy("e", { maxHp: 500 });
  const f = fight([p, e]);
  /** Runs one full round: the player's turn (calling act if the turn is not lost), then the enemy's. */
  const round = (act?: () => void, enemyAct?: () => void): boolean => {
    const acts = startTurn(f.state);
    if (acts && act) act();
    endTurn(f.state);
    const enemyActs = startTurn(f.state);
    if (enemyActs && enemyAct) enemyAct();
    endTurn(f.state);
    return acts;
  };
  const use = (spec: AttackSpec) => () => resolveAttack(f.ctx, p, e, spec);
  return { p, e, ...f, round, use };
}

describe("Cooldowns", () => {
  it("a card never used is ready (remaining 0)", () => {
    const p = player();
    expect(p.cooldowns.remaining("cleave")).toBe(0);
    expect(p.cooldowns.ready("cleave")).toBe(true);
  });

  it("resolveAttack with cardId and cooldown N sets the counter to N right away", () => {
    const { p, ctx, e, state } = setup();
    startTurn(state);
    resolveAttack(ctx, p, e, card("cleave", 2));
    expect(p.cooldowns.remaining("cleave")).toBe(2);
    expect(p.cooldowns.ready("cleave")).toBe(false);
    // Only the attacker's cooldowns change.
    expect(e.cooldowns.remaining("cleave")).toBe(0);
  });

  it("cooldown 1: used on turn 1, not ready on turn 2, ready on turn 3", () => {
    const { p, round, use } = setup();
    const readyAtStart: boolean[] = [];
    const remainingAfter: number[] = [];
    // Turn 1: use it.
    readyAtStart.push(p.cooldowns.ready("c"));
    round(use(card("c", 1)));
    remainingAfter.push(p.cooldowns.remaining("c")); // not ticked on the use turn: 1
    // Turn 2
    readyAtStart.push(p.cooldowns.ready("c"));
    round();
    remainingAfter.push(p.cooldowns.remaining("c")); // 1 -> 0
    // Turn 3
    readyAtStart.push(p.cooldowns.ready("c"));
    expect(readyAtStart).toEqual([true, false, true]);
    expect(remainingAfter).toEqual([1, 0]);
  });

  it("cooldown 2: used on turn 1, not ready on turns 2 and 3, ready on turn 4", () => {
    const { p, round, use } = setup();
    const readyAtStart: boolean[] = [];
    const remainingAfter: number[] = [];
    for (let turn = 1; turn <= 4; turn++) {
      readyAtStart.push(p.cooldowns.ready("c"));
      round(turn === 1 ? use(card("c", 2)) : undefined);
      remainingAfter.push(p.cooldowns.remaining("c"));
    }
    // End of turn 1: 2 (use turn), turn 2: 1, turn 3: 0, turn 4: 0
    expect(readyAtStart).toEqual([true, false, false, true]);
    expect(remainingAfter).toEqual([2, 1, 0, 0]);
  });

  it("the counter does not tick at other units' turn ends", () => {
    const { p, state, ctx, e } = setup();
    startTurn(state);
    resolveAttack(ctx, p, e, card("c", 1));
    endTurn(state);
    expect(p.cooldowns.remaining("c")).toBe(1);
    pass(state); // enemy turn
    expect(p.cooldowns.remaining("c")).toBe(1);
  });

  it("counters tick on skipped turns (Stunned)", () => {
    const { p, e, ctx, round, use } = setup();
    // Turn 1: use cooldown 2; the enemy then stuns the player (Stunned 10).
    round(use(card("c", 2)), () => resolveHit(ctx, e, p, phys(0, { statuses: [{ status: "stunned", stacks: 10 }] })));
    expect(p.cooldowns.remaining("c")).toBe(2);
    // Turn 2: lost to the stun; the counter still ticks 2 -> 1.
    expect(round()).toBe(false);
    expect(p.cooldowns.remaining("c")).toBe(1);
    // Turn 3: 1 -> 0. Turn 4: ready.
    expect(p.cooldowns.ready("c")).toBe(false);
    round();
    expect(p.cooldowns.ready("c")).toBe(true);
  });

  it("only the cards used during the turn are spared; others tick", () => {
    const { p, round, use } = setup();
    round(use(card("a", 2))); // turn 1: a = 2
    round(use(card("b", 1))); // turn 2: a 2 -> 1, b = 1 (use turn)
    expect(p.cooldowns.remaining("a")).toBe(1);
    expect(p.cooldowns.remaining("b")).toBe(1);
    round(); // turn 3: a 1 -> 0, b 1 -> 0
    expect(p.cooldowns.remaining("a")).toBe(0);
    expect(p.cooldowns.remaining("b")).toBe(0);
  });

  it("a card can be used again once ready, and goes back on cooldown", () => {
    const { p, round, use } = setup();
    round(use(card("c", 1))); // turn 1
    round(); // turn 2: 1 -> 0
    expect(p.cooldowns.ready("c")).toBe(true);
    round(use(card("c", 1))); // turn 3
    expect(p.cooldowns.remaining("c")).toBe(1);
  });

  it("no cooldown, cooldown 0, or no cardId: nothing is set", () => {
    const { p, ctx, e, state } = setup();
    startTurn(state);
    resolveAttack(ctx, p, e, { hits: [phys(1)], cardId: "strike" });
    resolveAttack(ctx, p, e, { hits: [phys(1)], cardId: "jab", cooldown: 0 });
    resolveAttack(ctx, p, e, { hits: [phys(1)], cooldown: 2 });
    expect(p.cooldowns.remaining("strike")).toBe(0);
    expect(p.cooldowns.remaining("jab")).toBe(0);
    expect(p.cooldowns.ready("strike")).toBe(true);
  });

  it("the card goes on cooldown even if every hit was deflected (it was used)", () => {
    const p = player();
    const e: CombatUnit = enemy("e", { statuses: { warded: 2 } });
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    resolveAttack(ctx, p, e, { hits: [phys(5), phys(5)], cardId: "c", cooldown: 2 });
    expect(e.hp).toBe(30);
    expect(p.cooldowns.remaining("c")).toBe(2);
  });

  it("an enemy's cooldowns tick at the enemy's turn ends, not the player's", () => {
    const { p, e, ctx, state, round } = setup();
    round(undefined, () => resolveAttack(ctx, e, p, card("bite", 1))); // round 1: the enemy uses it
    expect(e.cooldowns.remaining("bite")).toBe(1);
    pass(state); // round 2, player's turn: no tick for the enemy
    expect(e.cooldowns.remaining("bite")).toBe(1);
    pass(state); // round 2, enemy's turn: 1 -> 0
    expect(e.cooldowns.remaining("bite")).toBe(0);
  });
});
