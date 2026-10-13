import { describe, expect, it } from "vitest";
import {
  fightPass,
  startFight,
  type FightSession,
  type RunContext,
  type RunState,
  beginCombat,
  chooseOption,
  combatNodeType,
  createUnit,
  createRng,
  fallInNode,
  finishFight,
  fightOutcome,
  fightPlay,
  loadoutUnit,
  resumeFightAfterRevive,
  revive,
  skipReward,
  tierBandAt,
  type ActDef,
  type CombatContext,
} from "../../../src/index.ts";
import { reopenFight } from "../../../src/combat/turn.ts";
import {
  combatCtx,
  enemiesOf,
  enemyFile,
  eventsOf,
  fightAct,
  fightAgainst,
  FIGHT_PICKS,
  groupFile,
  move,
  playerOf,
  runInFight,
  STRIKE,
  startCombatRun,
  TECHNIQUE,
  unitOf,
  type Ev,
} from "../combat-pack.ts";
import { ok, snapshot } from "../run-pack.ts";

// Builder unit tests for M2.3 (internals and edges the spec tests don't reach).

const act = (tiers: ActDef["tiers"]): ActDef => ({
  kind: "act",
  id: "act.u",
  name: "act.u.name",
  steps: { min: 3, max: 3 },
  weights: { combat: 1 },
  fixed: [],
  groups: ["group.n1"],
  ...(tiers === undefined ? {} : { tiers }),
});

describe("tierBandAt", () => {
  const bands = [
    { from: 1, weights: { normal: 1 } },
    { from: 4, weights: { hard: 1 } },
  ];
  it("takes the last band starting at or before the step", () => {
    expect(tierBandAt(act(bands), 1)).toBe(bands[0]);
    expect(tierBandAt(act(bands), 3)).toBe(bands[0]);
    expect(tierBandAt(act(bands), 4)).toBe(bands[1]);
    expect(tierBandAt(act(bands), 99)).toBe(bands[1]);
  });
  it("is null without tiers", () => {
    expect(tierBandAt(act(undefined), 1)).toBeNull();
  });
});

describe("combat node build", () => {
  it("is deterministic in its rng", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    const def = ctx.pack.byId.get("act.c");
    if (def?.kind !== "act") throw new Error("no act");
    const build = (seed: string) => combatNodeType.build({ run, act: def, pack: ctx.pack, fixed: false, ref: null, rng: createRng(seed) });
    expect(build("x")).toEqual(build("x"));
  });
});

describe("loadoutUnit", () => {
  it("throws RangeError for a card id that is a content id of another kind", () => {
    const ctx = combatCtx();
    const run = startCombatRun(ctx);
    expect(() => loadoutUnit(ctx.pack, FIGHT_PICKS, run.player.baseStats, 10, 10, ["accessory.locket"])).toThrow(RangeError);
  });
});

describe("enemy units", () => {
  it("don't share trait objects with the content pack", () => {
    const { session } = fightAgainst("group.trio");
    const a = unitOf(session, "enemy1");
    const b = unitOf(session, "enemy3");
    expect(a.traits).not.toBe(b.traits);
    expect(a.traits.decayFloors).toEqual(b.traits.decayFloors);
  });
});

describe("finishFight and resume guards", () => {
  it("refuses a finished session once the run is in another node", () => {
    const { ctx, run, session } = fightAgainst("group.dummy");
    let n = 0;
    while (fightOutcome(session) === "ongoing" && n++ < 50) fightPlay(session, STRIKE);
    expect(fightOutcome(session)).toBe("won");
    ok(finishFight(ctx, run, session));
    expect(run.phase).toBe("rewards"); // spec 1.11: the rewards screen comes first
    ok(skipReward(ctx, run));
    ok(chooseOption(ctx, run, 0)); // step 2: a fake event
    expect(run.phase).toBe("inNode");
    const before = snapshot(run);
    expect(finishFight(ctx, run, session)).toEqual({ ok: false, reason: "wrong_phase" });
    expect(snapshot(run)).toEqual(before);
  });

  it("a both-fall revived into a fight with no living enemy ends it as won", () => {
    const { ctx, run, session } = fightAgainst("group.spiky");
    fightPlay(session, STRIKE);
    expect(fightOutcome(session)).toBe("fallen");
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, { action: "revive", source: "ad" }));
    resumeFightAfterRevive(run, session);
    expect(fightOutcome(session)).toBe("won");
    const before = run.player.hp;
    ok(finishFight(ctx, run, session));
    expect(run.player.hp).toBe(before);
    expect(run.phase).toBe("rewards"); // spec 1.11: the won fight opens the rewards screen
    ok(skipReward(ctx, run));
    expect(run.phase).toBe("choosing");
  });

  it("fellInNode: false at start, true after fallInNode (survives JSON), false again after the revive", () => {
    const { ctx, run } = runInFight("group.dummy");
    expect(run.fellInNode).toBe(false);
    ok(fallInNode(run));
    expect(snapshot(run).fellInNode).toBe(true);
    ok(revive(ctx, run, { action: "revive", source: "ad" }));
    expect(run.fellInNode).toBe(false);
    expect(run.phase).toBe("inNode");
  });
});

describe("reopenFight", () => {
  const ctxOf = (): CombatContext => ({ rng: createRng("r"), events: [], fight: null, triggerDepth: 0 });

  it("throws while the fight is ongoing, or for a fallen unit", () => {
    const p = createUnit({ id: "p", side: "player", maxHp: 10 });
    const e = createUnit({ id: "e", side: "enemy", maxHp: 10 });
    const state = beginCombat(ctxOf(), [p, e]);
    expect(() => reopenFight(state, p)).toThrow(RangeError);
    p.hp = 0;
    const ended = beginCombat(ctxOf(), [p, e]);
    expect(ended.over).toBe(true);
    expect(() => reopenFight(ended, p)).toThrow(RangeError);
  });
});

// =============================================================================================
// Review fixes (spec 1.10, "The player falls": the turn of the fall is finished first, as a turn ends; if the
// enemies had fallen too, the revived player has won).

const REVIVE = { action: "revive", source: "ad" } as const;

/** A fixed fight at step 1 against a one-enemy group made of `enemy`. */
function fightWith(enemy: ReturnType<typeof enemyFile>, seed = "rv"): { ctx: RunContext; run: RunState; session: FightSession } {
  const id = (enemy.data as { id: string }).id;
  const ctx = combatCtx([fightAct("group.rv"), enemy, groupFile("group.rv", "normal", [id])]);
  const run = startCombatRun(ctx, seed);
  ok(chooseOption(ctx, run, 0));
  return { ctx, run, session: startFight(ctx, run) };
}

const enemyCards = (session: FightSession, from: number): string[] =>
  eventsOf(session)
    .slice(from)
    .filter((e: Ev) => e.type === "CardPlayed" && e["unit"] === "enemy1")
    .map((e: Ev) => String(e["card"]));

describe("revive after an enemy's killing move", () => {
  // "big" (cooldown 3) fells the player in one hit; "small" is a 1-damage jab.
  const KILLER = enemyFile("enemy.killer", {
    hp: 500,
    moves: [move("enemy.killer", "big", 60, { cooldown: 3, weight: 1000 }), move("enemy.killer", "small", 1)],
  });
  const BIG = "enemy.killer.big";

  function fallen() {
    const f = fightWith(KILLER);
    expect(fightPlay(f.session, STRIKE).ok).toBe(true);
    expect(fightOutcome(f.session)).toBe("fallen");
    expect(enemyCards(f.session, 0)).toEqual([BIG]);
    ok(finishFight(f.ctx, f.run, f.session));
    ok(revive(f.ctx, f.run, REVIVE));
    return f;
  }

  it("finishes the enemy's turn: TurnEnded, then its next intent, which is the move it then uses", () => {
    const { run, session } = fallen();
    const from = eventsOf(session).length;
    resumeFightAfterRevive(run, session);
    const after = eventsOf(session).slice(from);
    expect(after.findIndex((e) => e.type === "TurnEnded" && e["unit"] === "enemy1")).toBeGreaterThanOrEqual(0);
    const enemy = unitOf(session, "enemy1");
    expect(enemy.intent).toBe("enemy.killer.small"); // big is on cooldown: the only ready move
    for (let turn = 0; turn < 3; turn++) {
      const shown = enemy.intent;
      const mark = eventsOf(session).length;
      expect(fightPass(session).ok).toBe(true);
      expect(enemyCards(session, mark)).toEqual([shown]);
    }
  });

  it("the killing move's cooldown counts from the turn it was used: ready on the enemy's 4th turn after it", () => {
    const { run, session } = fallen();
    resumeFightAfterRevive(run, session);
    const enemy = unitOf(session, "enemy1");
    // Used on the fall's turn (no decrement that turn), then 3 waiting turns.
    expect(enemy.cooldowns.remaining(BIG)).toBe(3);
    for (const left of [2, 1, 0]) {
      expect(fightPass(session).ok).toBe(true);
      expect(enemy.cooldowns.remaining(BIG)).toBe(left);
    }
  });
});

describe("revive after falling to Thorns on one's own card", () => {
  const THORNY = enemyFile("enemy.thorny", { hp: 500, statuses: { thorns: 100 }, moves: [move("enemy.thorny", "prick", 1)] });

  it("the card's cooldown ticks as on any turn: not ready on the resumed turn, ready on the next", () => {
    const { ctx, run, session } = fightWith(THORNY);
    expect(fightPlay(session, TECHNIQUE).ok).toBe(true); // cooldown 1; Thorns fells the player
    expect(playerOf(session).fallen).toBe(true);
    expect(fightOutcome(session)).toBe("fallen");
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);
    const p = playerOf(session);
    expect(p.cooldowns.remaining(TECHNIQUE)).toBe(1);
    expect(fightPlay(session, TECHNIQUE).ok).toBe(false);
    expect(fightPass(session).ok).toBe(true);
    expect(p.cooldowns.remaining(TECHNIQUE)).toBe(0);
    expect(fightPlay(session, TECHNIQUE).ok).toBe(true);
  });
});

describe("revive after both sides fell", () => {
  it("the fight ends at once with the player's win, and the node completes", () => {
    const { ctx, run, session } = fightAgainst("group.spiky");
    fightPlay(session, STRIKE);
    expect(enemiesOf(session).every((u) => u.fallen)).toBe(true);
    expect(fightOutcome(session)).toBe("fallen");
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, REVIVE));
    const from = eventsOf(session).length;
    resumeFightAfterRevive(run, session);
    expect(fightOutcome(session)).toBe("won");
    expect(eventsOf(session).slice(from)).toContainEqual({ type: "CombatEnded", winner: "player" });
    expect(eventsOf(session).slice(from).some((e) => e.type === "TurnStarted")).toBe(false);
    const events = ok(finishFight(ctx, run, session));
    expect(events[0]).toMatchObject({ type: "NodeCompleted", nodeType: "combat", hpChange: 0, crownsChange: 0 });
    expect(events[1]).toMatchObject({ type: "RewardsOffered", tier: "normal", rerolls: 0 });
    expect(run.phase).toBe("rewards");
    expect(run.step).toBe(1);
    ok(skipReward(ctx, run));
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
  });
});

describe("a fall is reported once", () => {
  const brute = () => {
    const f = fightAgainst("group.brute");
    fightPlay(f.session, STRIKE);
    fightPlay(f.session, TECHNIQUE);
    expect(fightOutcome(f.session)).toBe("fallen");
    return f;
  };

  it("finishFight refuses the same fall after the revive (no second fall, no second revive)", () => {
    const { ctx, run, session } = brute();
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, REVIVE));
    const before = snapshot(run);
    expect(finishFight(ctx, run, session)).toEqual({ ok: false, reason: "wrong_phase" });
    expect(snapshot(run)).toEqual(before);
    expect(run.phase).toBe("inNode");
    expect(run.limits.used.revive).toBe(1);
  });

  it("resumeFightAfterRevive throws for a fall that wasn't reported", () => {
    const { ctx, run, session } = brute();
    ok(fallInNode(run));
    ok(revive(ctx, run, REVIVE));
    expect(() => resumeFightAfterRevive(run, session)).toThrow(RangeError);
  });

  it("after a resume, a new fall can be reported", () => {
    const { ctx, run, session } = brute();
    ok(finishFight(ctx, run, session));
    ok(revive(ctx, run, REVIVE));
    resumeFightAfterRevive(run, session);
    for (let n = 0; n < 10 && fightOutcome(session) === "ongoing"; n++) if (!fightPlay(session, STRIKE).ok) fightPass(session);
    expect(fightOutcome(session)).toBe("fallen");
    expect(finishFight(ctx, run, session).ok).toBe(true);
    expect(run.phase).toBe("fallen");
  });
});

