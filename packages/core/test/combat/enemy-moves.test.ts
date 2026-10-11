import { describe, expect, it } from "vitest";
import {
  createUnit,
  endTurn,
  resolveHit,
  enemyAct,
  passTurn,
  startTurn,
  type CardSpec,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type Effect,
  type EnemyMove,
  type PlayResult,
} from "../../src/index.ts";
import { eventsOf } from "./helpers.ts";
import { activeId, during, enemy, fight, phys, player } from "./turn-helpers.ts";

// Spec 1.7, "Enemy moves":
//   "An enemy has a list of moves (data): each with a weight, a cooldown and the same effects as skills, plus a
//    written intent line."
//   "One move per turn. The enemy's next move is picked by weight among its ready moves, on the combat RNG, at the
//    start of the fight and right after each of its turns, so its intent always shows the move it will use. If its
//    chosen move becomes unusable (restricted), it picks again among the allowed ready moves; with none, it passes."
//   "Enemy moves target the player unless the move says otherwise."
// Turn details: "a skill with cooldown N can't be used on its owner's next N turns."
// Brief M1.4: UnitInit.moves (weight > 0); CombatUnit.intent = the id of its next move (null without moves);
//   IntentChosen { unit, move }; enemyAct(state) plays the intent on the first living unit of the other side and
//   ends the turn; with no ready move it passes.

const dmg = (amount: number, target: "enemy" | "self" | "allEnemies" = "enemy"): Effect => ({ type: "damage", damageType: "physical", amount, target });
const card = (id: string, cooldown: number, ...effects: Effect[]): CardSpec => ({ id, cooldown, effects });
const move = (c: CardSpec, weight: number, intent?: string): EnemyMove => (intent === undefined ? { card: c, weight } : { card: c, weight, intent });

const BITE = card("bite", 0, dmg(5));

/** A player with 200 HP and Agility 3, so it always acts first, and an enemy with the given moves. */
function setup(
  moves: readonly EnemyMove[],
  seed = "moves",
  enemyOver: Parameters<typeof enemy>[1] = {},
  playerOver: Parameters<typeof player>[0] = {},
) {
  const p = player({ maxHp: 200, stats: { agility: 3 }, ...playerOver });
  const e = enemy("e", { maxHp: 500, moves, ...enemyOver });
  const { ctx, state } = fight([p, e], seed);
  return { p, e, ctx, state };
}

/** The player passes; then the enemy takes its turn (enemyAct, or endTurn on a lost turn). Returns the enemy-turn events. */
function round(ctx: CombatContext, state: CombatState): CombatEvent[] {
  startTurn(state);
  passTurn(state);
  return during(ctx, () => {
    if (startTurn(state)) enemyAct(state);
    else endTurn(state);
  });
}

/** Moves the enemy used, one entry per enemy turn ("-" for a pass), over n rounds. */
function usedMoves(ctx: CombatContext, state: CombatState, n: number): string[] {
  const used: string[] = [];
  for (let i = 0; i < n; i++) {
    const ev = round(ctx, state);
    const played = eventsOf(ev, "CardPlayed").filter((x) => x.unit === "e");
    used.push(played[0]?.card ?? "-");
  }
  return used;
}

const intents = (events: readonly CombatEvent[], unit = "e"): string[] =>
  eventsOf(events, "IntentChosen").filter((x) => x.unit === unit).map((x) => x.move);

// ---------------------------------------------------------------------------------------------
describe("Moves on units", () => {
  it("intent is null for units without moves (the player, a moveless enemy)", () => {
    const p = player();
    const e = enemy();
    fight([p, e]);
    expect(p.intent).toBeNull();
    expect(e.intent).toBeNull();
  });

  it("a weight of 0 or less is invalid", () => {
    expect(() => createUnit({ id: "e", side: "enemy", maxHp: 30, moves: [move(BITE, 0)] })).toThrow();
    expect(() => createUnit({ id: "e", side: "enemy", maxHp: 30, moves: [move(BITE, -1)] })).toThrow();
  });

  it("a move may carry an intent line (localisation key)", () => {
    expect(() => createUnit({ id: "e", side: "enemy", maxHp: 30, moves: [move(BITE, 1, "intent.bite")] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
describe("Picking the intent", () => {
  it("at the start of the fight: a single move is the intent; IntentChosen is emitted", () => {
    const { e, ctx } = setup([move(BITE, 1)]);
    expect(e.intent).toBe("bite");
    expect(intents(ctx.events)).toEqual(["bite"]);
  });

  it("at the start of the fight for every unit with moves", () => {
    const p = player();
    const e1 = enemy("e1", { moves: [move(BITE, 1)] });
    const e2 = enemy("e2", { moves: [move(card("claw", 0, dmg(2)), 1)] });
    const e3 = enemy("e3");
    const { ctx } = fight([p, e1, e2, e3]);
    expect([e1.intent, e2.intent, e3.intent]).toEqual(["bite", "claw", null]);
    expect(intents(ctx.events, "e1")).toEqual(["bite"]);
    expect(intents(ctx.events, "e2")).toEqual(["claw"]);
    expect(intents(ctx.events, "e3")).toEqual([]);
  });

  it("the intent is one of the unit's moves", () => {
    for (let i = 0; i < 20; i++) {
      const { e } = setup([move(BITE, 1), move(card("claw", 0, dmg(2)), 1)], `pick-${i}`);
      expect(["bite", "claw"]).toContain(e.intent);
    }
  });

  it("right after each of the enemy's turns: IntentChosen, and the intent matches it", () => {
    const { e, ctx, state } = setup([move(BITE, 1), move(card("claw", 0, dmg(2)), 1)]);
    for (let r = 0; r < 5; r++) {
      const ev = round(ctx, state);
      const chosen = intents(ev);
      expect(chosen).toHaveLength(1);
      expect(e.intent).toBe(chosen[0]);
    }
  });

  it("no pick after the player's turn", () => {
    const { ctx, state } = setup([move(BITE, 1)]);
    startTurn(state);
    const ev = during(ctx, () => passTurn(state));
    expect(intents(ev)).toEqual([]);
  });

  it("deterministic: the same seed gives the same intents", () => {
    const run = (seed: string): string[] => {
      const { ctx, state } = setup([move(BITE, 2), move(card("claw", 0, dmg(2)), 1), move(card("maul", 1, dmg(7)), 1)], seed);
      for (let r = 0; r < 10; r++) round(ctx, state);
      return intents(ctx.events);
    };
    expect(run("same")).toEqual(run("same"));
    const distinct = new Set<string>();
    for (let i = 0; i < 10; i++) distinct.add(run(`seed-${i}`).join(","));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("weights 3:1: the heavy move is picked about 75% of the time (2000 fights, first intent)", () => {
    let heavy = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const { e } = setup([move(card("heavy", 0, dmg(1)), 3), move(card("light", 0, dmg(1)), 1)], `dist-${i}`);
      if (e.intent === "heavy") heavy++;
    }
    // Expected 1500, standard deviation about 19; allow +-100.
    expect(heavy).toBeGreaterThan(1400);
    expect(heavy).toBeLessThan(1600);
  });

  it("weights 3:1 over many turns of one fight: about 75%", () => {
    let heavy = 0;
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const { ctx, state } = setup([move(card("heavy", 0, dmg(0)), 3), move(card("light", 0, dmg(0)), 1)], `dist-run-${i}`);
      for (const m of usedMoves(ctx, state, 50)) {
        total++;
        if (m === "heavy") heavy++;
      }
    }
    // 1000 picks; expected 750, sd about 14.
    expect(total).toBe(1000);
    expect(heavy).toBeGreaterThan(680);
    expect(heavy).toBeLessThan(820);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Only ready moves are picked", () => {
  it("a move on cooldown is never picked: after slam (cooldown 2), the next two moves are not slam", () => {
    let slams = 0;
    for (let i = 0; i < 20; i++) {
      const { ctx, state } = setup([move(card("slam", 2, dmg(1)), 5), move(card("poke", 0, dmg(1)), 1)], `ready-${i}`);
      const used = usedMoves(ctx, state, 12);
      used.forEach((m, t) => {
        if (m !== "slam") return;
        slams++;
        expect(used[t + 1] ?? "poke").toBe("poke");
        expect(used[t + 2] ?? "poke").toBe("poke");
      });
    }
    expect(slams).toBeGreaterThan(20);
  });

  it("the intent is never a move on cooldown (checked after every enemy turn)", () => {
    for (let i = 0; i < 20; i++) {
      const { e, ctx, state } = setup([move(card("slam", 2, dmg(1)), 5), move(card("poke", 1, dmg(1)), 1), move(BITE, 1)], `ready-intent-${i}`);
      for (let r = 0; r < 10; r++) {
        round(ctx, state);
        expect(e.intent).not.toBeNull();
        expect(e.cooldowns.ready(e.intent ?? "")).toBe(true);
      }
    }
  });

  it("a single cooldown-1 move: used, then a pass (nothing ready), then used again", () => {
    const { ctx, state, e, p } = setup([move(card("smash", 1, dmg(4)), 1)]);
    expect(e.intent).toBe("smash");
    expect(usedMoves(ctx, state, 5)).toEqual(["smash", "-", "smash", "-", "smash"]);
    expect(p.hp).toBe(188); // 200 - 3 x 4
  });

  it("with no ready move the enemy passes: Passed, then the turn ends", () => {
    const { ctx, state } = setup([move(card("smash", 1, dmg(4)), 1)]);
    round(ctx, state); // smash
    startTurn(state);
    passTurn(state);
    startTurn(state);
    let res: PlayResult | undefined;
    const ev = during(ctx, () => (res = enemyAct(state)));
    expect(res).toEqual({ ok: true });
    expect(eventsOf(ev, "Passed")).toEqual([{ type: "Passed", unit: "e" }]);
    expect(eventsOf(ev, "CardPlayed")).toEqual([]);
    expect(eventsOf(ev, "TurnEnded")).toEqual([{ type: "TurnEnded", unit: "e" }]);
    expect(activeId(state)).toBe("p");
  });
});

// ---------------------------------------------------------------------------------------------
describe("enemyAct", () => {
  it("plays the intent on the player, sets its cooldown and ends the turn", () => {
    const maul = card("maul", 2, dmg(9));
    const { ctx, state, e, p } = setup([move(maul, 1)]);
    startTurn(state);
    passTurn(state);
    expect(startTurn(state)).toBe(true);
    let res: PlayResult | undefined;
    const ev = during(ctx, () => (res = enemyAct(state)));
    expect(res).toEqual({ ok: true });
    expect(ev[0]).toEqual({ type: "CardPlayed", unit: "e", card: "maul", target: "p" });
    expect(eventsOf(ev, "HitStarted")).toEqual([{ type: "HitStarted", attacker: "e", target: "p", damageType: "physical", value: 9 }]);
    expect(p.hp).toBe(191);
    expect(e.cooldowns.remaining("maul")).toBe(2);
    expect(eventsOf(ev, "TurnEnded")).toEqual([{ type: "TurnEnded", unit: "e" }]);
    expect(activeId(state)).toBe("p");
    expect(state.round).toBe(2);
  });

  it("uses the move shown as the intent (not a fresh pick)", () => {
    for (let i = 0; i < 20; i++) {
      const { ctx, state, e } = setup([move(BITE, 1), move(card("claw", 0, dmg(2)), 1), move(card("maul", 0, dmg(9)), 1)], `shown-${i}`);
      for (let r = 0; r < 4; r++) {
        const shown = e.intent;
        expect(usedMoves(ctx, state, 1)).toEqual([shown]);
      }
    }
  });

  it("the move's statuses ride on its hits like a player's card (Warded player: deflected, no Enfeebled)", () => {
    const trick = card("trick", 1, dmg(3), { type: "status", status: "enfeebled", stacks: 2, target: "enemy" });
    const { ctx, state, p } = setup([move(trick, 1)], "warded", {}, { statuses: { warded: 1 } });
    round(ctx, state);
    expect(p.hp).toBe(200);
    expect(p.statuses.stacks("enfeebled")).toBe(0);
  });

  it("a self move applies to the enemy itself (heal 5: 20 -> 25)", () => {
    const lick = card("lick", 1, { type: "heal", amount: 5, target: "self" });
    const { ctx, state, e, p } = setup([move(lick, 1)], "self", { maxHp: 30, hp: 20 });
    round(ctx, state);
    expect(e.hp).toBe(25);
    expect(p.hp).toBe(200);
  });

  // Two units on the player's side only exercise the brief's "first living unit of the other side" rule.
  it("targets the first living unit of the other side (p fallen -> p2)", () => {
    const p1 = player({ maxHp: 50, stats: { agility: 3 } });
    const p2 = createUnit({ id: "p2", side: "player", maxHp: 50, stats: { agility: 3 } });
    const e = enemy("e", { moves: [move(BITE, 1)] });
    const { ctx, state } = fight([p1, p2, e]);
    startTurn(state); // p
    passTurn(state);
    startTurn(state); // p2
    resolveHit(ctx, e, p1, phys(100)); // p falls before the enemy acts
    passTurn(state);
    expect(activeId(state)).toBe("e");
    startTurn(state);
    const ev = during(ctx, () => enemyAct(state));
    expect(eventsOf(ev, "CardPlayed")[0]?.target).toBe("p2");
    expect(p2.hp).toBe(45);
  });

  it("an allEnemies move hits every living unit of the other side", () => {
    const roar = card("roar", 1, dmg(3, "allEnemies"));
    const p1 = player({ maxHp: 50, stats: { agility: 3 } });
    const p2 = createUnit({ id: "p2", side: "player", maxHp: 50, stats: { agility: 3 } });
    const e = enemy("e", { moves: [move(roar, 1)] });
    const { ctx, state } = fight([p1, p2, e]);
    while (activeId(state) !== "e") {
      startTurn(state);
      passTurn(state);
    }
    startTurn(state);
    const ev = during(ctx, () => enemyAct(state));
    expect(eventsOf(ev, "HitStarted").map((x) => x.target)).toEqual(["p", "p2"]);
    expect([p1.hp, p2.hp]).toEqual([47, 47]);
  });

  it("a lost turn (Stunned 10): no move is used and the move stays ready", () => {
    const { ctx, state, e, p } = setup([move(card("smash", 1, dmg(4)), 1)], "stunned", { statuses: { stunned: 10 } });
    const ev = round(ctx, state);
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "e", reason: "stunned" }]);
    expect(eventsOf(ev, "CardPlayed")).toEqual([]);
    expect(p.hp).toBe(200);
    expect(e.cooldowns.ready("smash")).toBe(true);
    expect(e.intent).toBe("smash");
  });

  it("the enemy's moves follow the hit order: Thorns on the player hurts the enemy", () => {
    const { ctx, state, e } = setup([move(BITE, 1)], "thorns", { maxHp: 30 }, { statuses: { thorns: 4 } });
    round(ctx, state); // player's turn end: Thorns 4 -> 3; then the bite: Thorns 3 to the enemy
    expect(e.hp).toBe(27);
  });

  it("the same seed gives the same fight (events)", () => {
    const run = (): CombatEvent[] => {
      const { ctx, state } = setup([move(BITE, 2), move(card("claw", 0, dmg(2)), 1), move(card("maul", 1, dmg(7)), 1)], "replay");
      for (let r = 0; r < 8; r++) round(ctx, state);
      return ctx.events;
    };
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------------------------
// Spec 1.7 (clarified): "right after each of its turns (a lost turn counts: its cooldowns have ticked, so it picks
// again)". Brief clarification: IntentChosen follows TurnEnded.
describe("Re-pick after every enemy turn, lost turns included", () => {
  /** Stuns the enemy (Stunned 10) during the player's turn, then the player passes. */
  const stunDuringPlayerTurn = (ctx: CombatContext, state: CombatState, p: { id: string }, e: { id: string }) => {
    startTurn(state);
    const [pu, eu] = [state.units.find((u) => u.id === p.id), state.units.find((u) => u.id === e.id)];
    if (pu && eu) resolveHit(ctx, pu, eu, phys(0, { statuses: [{ status: "stunned", stacks: 10 }] }));
    passTurn(state);
  };

  it("IntentChosen comes after TurnEnded on a normal turn", () => {
    const { ctx, state } = setup([move(BITE, 1)]);
    const ev = round(ctx, state);
    const ended = ev.findIndex((x) => x.type === "TurnEnded" && x.unit === "e");
    const chosen = ev.findIndex((x) => x.type === "IntentChosen");
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(chosen).toBeGreaterThan(ended);
  });

  it("a lost turn re-picks after its cooldown tick: single cooldown-1 move, nothing ready -> lost turn -> smash again", () => {
    // Turn 1: smash (remaining 1, not ticked on the use turn); nothing is ready after it.
    // Turn 2: lost to Stunned 10; turn end ticks smash 1 -> 0; the re-pick sees it ready.
    const { ctx, state, p, e } = setup([move(card("smash", 1, dmg(4)), 1)]);
    expect(usedMoves(ctx, state, 1)).toEqual(["smash"]);
    stunDuringPlayerTurn(ctx, state, p, e);
    const ev = during(ctx, () => {
      expect(startTurn(state)).toBe(false);
      endTurn(state);
    });
    expect(eventsOf(ev, "TurnSkipped")).toEqual([{ type: "TurnSkipped", unit: "e", reason: "stunned" }]);
    expect(intents(ev)).toEqual(["smash"]);
    const ended = ev.findIndex((x) => x.type === "TurnEnded" && x.unit === "e");
    const chosen = ev.findIndex((x) => x.type === "IntentChosen");
    expect(chosen).toBeGreaterThan(ended);
    expect(e.intent).toBe("smash");
    // Turn 3: it uses smash.
    expect(usedMoves(ctx, state, 1)).toEqual(["smash"]);
  });

  it("two moves: the move that comes off cooldown during the lost turn can be picked (the old intent is not kept)", () => {
    // Moves a and b, cooldown 1, weight 1. Turn 1 uses X; after it only Y is ready, so the intent is Y.
    // Turn 2 is lost: X ticks 1 -> 0, then the re-pick chooses between X and Y. If the intent were kept it would
    // always be Y; over 30 seeds X must come up.
    let pickedTheOther = 0;
    for (let i = 0; i < 30; i++) {
      const { ctx, state, p, e } = setup([move(card("a", 1, dmg(1)), 1), move(card("b", 1, dmg(1)), 1)], `lost-repick-${i}`);
      const [x] = usedMoves(ctx, state, 1);
      const y = x === "a" ? "b" : "a";
      expect(e.intent).toBe(y);
      stunDuringPlayerTurn(ctx, state, p, e);
      const ev = during(ctx, () => {
        expect(startTurn(state)).toBe(false);
        endTurn(state);
      });
      expect(intents(ev)).toHaveLength(1);
      expect(intents(ev)[0]).toBe(e.intent);
      expect(e.cooldowns.ready(x ?? "")).toBe(true);
      if (e.intent === x) pickedTheOther++;
    }
    expect(pickedTheOther).toBeGreaterThan(0);
    expect(pickedTheOther).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------------------------
// Brief clarification: "playCard / passTurn act for state.active and only when it is a player-side unit; an active
// enemy -> not_your_turn. enemyAct only for an active enemy (else not_your_turn)."
describe("Whose action: not_your_turn", () => {
  it("enemyAct while the player is active (turn started) returns not_your_turn with no events and no change", () => {
    const { ctx, state, p, e } = setup([move(BITE, 1)]);
    startTurn(state);
    const before = ctx.events.length;
    expect(enemyAct(state)).toEqual({ ok: false, reason: "not_your_turn" });
    expect(ctx.events.length).toBe(before);
    expect([p.hp, e.hp, activeId(state), e.intent]).toEqual([200, 500, "p", "bite"]);
    expect(e.cooldowns.ready("bite")).toBe(true);
    // The player can still act.
    expect(passTurn(state)).toEqual({ ok: true });
  });

  it("enemyAct before the player's turn has started also returns not_your_turn", () => {
    const { ctx, state } = setup([move(BITE, 1)]);
    const before = ctx.events.length;
    expect(enemyAct(state)).toEqual({ ok: false, reason: "not_your_turn" });
    expect(ctx.events.length).toBe(before);
  });

  it("passTurn while the enemy is active returns not_your_turn with no events", () => {
    const { ctx, state, e } = setup([move(BITE, 1)]);
    startTurn(state);
    passTurn(state);
    startTurn(state); // the enemy's turn
    const before = ctx.events.length;
    expect(passTurn(state)).toEqual({ ok: false, reason: "not_your_turn" });
    expect(ctx.events.length).toBe(before);
    expect(activeId(state)).toBe("e");
    expect(e.intent).toBe("bite");
    expect(enemyAct(state)).toEqual({ ok: true });
  });
});
