import { describe, expect, it } from "vitest";
import {
  cardFromSkill,
  createUnit,
  endTurn,
  GATE,
  type GateState,
  passTurn,
  playCard,
  resolveHit,
  startTurn,
  strikeCard,
  STATUS_IDS,
  type CardSpec,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type Effect,
  type PlayResult,
  type StatusId,
  type WeaponDef,
} from "../../src/index.ts";
import { skillDef, weaponDef } from "./base-pack.ts";
import { eventsOf, typesOf } from "./helpers.ts";
import { activeId, during, enemy, fight, pass, phys, player } from "./turn-helpers.ts";

/** The pooled action gate. It lives on the CombatState implementation; the public CombatState type doesn't expose it. */
const gateOf = (s: CombatState): GateState => (s as CombatState & { readonly gate: GateState }).gate;

// Spec 1.7, "Skills":
//   "A player holds at most 5." "One action per turn. On your turn you do exactly one thing: Strike, use one ready
//    skill (the companion's skill included), or pass. There is no energy and skills have no cost; cooldowns are the
//    only limit." "Strike (weapon basic attack) is the only skill with no cooldown, so it is always available".
//   "Each effect targets the user, the chosen enemy, or all enemies."
// Spec 1.7, "Cards in combat":
//   "Using a card is the turn's one action. It must be ready and allowed by the action gate (a restrict filter can
//    forbid it). The player chooses an enemy target for effects that target 'the chosen enemy'; with one enemy it is
//    chosen automatically. Effects run in the card's order; each damage effect is one attack of 1 or more hits (Twin
//    Knives: 2). Then the card goes on cooldown and the turn ends."
//   "Statuses on a damaging card ride on its hits. If a card has a damage effect on the chosen enemy, its status
//    effects on that enemy are carried by every hit of the first such damage effect (step 7 of the hit order), so a
//    deflected hit applies none (Dirty Trick into Warded: no Enfeebled). A card with no damage effect applies its
//    statuses directly: chance and resistance apply, but nothing can deflect it, since it is not an attack. Effects
//    on the user (heal, restore Shield, own statuses) always apply directly."
//   "Heal and restore Shield scale only with the user's stats and statuses, never the target's."
//   "Passing ends the turn with no action. A turn with no ready card can only pass."
//   "Strike once: since every turn is one action, Strike can be used at most once per turn."
// Turn details: "Cooldown 1: used on turn 1, not ready on turn 2, ready on turn 3."
//   "A unit that falls during its action (to Thorns) also skips its turn-end effects."
// Brief M1.4: validation order fight_over, not_your_turn, turn_not_started, cannot_act, unknown_card, on_cooldown,
//   not_allowed, bad_target; each with no events and no state change. CardPlayed, effects, cooldown, turn end.
//
// Every unit has all stats 2 unless stated, so stat scaling terms add per x 2.

type DamageEffect = Extract<Effect, { type: "damage" }>;
type StatusEffect = Extract<Effect, { type: "status" }>;

const dmg = (amount: number, extra: Partial<Omit<DamageEffect, "type">> = {}): Effect => ({
  type: "damage",
  damageType: "physical",
  amount,
  target: "enemy",
  ...extra,
});
const status = (s: StatusId, stacks: number, extra: Partial<Omit<StatusEffect, "type">> = {}): Effect => ({
  type: "status",
  status: s,
  stacks,
  target: "enemy",
  ...extra,
});
const card = (id: string, cooldown: number, ...effects: Effect[]): CardSpec => ({ id, cooldown, effects });

/** jab: cooldown 1, 5 physical damage on the chosen enemy. */
const JAB = card("jab", 1, dmg(5));
/** strike: cooldown 0, 4 physical damage. */
const STRIKE = card("strike", 0, dmg(4));
/** brace: cooldown 2, Warded 1 on the user (no enemy effect). */
const BRACE = card("brace", 2, status("warded", 1, { target: "self" }));

/** Everything a rejected play must leave untouched. */
function snapshot(ctx: CombatContext, state: CombatState): string {
  return JSON.stringify({
    events: ctx.events.length,
    active: activeId(state),
    round: state.round,
    over: state.over,
    winner: state.winner,
    units: state.units.map((u) => ({
      id: u.id,
      hp: u.hp,
      shield: u.shield,
      fallen: u.fallen,
      statuses: STATUS_IDS.map((s) => u.statuses.stacks(s)),
      cooldowns: u.cards.map((c) => u.cooldowns.remaining(c.id)),
      intent: u.intent,
    })),
  });
}

function expectRejected(ctx: CombatContext, state: CombatState, play: () => PlayResult, reason: string): void {
  const before = snapshot(ctx, state);
  expect(play()).toEqual({ ok: false, reason });
  expect(snapshot(ctx, state)).toBe(before);
}

/** Player (200 HP) against one sturdy enemy (500 HP); the player acts first. */
function duel(cards: readonly CardSpec[], over: Parameters<typeof player>[0] = {}, enemyOver: Parameters<typeof enemy>[1] = {}) {
  const p = player({ maxHp: 200, cards, ...over });
  const e = enemy("e", { maxHp: 500, ...enemyOver });
  return { p, e, ...fight([p, e]) };
}

const hitTargets = (events: readonly CombatEvent[]): string[] => eventsOf(events, "HitStarted").map((e) => e.target);
const hitValues = (events: readonly CombatEvent[]): number[] => eventsOf(events, "HitStarted").map((e) => e.value);

// ---------------------------------------------------------------------------------------------
describe("Cards on units", () => {
  it("CombatUnit.cards lists the init cards in order; no cards means an empty list", () => {
    const p = player({ cards: [STRIKE, JAB, BRACE] });
    expect(p.cards.map((c) => c.id)).toEqual(["strike", "jab", "brace"]);
    expect(player().cards).toEqual([]);
  });

  it("every card starts ready", () => {
    const p = player({ cards: [STRIKE, JAB, BRACE] });
    expect(p.cards.map((c) => p.cooldowns.ready(c.id))).toEqual([true, true, true]);
  });

  it("a player holds at most 5 cards: 5 is fine, 6 throws a RangeError", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => card(id, 1, dmg(1)));
    expect(createUnit({ id: "p", side: "player", maxHp: 30, cards: six.slice(0, 5) }).cards).toHaveLength(5);
    expect(() => createUnit({ id: "p", side: "player", maxHp: 30, cards: six })).toThrow(RangeError);
  });

  it("enemies have no card limit", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => card(id, 1, dmg(1)));
    expect(createUnit({ id: "e", side: "enemy", maxHp: 30, cards: six }).cards).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Cards from content: cardFromSkill and strikeCard", () => {
  const longsword: WeaponDef = {
    kind: "weapon",
    id: "weapon.notched_longsword",
    name: "weapon.notched_longsword.name",
    stats: { might: 1 },
    attack: { damage: 4, damageType: "physical", scaling: [{ stat: "might", per: 2 }] },
  };

  it("strikeCard: id \"strike\", cooldown 0, one damage effect on the chosen enemy from the weapon's attack (1 hit)", () => {
    const c = strikeCard(longsword);
    expect(c.id).toBe("strike");
    expect(c.cooldown).toBe(0);
    expect(c.effects).toHaveLength(1);
    const eff = c.effects[0];
    expect(eff).toMatchObject({ type: "damage", damageType: "physical", amount: 4, target: "enemy", scaling: [{ stat: "might", per: 2 }] });
    expect(eff?.type === "damage" ? (eff.hits ?? 1) : -1).toBe(1);
  });

  it("strikeCard keeps the weapon's hits (a 3-hit attack gives hits 3)", () => {
    const flail: WeaponDef = { ...longsword, id: "weapon.flail", attack: { ...longsword.attack, hits: 3 } };
    const eff = strikeCard(flail).effects[0];
    expect(eff?.type === "damage" ? eff.hits : -1).toBe(3);
  });

  it("strikeCard from the real Twin Knives: 3 physical damage, 2 hits, +2 per Agility", () => {
    const c = strikeCard(weaponDef("weapon.twin_knives"));
    expect(c).toMatchObject({ id: "strike", cooldown: 0 });
    expect(c.effects).toEqual([
      { type: "damage", damageType: "physical", amount: 3, target: "enemy", hits: 2, scaling: [{ stat: "agility", per: 2 }] },
    ]);
  });

  it("cardFromSkill from the real Dirty Trick: the skill's id, cooldown and effects", () => {
    const def = skillDef("skill.dirty_trick");
    const c = cardFromSkill(def);
    expect(c.id).toBe("skill.dirty_trick");
    expect(c.cooldown).toBe(1);
    expect(c.effects).toEqual(def.effects);
  });

  it("cardFromSkill works for Words too (real 雷 Lei: cooldown 2)", () => {
    const def = skillDef("word.lei");
    const c = cardFromSkill(def);
    expect(c.id).toBe("word.lei");
    expect(c.cooldown).toBe(2);
    expect(c.effects).toEqual(def.effects);
  });

  it("playing the real Twin Knives Strike: two hits of 3 + 2 x 2 = 7 -> 14 damage", () => {
    const p = player({ cards: [strikeCard(weaponDef("weapon.twin_knives"))] });
    const e = enemy();
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "strike")).toEqual({ ok: true }));
    expect(hitValues(ev)).toEqual([7, 7]);
    expect(e.hp).toBe(16); // 30 - 14
  });

  it("playing the real 雷 Lei: 6 + 3 x 2 = 12 arcane and Stunned 4 on the hit", () => {
    const p = player({ cards: [cardFromSkill(skillDef("word.lei"))] });
    const e = enemy();
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    playCard(state, "word.lei");
    expect(e.hp).toBe(18); // 30 - 12
    expect(e.statuses.stacks("stunned")).toBe(4);
    expect(eventsOf(ctx.events, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "e", status: "stunned", stacks: 4, total: 4 }]);
  });

  it("playing the real Dirty Trick: 3 + 2 x 2 + 1 x 2 = 9 physical and Enfeebled 2", () => {
    const p = player({ cards: [cardFromSkill(skillDef("skill.dirty_trick"))] });
    const e = enemy();
    const { state } = fight([p, e]);
    startTurn(state);
    playCard(state, "skill.dirty_trick");
    expect(e.hp).toBe(21);
    expect(e.statuses.stacks("enfeebled")).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe("playCard: success", () => {
  it("returns { ok: true }; CardPlayed first, then the effects, then the turn ends (TurnEnded last)", () => {
    const { ctx, state, e } = duel([JAB]);
    startTurn(state);
    let res: PlayResult | undefined;
    const ev = during(ctx, () => (res = playCard(state, "jab", "e")));
    expect(res).toEqual({ ok: true });
    expect(ev[0]).toEqual({ type: "CardPlayed", unit: "p", card: "jab", target: "e" });
    const types = typesOf(ev);
    expect(types.indexOf("HitStarted")).toBeGreaterThan(0);
    expect(types.indexOf("DamageDealt")).toBeGreaterThan(types.indexOf("HitStarted"));
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(eventsOf(ev, "CardPlayed")).toHaveLength(1);
    expect(eventsOf(ev, "TurnEnded")).toHaveLength(1);
    expect(e.hp).toBe(495);
    expect(activeId(state)).toBe("e");
  });

  it("the card goes on cooldown (cooldown 2 -> 2 remaining after the use turn, not ticked)", () => {
    const { p, state } = duel([card("slam", 2, dmg(1))]);
    startTurn(state);
    playCard(state, "slam");
    expect(p.cooldowns.remaining("slam")).toBe(2);
    expect(p.cooldowns.ready("slam")).toBe(false);
  });

  it("the turn ends as endTurn does: ticking statuses lose a stack, Stun power -1", () => {
    const { p, state } = duel([JAB], { stunPower: 3, statuses: { emboldened: 2 } });
    startTurn(state);
    playCard(state, "jab");
    expect(p.statuses.stacks("emboldened")).toBe(1);
    expect(p.stunPower).toBe(2);
  });

  it("with one living enemy the target is chosen automatically (CardPlayed names it)", () => {
    const { ctx, state, e } = duel([JAB]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "jab")).toEqual({ ok: true }));
    expect(eventsOf(ev, "CardPlayed")).toEqual([{ type: "CardPlayed", unit: "p", card: "jab", target: "e" }]);
    expect(e.hp).toBe(495);
  });

  it("one living enemy left of three: it is chosen automatically", () => {
    const p = player({ cards: [JAB] });
    const [e1, e2, e3] = [enemy("e1"), enemy("e2"), enemy("e3")];
    const { ctx, state } = fight([p, e1, e2, e3]);
    resolveHit(ctx, p, e1, phys(100));
    resolveHit(ctx, p, e3, phys(100));
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "jab")).toEqual({ ok: true }));
    expect(eventsOf(ev, "CardPlayed")[0]?.target).toBe("e2");
    expect(e2.hp).toBe(25);
  });

  it("with two living enemies the chosen one is hit, the other is not", () => {
    const p = player({ cards: [JAB] });
    const [e1, e2] = [enemy("e1"), enemy("e2")];
    const { ctx, state } = fight([p, e1, e2]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "jab", "e2")).toEqual({ ok: true }));
    expect(hitTargets(ev)).toEqual(["e2"]);
    expect(e1.hp).toBe(30);
    expect(e2.hp).toBe(25);
  });

  it("a card with only self effects needs no target, even with two living enemies", () => {
    const p = player({ cards: [BRACE] });
    const { state } = fight([p, enemy("e1"), enemy("e2")]);
    startTurn(state);
    expect(playCard(state, "brace")).toEqual({ ok: true });
    expect(p.statuses.stacks("warded")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("playCard: validation (no events, no state change)", () => {
  it("fight_over: the fight has ended", () => {
    const { ctx, state, p, e } = duel([JAB]);
    resolveHit(ctx, p, e, phys(1000));
    expect(state.over).toBe(true);
    expectRejected(ctx, state, () => playCard(state, "jab", "e"), "fight_over");
  });

  it("fight_over beats everything else (unknown card, bad target)", () => {
    const { ctx, state, p, e } = duel([JAB]);
    resolveHit(ctx, p, e, phys(1000));
    expectRejected(ctx, state, () => playCard(state, "nope", "p"), "fight_over");
  });

  it("not_your_turn: the enemy is active (the player's turn has ended)", () => {
    const { ctx, state } = duel([JAB]);
    pass(state); // the player's turn
    expect(activeId(state)).toBe("e");
    expectRejected(ctx, state, () => playCard(state, "jab", "e"), "not_your_turn");
    startTurn(state);
    expectRejected(ctx, state, () => playCard(state, "jab", "e"), "not_your_turn");
  });

  it("not_your_turn beats turn_not_started and unknown_card (enemy active, its turn not started)", () => {
    const { ctx, state } = duel([JAB]);
    pass(state);
    expectRejected(ctx, state, () => playCard(state, "nope"), "not_your_turn");
  });

  it("not_your_turn: the enemy holding a card with the same id doesn't make it playable through playCard", () => {
    const { ctx, state } = duel([STRIKE], {}, { cards: [STRIKE] });
    pass(state);
    startTurn(state); // the enemy's turn
    expectRejected(ctx, state, () => playCard(state, "strike", "p"), "not_your_turn");
  });

  it("turn_not_started: startTurn wasn't called; the card can be played once it is", () => {
    const { ctx, state, e } = duel([JAB]);
    expectRejected(ctx, state, () => playCard(state, "jab", "e"), "turn_not_started");
    startTurn(state);
    expect(playCard(state, "jab", "e")).toEqual({ ok: true });
    expect(e.hp).toBe(495);
  });

  it("turn_not_started beats unknown_card", () => {
    const { ctx, state } = duel([JAB]);
    expectRejected(ctx, state, () => playCard(state, "nope"), "turn_not_started");
  });

  it("turn_not_started again on the player's next turn until startTurn is called", () => {
    const { ctx, state } = duel([STRIKE]);
    startTurn(state);
    playCard(state, "strike");
    pass(state); // enemy
    expect(activeId(state)).toBe("p");
    expectRejected(ctx, state, () => playCard(state, "strike"), "turn_not_started");
  });

  it("cannot_act: the gate skipped this turn (Stunned 10); endTurn still ends it", () => {
    const { ctx, state, p } = duel([JAB], { statuses: { stunned: 10 } });
    expect(startTurn(state)).toBe(false);
    expectRejected(ctx, state, () => playCard(state, "jab", "e"), "cannot_act");
    endTurn(state);
    expect(activeId(state)).toBe("e");
    expect(p.cooldowns.ready("jab")).toBe(true);
  });

  it("cannot_act beats unknown_card and bad_target", () => {
    const { ctx, state } = duel([JAB], { statuses: { ambushed: 1 } });
    expect(startTurn(state)).toBe(false);
    expectRejected(ctx, state, () => playCard(state, "nope", "p"), "cannot_act");
  });

  it("unknown_card: the player holds no card with that id", () => {
    const { ctx, state } = duel([JAB]);
    startTurn(state);
    expectRejected(ctx, state, () => playCard(state, "cleave", "e"), "unknown_card");
    expect(playCard(state, "jab", "e")).toEqual({ ok: true });
  });

  it("unknown_card beats bad_target", () => {
    const { ctx, state } = duel([JAB]);
    startTurn(state);
    expectRejected(ctx, state, () => playCard(state, "cleave", "p"), "unknown_card");
  });

  it("on_cooldown: a card used last turn with cooldown 1; the player can still Strike", () => {
    const { ctx, state, e } = duel([STRIKE, JAB]);
    startTurn(state);
    playCard(state, "jab");
    pass(state); // enemy
    startTurn(state);
    expectRejected(ctx, state, () => playCard(state, "jab", "e"), "on_cooldown");
    expect(playCard(state, "strike", "e")).toEqual({ ok: true });
    expect(e.hp).toBe(491); // 500 - 5 - 4
  });

  it("on_cooldown beats bad_target", () => {
    const p = player({ cards: [JAB] });
    const { ctx, state } = fight([p, enemy("e1"), enemy("e2")]);
    startTurn(state);
    playCard(state, "jab", "e1");
    pass(state);
    pass(state);
    startTurn(state);
    expectRejected(ctx, state, () => playCard(state, "jab"), "on_cooldown");
  });

  it("not_allowed: a restrict filter (cooldown 0 only) forbids a ready skill; Strike still plays", () => {
    // "It must be ready and allowed by the action gate (a restrict filter can forbid it)."
    const { ctx, state, e } = duel([STRIKE, JAB]);
    startTurn(state);
    gateOf(state).result = GATE.restrict;
    gateOf(state).filter = { allows: (c) => c.cooldown === 0 };
    const ev = during(ctx, () => expectRejected(ctx, state, () => playCard(state, "jab", "e"), "not_allowed"));
    expect(ev).toEqual([]);
    expect(playCard(state, "strike", "e")).toEqual({ ok: true });
    expect(e.hp).toBe(496); // 500 - 4
  });

  describe("bad_target", () => {
    const three = () => {
      const p = player({ cards: [JAB, BRACE] });
      const [e1, e2, e3] = [enemy("e1"), enemy("e2"), enemy("e3")];
      const f = fight([p, e1, e2, e3]);
      resolveHit(f.ctx, p, e3, phys(100)); // e3 has fallen
      startTurn(f.state);
      return { p, e1, e2, e3, ...f };
    };

    it("no target with more than one living enemy", () => {
      const { ctx, state } = three();
      expectRejected(ctx, state, () => playCard(state, "jab"), "bad_target");
    });

    it("the target is not an enemy (the player itself)", () => {
      const { ctx, state } = three();
      expectRejected(ctx, state, () => playCard(state, "jab", "p"), "bad_target");
    });

    it("the target has fallen", () => {
      const { ctx, state } = three();
      expectRejected(ctx, state, () => playCard(state, "jab", "e3"), "bad_target");
    });

    it("the target id is not in the fight", () => {
      const { ctx, state } = three();
      expectRejected(ctx, state, () => playCard(state, "jab", "ghost"), "bad_target");
    });

    it("after a bad target the player can still play the card on a good one", () => {
      const { ctx, state, e1, e2 } = three();
      expectRejected(ctx, state, () => playCard(state, "jab"), "bad_target");
      expect(playCard(state, "jab", "e2")).toEqual({ ok: true });
      expect(e1.hp).toBe(30);
      expect(e2.hp).toBe(25);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("One action per turn", () => {
  it("a second play in the same turn is refused: the turn has already ended (not_your_turn)", () => {
    const { ctx, state, e } = duel([STRIKE, JAB]);
    startTurn(state);
    expect(playCard(state, "jab", "e")).toEqual({ ok: true });
    expectRejected(ctx, state, () => playCard(state, "strike", "e"), "not_your_turn");
    expect(e.hp).toBe(495);
  });

  it("Strike (cooldown 0) is usable every turn, once per turn", () => {
    const { ctx, state, e, p } = duel([STRIKE]);
    for (let turn = 1; turn <= 3; turn++) {
      startTurn(state);
      expect(playCard(state, "strike", "e")).toEqual({ ok: true });
      expect(p.cooldowns.ready("strike")).toBe(true);
      expectRejected(ctx, state, () => playCard(state, "strike", "e"), "not_your_turn");
      pass(state); // enemy
    }
    expect(e.hp).toBe(488); // 500 - 3 x 4
    expect(eventsOf(ctx.events, "CardPlayed")).toHaveLength(3);
  });

  it("cooldown 1 through cards: used on turn 1, not ready on turn 2, ready on turn 3", () => {
    const { ctx, state, p } = duel([STRIKE, JAB]);
    const ready: boolean[] = [];
    // Turn 1
    startTurn(state);
    ready.push(p.cooldowns.ready("jab"));
    expect(playCard(state, "jab")).toEqual({ ok: true });
    expect(p.cooldowns.remaining("jab")).toBe(1); // use turn: not ticked
    pass(state);
    // Turn 2
    startTurn(state);
    ready.push(p.cooldowns.ready("jab"));
    expectRejected(ctx, state, () => playCard(state, "jab"), "on_cooldown");
    expect(passTurn(state)).toEqual({ ok: true });
    expect(p.cooldowns.remaining("jab")).toBe(0); // 1 -> 0 at the end of turn 2
    pass(state);
    // Turn 3
    startTurn(state);
    ready.push(p.cooldowns.ready("jab"));
    expect(playCard(state, "jab")).toEqual({ ok: true });
    expect(ready).toEqual([true, false, true]);
  });

  it("cooldowns of unplayed cards still tick when another card is played", () => {
    const { state, p } = duel([STRIKE, card("slam", 2, dmg(1))]);
    startTurn(state);
    playCard(state, "slam"); // slam 2
    pass(state);
    startTurn(state);
    playCard(state, "strike"); // slam 2 -> 1
    expect(p.cooldowns.remaining("slam")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("passTurn", () => {
  it("emits Passed, then the turn ends; no hit, no card used", () => {
    const { ctx, state, p, e } = duel([JAB]);
    startTurn(state);
    let res: PlayResult | undefined;
    const ev = during(ctx, () => (res = passTurn(state)));
    expect(res).toEqual({ ok: true });
    expect(ev[0]).toEqual({ type: "Passed", unit: "p" });
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(eventsOf(ev, "HitStarted")).toEqual([]);
    expect(eventsOf(ev, "CardPlayed")).toEqual([]);
    expect(e.hp).toBe(500);
    expect(p.cooldowns.ready("jab")).toBe(true);
    expect(activeId(state)).toBe("e");
  });

  it("runs turn end like endTurn (ticking statuses, cooldowns)", () => {
    const { state, p } = duel([STRIKE, JAB], { statuses: { thorns: 2 } });
    startTurn(state);
    playCard(state, "jab");
    pass(state);
    startTurn(state);
    passTurn(state);
    expect(p.cooldowns.remaining("jab")).toBe(0);
    expect(p.statuses.stacks("thorns")).toBe(0); // 2 -> 1 -> 0
  });

  it("a player with no ready card can pass", () => {
    const { state } = duel([card("slam", 2, dmg(1))]);
    startTurn(state);
    playCard(state, "slam");
    pass(state);
    startTurn(state);
    expect(passTurn(state)).toEqual({ ok: true });
  });

  it("fight_over and turn_not_started, with no events and no state change", () => {
    const a = duel([JAB]);
    expectRejected(a.ctx, a.state, () => passTurn(a.state), "turn_not_started");
    const b = duel([JAB]);
    resolveHit(b.ctx, b.p, b.e, phys(1000));
    expectRejected(b.ctx, b.state, () => passTurn(b.state), "fight_over");
  });

  it("endTurn right after startTurn still works and counts as passing without a Passed event", () => {
    const { ctx, state } = duel([JAB]);
    startTurn(state);
    const ev = during(ctx, () => endTurn(state));
    expect(eventsOf(ev, "Passed")).toEqual([]);
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(activeId(state)).toBe("e");
  });
});

// ---------------------------------------------------------------------------------------------
describe("Damage effects: one attack of `hits` hits", () => {
  it("hits 2: two hits of the same value (5 + 2 x Might 2 = 9 each -> 18)", () => {
    const { ctx, state, e } = duel([card("double", 1, dmg(5, { hits: 2, scaling: [{ stat: "might", per: 2 }] }))]);
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "double"));
    expect(hitValues(ev)).toEqual([9, 9]);
    expect(e.hp).toBe(482);
  });

  it("no hits field means 1 hit", () => {
    const { ctx, state } = duel([JAB]);
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "jab"));
    expect(hitValues(ev)).toEqual([5]);
  });

  it("per-hit powers apply on each hit, per-attack powers once (Bleed 2, Stun 3, Burn 3, Paralysis 2, Poison 1)", () => {
    const { state, e } = duel([card("double", 1, dmg(1, { hits: 2 }))], {
      bleedPower: 2,
      stunPower: 3,
      burnPower: 3,
      paralysisPower: 2,
      poisonPower: 1,
    });
    startTurn(state);
    playCard(state, "double");
    expect(e.statuses.stacks("bleeding")).toBe(4); // 2 + 2
    expect(e.statuses.stacks("stunned")).toBe(6); // 3 + 3
    expect(e.statuses.stacks("burning")).toBe(3); // once
    expect(e.statuses.stacks("paralysed")).toBe(2); // once
    expect(e.statuses.stacks("poisoned")).toBe(1); // once
    expect(e.hp).toBe(498);
  });

  it("two damage effects are two attacks: per-attack powers twice", () => {
    const { ctx, state, e } = duel([card("one-two", 1, dmg(1), dmg(2))], { burnPower: 3 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "one-two"));
    expect(hitValues(ev)).toEqual([1, 2]);
    expect(e.statuses.stacks("burning")).toBe(6); // 3 + 3
    expect(e.hp).toBe(497);
  });

  it("Thorns fires on each hit of a multi-hit attack (Thorns 2, 3 hits -> 6 to the player)", () => {
    const { state, p } = duel([card("triple", 1, dmg(1, { hits: 3 }))], { maxHp: 30 }, { statuses: { thorns: 2 } });
    startTurn(state);
    playCard(state, "triple");
    expect(p.hp).toBe(24);
  });

  it("Warded 1 deflects only the first hit of a 2-hit attack", () => {
    const { state, e } = duel([card("double", 1, dmg(5, { hits: 2 }))], {}, { statuses: { warded: 1 } });
    startTurn(state);
    playCard(state, "double");
    expect(e.hp).toBe(495);
    expect(e.statuses.stacks("warded")).toBe(0);
  });

  it("allEnemies: one attack per living enemy, in order, skipping the fallen; no target needed", () => {
    const p = player({ cards: [card("sweep", 1, dmg(5, { target: "allEnemies" }))], burnPower: 1, paralysisPower: 1 });
    const [e1, e2, e3] = [enemy("e1"), enemy("e2"), enemy("e3")];
    const { ctx, state } = fight([p, e1, e2, e3]);
    resolveHit(ctx, p, e2, phys(100)); // e2 falls before the turn
    startTurn(state);
    let res: PlayResult | undefined;
    const ev = during(ctx, () => (res = playCard(state, "sweep")));
    expect(res).toEqual({ ok: true });
    expect(hitTargets(ev)).toEqual(["e1", "e3"]);
    expect([e1.hp, e3.hp]).toEqual([25, 25]);
    // Per-attack powers once per enemy: one attack each.
    expect([e1.statuses.stacks("burning"), e3.statuses.stacks("burning")]).toEqual([1, 1]);
    expect([e1.statuses.stacks("paralysed"), e3.statuses.stacks("paralysed")]).toEqual([1, 1]);
    expect(e2.statuses.stacks("burning")).toBe(0);
  });

  it("allEnemies with 2 hits: two hits on each living enemy", () => {
    const p = player({ cards: [card("storm", 1, dmg(3, { target: "allEnemies", hits: 2 }))] });
    const [e1, e2] = [enemy("e1"), enemy("e2")];
    const { ctx, state } = fight([p, e1, e2]);
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "storm"));
    expect(hitTargets(ev)).toEqual(["e1", "e1", "e2", "e2"]);
    expect([e1.hp, e2.hp]).toEqual([24, 24]);
  });

  it("piercing on the damage effect skips Shield and Warded", () => {
    const { state, e } = duel([card("pierce", 1, dmg(6, { piercing: true }))], {}, { maxShield: 10, statuses: { warded: 1 } });
    startTurn(state);
    playCard(state, "pierce");
    expect(e.shield).toBe(10);
    expect(e.hp).toBe(494);
    expect(e.statuses.stacks("warded")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Statuses on a damaging card ride on its hits", () => {
  /** Dirty Trick as in the spec: 3 physical (+2 per Cunning, +1 per Agility) = 9, Enfeebled 2. */
  const DIRTY_TRICK = card(
    "dirty_trick",
    1,
    dmg(3, { scaling: [{ stat: "cunning", per: 2 }, { stat: "agility", per: 1 }] }),
    status("enfeebled", 2),
  );

  it("Dirty Trick lands: 9 damage, then Enfeebled 2 (StatusApplied after DamageDealt)", () => {
    const { ctx, state, e } = duel([DIRTY_TRICK], {}, { maxHp: 30 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "dirty_trick"));
    expect(e.hp).toBe(21);
    expect(e.statuses.stacks("enfeebled")).toBe(2);
    const types = typesOf(ev);
    expect(types.indexOf("StatusApplied")).toBeGreaterThan(types.indexOf("DamageDealt"));
  });

  it("Dirty Trick into Warded: deflected, no damage, no Enfeebled", () => {
    const { ctx, state, e } = duel([DIRTY_TRICK], {}, { maxHp: 30, statuses: { warded: 1 } });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "dirty_trick"));
    expect(e.hp).toBe(30);
    expect(e.statuses.stacks("enfeebled")).toBe(0);
    expect(e.statuses.stacks("warded")).toBe(0);
    expect(eventsOf(ev, "HitDeflected")).toHaveLength(1);
    expect(eventsOf(ev, "StatusApplied")).toEqual([]);
  });

  it("carried by every hit: Lei-like 2 hits with Stunned 4 -> Stunned 8 (12 arcane x 2 = 24)", () => {
    const lei2 = card("lei2", 2, dmg(6, { damageType: "arcane", hits: 2, scaling: [{ stat: "arcana", per: 3 }] }), status("stunned", 4));
    const { ctx, state, e } = duel([lei2], {}, { maxHp: 50 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "lei2"));
    expect(e.hp).toBe(26); // 50 - 24
    expect(e.statuses.stacks("stunned")).toBe(8);
    expect(eventsOf(ev, "StatusApplied").map((x) => [x.stacks, x.total])).toEqual([[4, 4], [4, 8]]);
  });

  it("a deflected hit carries none, the next hit does (2 hits into Warded 1 -> Enfeebled 2 once)", () => {
    const { state, e } = duel([card("double_trick", 1, dmg(2, { hits: 2 }), status("enfeebled", 2))], {}, { statuses: { warded: 1 } });
    startTurn(state);
    playCard(state, "double_trick");
    expect(e.statuses.stacks("enfeebled")).toBe(2);
    expect(e.hp).toBe(498);
  });

  it("only the first damage effect carries them (2 hits + 1 hit, Bleeding 1 -> Bleeding 2)", () => {
    const { state, e } = duel([card("combo", 1, dmg(1, { hits: 2 }), dmg(1), status("bleeding", 1))]);
    startTurn(state);
    playCard(state, "combo");
    expect(e.statuses.stacks("bleeding")).toBe(2);
    expect(e.hp).toBe(497);
  });

  it("the carried status is applied before the attacker's per-hit powers (hit order step 7)", () => {
    const { ctx, state } = duel([card("cut", 1, dmg(1), status("burning", 1))], { bleedPower: 1 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "cut"));
    expect(eventsOf(ev, "StatusApplied").map((x) => x.status)).toEqual(["burning", "bleeding"]);
  });

  it("resistance applies to carried statuses (Vitality 4: Enfeebled 3 -> 1)", () => {
    const { state, e } = duel([card("cut", 1, dmg(1), status("enfeebled", 3))], {}, { stats: { vitality: 4 } });
    startTurn(state);
    playCard(state, "cut");
    expect(e.statuses.stacks("enfeebled")).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Status-only cards apply directly (not an attack)", () => {
  const HEX = card("hex", 1, status("enfeebled", 2));

  it("applies the status with no hit", () => {
    const { ctx, state, e } = duel([HEX]);
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "hex"));
    expect(e.statuses.stacks("enfeebled")).toBe(2);
    expect(eventsOf(ev, "HitStarted")).toEqual([]);
    expect(eventsOf(ev, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "e", status: "enfeebled", stacks: 2, total: 2 }]);
  });

  it("Warded can't deflect it: the status lands and no charge is used", () => {
    const { ctx, state, e } = duel([HEX], {}, { statuses: { warded: 1 } });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "hex"));
    expect(e.statuses.stacks("enfeebled")).toBe(2);
    expect(e.statuses.stacks("warded")).toBe(1);
    expect(eventsOf(ev, "HitDeflected")).toEqual([]);
  });

  it("Thorns doesn't fire (it is not an attack)", () => {
    const { state, p } = duel([HEX], { maxHp: 30 }, { statuses: { thorns: 5 } });
    startTurn(state);
    playCard(state, "hex");
    expect(p.hp).toBe(30);
  });

  it("no powers (Bleed, Stun, Burn, Poison, Paralysis power all 2): only the card's status", () => {
    const { state, e } = duel([HEX], { bleedPower: 2, stunPower: 2, burnPower: 2, poisonPower: 2, paralysisPower: 2 });
    startTurn(state);
    playCard(state, "hex");
    expect(STATUS_IDS.filter((s) => e.statuses.stacks(s) > 0)).toEqual(["enfeebled"]);
  });

  it("resistance applies (Vitality 3: Enfeebled 3 -> 2)", () => {
    const { state, e } = duel([card("hex3", 1, status("enfeebled", 3))], {}, { stats: { vitality: 3 } });
    startTurn(state);
    playCard(state, "hex3");
    expect(e.statuses.stacks("enfeebled")).toBe(2);
  });

  it("chance 1 always applies; chance 0.5 applies on some seeds and not others", () => {
    const one = duel([card("sure", 1, status("enfeebled", 2, { chance: 1 }))]);
    startTurn(one.state);
    playCard(one.state, "sure");
    expect(one.e.statuses.stacks("enfeebled")).toBe(2);

    const outcomes = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const p = player({ cards: [card("maybe", 1, status("enfeebled", 2, { chance: 0.5 }))] });
      const e = enemy();
      const { state } = fight([p, e], `hex-chance-${i}`);
      startTurn(state);
      playCard(state, "maybe");
      outcomes.add(e.statuses.stacks("enfeebled"));
    }
    expect([...outcomes].sort()).toEqual([0, 2]);
  });

  it("a status-only card goes on cooldown and ends the turn", () => {
    const { ctx, state, p } = duel([HEX]);
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "hex"));
    expect(p.cooldowns.remaining("hex")).toBe(1);
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
  });
});

// ---------------------------------------------------------------------------------------------
describe("Self effects apply directly to the user", () => {
  it("heal scales with the user's stats (4 + 3 x Wisdom 4 = 16): 10 -> 26, Healed 16", () => {
    const mend = card("mend", 2, { type: "heal", amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 3 }] });
    const { ctx, state, p } = duel([mend], { maxHp: 30, hp: 10, stats: { wisdom: 4 } }, { stats: { wisdom: 9 } });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "mend"));
    expect(p.hp).toBe(26);
    expect(eventsOf(ev, "Healed")).toEqual([{ type: "Healed", unit: "p", amount: 16 }]);
  });

  it("heal is capped at max HP (25/30 + 10 -> 30, Healed 5)", () => {
    const mend = card("mend", 2, { type: "heal", amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 3 }] });
    const { ctx, state, p } = duel([mend], { maxHp: 30, hp: 25 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "mend"));
    expect(p.hp).toBe(30);
    expect(eventsOf(ev, "Healed")).toEqual([{ type: "Healed", unit: "p", amount: 5 }]);
  });

  it("restoreShield scales with the user (5 + 2 x Vitality 2 = 9): 4 -> 13 of 20", () => {
    const shoreUp = card("shore_up", 2, { type: "restoreShield", amount: 5, target: "self", scaling: [{ stat: "vitality", per: 2 }] });
    const { ctx, state, p, e } = duel([shoreUp], { maxShield: 20 });
    resolveHit(ctx, e, p, phys(16)); // Shield 20 -> 4
    expect(p.shield).toBe(4);
    startTurn(state);
    playCard(state, "shore_up");
    expect(p.shield).toBe(13);
  });

  it("restoreShield is capped at max Shield (4 + 9 -> 10 of 10)", () => {
    const shoreUp = card("shore_up", 2, { type: "restoreShield", amount: 5, target: "self", scaling: [{ stat: "vitality", per: 2 }] });
    const { ctx, state, p, e } = duel([shoreUp], { maxShield: 10 });
    resolveHit(ctx, e, p, phys(6)); // Shield 10 -> 4
    startTurn(state);
    playCard(state, "shore_up");
    expect(p.shield).toBe(10);
  });

  it("Dun-like: Warded 1 on the user and 4 + 2 x Wisdom 2 = 8 Shield", () => {
    const dun = card(
      "dun",
      2,
      status("warded", 1, { target: "self" }),
      { type: "restoreShield", amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 2 }] },
    );
    const { ctx, state, p, e } = duel([dun], { maxShield: 20 });
    resolveHit(ctx, e, p, phys(20)); // Shield 20 -> 0
    startTurn(state);
    playCard(state, "dun");
    expect(p.statuses.stacks("warded")).toBe(1);
    expect(p.shield).toBe(8);
  });

  it("self effects apply even when the card's attack is deflected (Warded 1 on the user after a deflected hit)", () => {
    const guardStrike = card("guard_strike", 1, dmg(5), status("warded", 1, { target: "self" }));
    const { state, p, e } = duel([guardStrike], {}, { statuses: { warded: 1 } });
    startTurn(state);
    playCard(state, "guard_strike");
    expect(e.hp).toBe(500);
    expect(p.statuses.stacks("warded")).toBe(1);
  });

  it("effects run in the card's order (Healed before HitStarted when the heal is listed first)", () => {
    const c = card("drain", 1, { type: "heal", amount: 3, target: "self" }, dmg(2));
    const { ctx, state } = duel([c], { hp: 100 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "drain"));
    const types = typesOf(ev);
    expect(types.indexOf("Healed")).toBeLessThan(types.indexOf("HitStarted"));
  });
});

// ---------------------------------------------------------------------------------------------
describe("Consume through a card", () => {
  it("Combustion card on Burning 5: 5 x 3 = 15 arcane, Burning removed, Consumed", () => {
    const combustion = card("combustion", 2, { type: "consume", status: "burning", multiplier: 3, damageType: "arcane", target: "enemy" });
    const { ctx, state, e } = duel([combustion], {}, { maxHp: 30, statuses: { burning: 5 } });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "combustion"));
    expect(e.hp).toBe(15);
    expect(e.statuses.stacks("burning")).toBe(0);
    expect(eventsOf(ev, "Consumed")).toEqual([{ type: "Consumed", unit: "e", status: "burning", stacks: 5 }]);
  });

  it("a capped consume through a card (max 3 of Burning 5 -> 9 damage, 2 stay)", () => {
    const capped = card("ember_eat", 2, { type: "consume", status: "burning", multiplier: 3, damageType: "arcane", target: "enemy", max: 3 });
    const { state, e } = duel([capped], {}, { maxHp: 30, statuses: { burning: 5 } });
    startTurn(state);
    playCard(state, "ember_eat");
    expect(e.hp).toBe(21);
    expect(e.statuses.stacks("burning")).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Fallen units during a card", () => {
  it("a target that falls is skipped by the card's remaining effects", () => {
    const p = player({ cards: [card("overkill", 1, dmg(10), dmg(5))] });
    const [e1, e2] = [enemy("e1", { hp: 10 }), enemy("e2")];
    const { ctx, state } = fight([p, e1, e2]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "overkill", "e1")).toEqual({ ok: true }));
    expect(e1.fallen).toBe(true);
    expect(hitTargets(ev)).toEqual(["e1"]);
    expect(e2.hp).toBe(30);
    expect(state.over).toBe(false);
    expect(ev.at(-1)).toEqual({ type: "TurnEnded", unit: "p" });
    expect(activeId(state)).toBe("e2");
  });

  it("the user falls to Thorns mid-card: the remaining effects do nothing; the fight ends (enemy wins)", () => {
    // Player 3 HP, no Shield. Enemy Thorns 5. First hit: Thorns 5 -> player 0 HP; the hit still finishes (1 damage).
    const c = card(
      "reckless",
      1,
      dmg(1),
      dmg(1),
      { type: "heal", amount: 10, target: "self" },
      status("warded", 1, { target: "self" }),
    );
    const { ctx, state, p, e } = duel([c], { maxHp: 30, hp: 3 }, { maxHp: 30, statuses: { thorns: 5 } });
    startTurn(state);
    let res: PlayResult | undefined;
    const ev = during(ctx, () => (res = playCard(state, "reckless")));
    expect(res).toEqual({ ok: true });
    expect(p.fallen).toBe(true);
    expect(p.hp).toBe(0);
    expect(eventsOf(ev, "HitStarted")).toHaveLength(1);
    expect(e.hp).toBe(29);
    expect(eventsOf(ev, "Healed")).toEqual([]);
    expect(p.statuses.stacks("warded")).toBe(0);
    expect(state.over).toBe(true);
    expect(state.winner).toBe("enemy");
  });

  it("a user that falls to Thorns during its card skips its turn-end effects (Emboldened 2 stays 2)", () => {
    const c = card("reckless", 1, dmg(1));
    const p = player({ maxHp: 30, hp: 3, cards: [c], statuses: { emboldened: 2 } });
    const e = enemy("e", { statuses: { thorns: 5 } });
    const { state } = fight([p, e]);
    startTurn(state);
    playCard(state, "reckless");
    expect(p.fallen).toBe(true);
    expect(p.statuses.stacks("emboldened")).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Determinism", () => {
  it("the same seed and the same plays give the same events", () => {
    const run = (): CombatEvent[] => {
      const p = player({ cards: [card("maybe", 1, dmg(2), status("burning", 2, { chance: 0.5 })), STRIKE] });
      const e: CombatUnit = enemy("e", { maxHp: 200 });
      const { ctx, state } = fight([p, e], "cards-determinism");
      for (let r = 0; r < 6; r++) {
        startTurn(state);
        if (p.cooldowns.ready("maybe")) playCard(state, "maybe");
        else playCard(state, "strike");
        pass(state);
      }
      return ctx.events;
    };
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------------------------
// Spec 1.7 (clarified): "Statuses a card puts on its user are the user's own, so resistance doesn't apply (as for
// converts)."
describe("Statuses a card puts on its user are unresisted", () => {
  it("self Emboldened 3 on a user with all stats 9 lands as 3", () => {
    const all9 = { might: 9, vitality: 9, cunning: 9, agility: 9, arcana: 9, intelligence: 9, wisdom: 9 };
    const { ctx, state } = duel([card("rally", 2, status("emboldened", 3, { target: "self" }))], { stats: all9 });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "rally"));
    expect(eventsOf(ev, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "p", status: "emboldened", stacks: 3, total: 3 }]);
  });

  it("a resistible self status (Enfeebled 3, user Vitality 6) lands as 3, no StatusResisted", () => {
    // Against an enemy, Vitality 6 would remove 4 stacks (minimum 1). On the user, none.
    const { ctx, state } = duel([card("frenzy", 2, status("enfeebled", 3, { target: "self" }))], { stats: { vitality: 6 } });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "frenzy"));
    expect(eventsOf(ev, "StatusApplied")).toEqual([{ type: "StatusApplied", unit: "p", status: "enfeebled", stacks: 3, total: 3 }]);
    expect(eventsOf(ev, "StatusResisted")).toEqual([]);
  });

  it("a self meter (Paralysed 4, user Wisdom 6) lands as 4 and stays (meters don't decay)", () => {
    const { state, p } = duel([card("trance", 2, status("paralysed", 4, { target: "self" }))], { stats: { wisdom: 6 } });
    startTurn(state);
    playCard(state, "trance");
    expect(p.statuses.stacks("paralysed")).toBe(4);
  });

  it("enemy statuses on the same card are still resisted (Enfeebled 3 on a Vitality 4 enemy -> 1)", () => {
    const c = card("mutual", 2, status("enfeebled", 3, { target: "self" }), status("enfeebled", 3));
    const { ctx, state, e } = duel([c], { stats: { vitality: 6 } }, { stats: { vitality: 4 } });
    startTurn(state);
    const ev = during(ctx, () => playCard(state, "mutual"));
    expect(eventsOf(ev, "StatusApplied").find((x) => x.unit === "p")?.stacks).toBe(3);
    expect(e.statuses.stacks("enfeebled")).toBe(1); // 3 - (4 - 2) = 1
  });
});

// ---------------------------------------------------------------------------------------------
// Spec 1.7 (clarified), "Which enemies a riding status reaches": "a status effect on enemies rides on the hits of the
// card's first damage effect against each enemy it covers; an enemy that damage effect doesn't hit gets the status
// directly. A status on 'the chosen enemy' only rides on hits against that enemy."
describe("Riding statuses with allEnemies", () => {
  /** Two enemies: e1 Warded 1, e2 not. */
  const pair = (cards: readonly CardSpec[]) => {
    const p = player({ cards });
    const e1 = enemy("e1", { statuses: { warded: 1 } });
    const e2 = enemy("e2");
    const f = fight([p, e1, e2]);
    startTurn(f.state);
    return { p, e1, e2, ...f };
  };

  it("allEnemies damage + allEnemies status: rides on each enemy's hits (Warded e1 gets none, e2 gets it)", () => {
    const { ctx, state, e1, e2 } = pair([card("quake", 1, dmg(2, { target: "allEnemies" }), status("enfeebled", 2, { target: "allEnemies" }))]);
    const ev = during(ctx, () => expect(playCard(state, "quake")).toEqual({ ok: true }));
    expect([e1.hp, e1.statuses.stacks("warded"), e1.statuses.stacks("enfeebled")]).toEqual([30, 0, 0]);
    expect([e2.hp, e2.statuses.stacks("enfeebled")]).toEqual([28, 2]);
    expect(eventsOf(ev, "HitDeflected")).toEqual([{ type: "HitDeflected", attacker: "p", target: "e1" }]);
  });

  it("allEnemies damage with 2 hits + allEnemies status: carried by every hit on each enemy (Warded 1 e1: 2, e2: 4)", () => {
    const { state, e1, e2 } = pair([card("quake2", 1, dmg(1, { target: "allEnemies", hits: 2 }), status("bleeding", 2, { target: "allEnemies" }))]);
    playCard(state, "quake2");
    // e1: first hit deflected, second carries Bleeding 2. e2: both hits carry it.
    expect(e1.statuses.stacks("bleeding")).toBe(2);
    expect(e2.statuses.stacks("bleeding")).toBe(4);
  });

  it("chosen-enemy damage + allEnemies status: rides on the chosen enemy's hits; the others get it directly (not deflectable)", () => {
    const p = player({ cards: [card("hex_cut", 1, dmg(2, { hits: 2 }), status("enfeebled", 2, { target: "allEnemies" }))] });
    const e1 = enemy("e1");
    const e2 = enemy("e2", { statuses: { warded: 1 } });
    const { ctx, state } = fight([p, e1, e2]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "hex_cut", "e1")).toEqual({ ok: true }));
    // e1 (chosen): 2 hits of 2, each carrying Enfeebled 2 -> 4.
    expect([e1.hp, e1.statuses.stacks("enfeebled")]).toEqual([26, 4]);
    // e2: not hit; gets Enfeebled 2 once, directly; its Warded charge is not used.
    expect([e2.hp, e2.statuses.stacks("enfeebled"), e2.statuses.stacks("warded")]).toEqual([30, 2, 1]);
    expect(eventsOf(ev, "HitStarted").map((x) => x.target)).toEqual(["e1", "e1"]);
    expect(eventsOf(ev, "HitDeflected")).toEqual([]);
  });

  it("chosen-enemy damage deflected by Warded + allEnemies status: the chosen gets none, the other gets it directly", () => {
    const p = player({ cards: [card("hex_cut", 1, dmg(2), status("enfeebled", 2, { target: "allEnemies" }))] });
    const e1 = enemy("e1", { statuses: { warded: 1 } });
    const e2 = enemy("e2");
    const { state } = fight([p, e1, e2]);
    startTurn(state);
    playCard(state, "hex_cut", "e1");
    expect(e1.statuses.stacks("enfeebled")).toBe(0);
    expect(e2.statuses.stacks("enfeebled")).toBe(2);
  });

  it("the directly applied part is resisted as usual (e2 Vitality 3: Enfeebled 3 -> 2)", () => {
    const p = player({ cards: [card("hex_cut", 1, dmg(1), status("enfeebled", 3, { target: "allEnemies" }))] });
    const e1 = enemy("e1");
    const e2 = enemy("e2", { stats: { vitality: 3 } });
    const { state } = fight([p, e1, e2]);
    startTurn(state);
    playCard(state, "hex_cut", "e1");
    expect(e1.statuses.stacks("enfeebled")).toBe(3);
    expect(e2.statuses.stacks("enfeebled")).toBe(2);
  });

  it("allEnemies damage + chosen-enemy status: only the chosen enemy gets it, on its hits", () => {
    const p = player({ cards: [card("mark_sweep", 1, dmg(2, { target: "allEnemies" }), status("enfeebled", 2))] });
    const e1 = enemy("e1");
    const e2 = enemy("e2");
    const { state } = fight([p, e1, e2]);
    startTurn(state);
    expect(playCard(state, "mark_sweep", "e2")).toEqual({ ok: true });
    expect([e1.hp, e2.hp]).toEqual([28, 28]);
    expect(e1.statuses.stacks("enfeebled")).toBe(0);
    expect(e2.statuses.stacks("enfeebled")).toBe(2);
  });

  it("allEnemies damage + chosen-enemy status into a Warded chosen enemy: nobody gets it", () => {
    const p = player({ cards: [card("mark_sweep", 1, dmg(2, { target: "allEnemies" }), status("enfeebled", 2))] });
    const e1 = enemy("e1");
    const e2 = enemy("e2", { statuses: { warded: 1 } });
    const { state } = fight([p, e1, e2]);
    startTurn(state);
    playCard(state, "mark_sweep", "e2");
    expect(e1.statuses.stacks("enfeebled")).toBe(0);
    expect(e2.statuses.stacks("enfeebled")).toBe(0);
  });

  it("allEnemies status with no damage effect: applied directly to each living enemy (Warded doesn't stop it)", () => {
    const { ctx, state, e1, e2 } = pair([card("miasma", 2, status("poisoned", 2, { target: "allEnemies" }))]);
    const ev = during(ctx, () => expect(playCard(state, "miasma")).toEqual({ ok: true }));
    expect([e1.statuses.stacks("poisoned"), e2.statuses.stacks("poisoned")]).toEqual([2, 2]);
    expect(e1.statuses.stacks("warded")).toBe(1);
    expect(eventsOf(ev, "HitStarted")).toEqual([]);
  });
});

describe("Whose action: playCard while an enemy is active", () => {
  it("returns not_your_turn with no events and no change, whatever the card", () => {
    const { ctx, state } = duel([STRIKE, JAB]);
    startTurn(state);
    passTurn(state);
    startTurn(state); // the enemy's turn, started
    expectRejected(ctx, state, () => playCard(state, "strike", "e"), "not_your_turn");
    expectRejected(ctx, state, () => playCard(state, "jab"), "not_your_turn");
    expectRejected(ctx, state, () => passTurn(state), "not_your_turn");
  });
});
