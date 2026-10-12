import { describe, expect, it } from "vitest";
import {
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
  tierBandAt,
  type ActDef,
  type CombatContext,
} from "../../../src/index.ts";
import { reopenFight } from "../../../src/combat/turn.ts";
import { combatCtx, fightAgainst, FIGHT_PICKS, runInFight, STRIKE, startCombatRun, unitOf } from "../combat-pack.ts";
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
