import { describe, expect, it } from "vitest";
import {
  assemblePlayer,
  chooseOption,
  chooseRoute,
  completeNode,
  endRun,
  initialRunLimits,
  NodeRegistry,
  revive,
  startRun,
  type ActDef,
  type CommandResult,
  type ContentFile,
  type NodeOption,
  type NodeResult,
  type RunContext,
  type RunEvent,
  type RunRefusal,
  type RunState,
} from "../../src/index.ts";
import {
  ACT_ONE,
  BOSS,
  PICKS,
  actFile,
  autoplay,
  ctxOf,
  dataOf,
  fakeType,
  kinds,
  ok,
  playNode,
  snapshot,
  start,
  type BuildCall,
  type CanAppear,
} from "./run-pack.ts";

// Spec Draft 1.9, "Run map" (decided 12 Oct 2026), "Core loop", "Nodes (modular)", "Monetisation architecture";
// brief M2.2 (public API, events, rules notes):
//   act.json: steps {min, max}, rolled once per act on entry, uniformly. weights: type → non-negative integer.
//     fixed: {at, type, ref}; exactly one "last" (the boss). routes: {to, flags?, notFlags?}; an act with no
//     routes ends the run in victory after its boss. first: the act a run starts in.
//   A type id the run engine has no module for is an error when the run starts.
//   Fixed step: offers only that node; weights and the draw rules don't apply.
//   Other steps: 3 options. Drawable types: weight > 0 and canAppear, minus a type that may not follow itself if
//     the previous node (previous act too, fixed nodes count) was of that type. Options 1 and 2 by weight
//     (repeats allowed); if they are the same type and another type can be drawn, option 3 by weight from the
//     other types only, else like the first two. No drawable type: the engine reports an error.
//   Each option is built when offered; two options of the same type are different nodes. Step count, each step's
//     draw and each option's build use their own streams (seed, act, step, option position).
//   Node result: HP stays in [0, max HP]; crowns never below 0 (refused). Integers only (brief). Flags: a set in
//     insertion order; clear applies after set (brief).
//   Run state is plain data (survives a JSON round trip). Quitting mid-node restarts the same node.
//   Commands that don't fit the phase or name a missing option/route are refused and change nothing.
//   Falling: HP 0 → fallen; revive (run limit, grant) at half max HP rounded up, then move on as if the node
//     had finished; or end the run (lost). Revive limit 2 per run (Monetisation), enforced by consume().
//   After the last step: open routes (all flags set, no notFlags set, in the act's order); choosing one starts that
//     act at step 1 with a new step count; no routes → won.
// Brief clarifications: NodeEntered / NodeCompleted name the node type `nodeType`; every type named by any act
//   (weights, even weight 0, and fixed) must be registered at startRun; options keep draw order; streams include the
//   act's position in the run, so an act visited twice draws afresh; `routes: []` = no routes; empty flags/notFlags =
//   no conditions; `node` is null once the run is won or lost.

const seeds = (n: number, prefix = "s"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

type Ev = RunEvent & Record<string, unknown>;
const evs = (events: readonly RunEvent[]): Ev[] => events as unknown as Ev[];
const find = (events: readonly RunEvent[], type: string): Ev | undefined => evs(events).find((e) => e.type === type);

const optionsOf = (run: RunState): { type: string; fixed: boolean }[] => run.offer.map((o) => ({ type: o.type, fixed: o.fixed }));

/** Asserts the command is refused with `reason` and leaves the run deep-equal to before. */
function expectRefused(run: RunState, command: () => CommandResult, reason: RunRefusal): void {
  const before = snapshot(run);
  const res = command();
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toBe(reason);
  expect(snapshot(run)).toEqual(before);
}

/** Plays option 0 with an empty result until the run is offering `step` (same act). */
function toStep(ctx: RunContext, run: RunState, step: number): void {
  while (run.step < step) playNode(ctx, run, 0, {});
  expect(run.phase).toBe("choosing");
  expect(run.step).toBe(step);
}

/** Plays option 0 with an empty result until the act's last node has been completed. Returns those events. */
function finishAct(ctx: RunContext, run: RunState, result: NodeResult = {}): readonly RunEvent[] {
  toStep(ctx, run, run.steps);
  return playNode(ctx, run, 0, result);
}

/** Every OptionsOffered event's drawn (non-fixed) option types. */
function drawnOffers(events: readonly RunEvent[]): string[][] {
  return evs(events)
    .filter((e) => e.type === "OptionsOffered")
    .map((e) => (e["options"] as { type: string; fixed: boolean }[]).filter((o) => !o.fixed).map((o) => o.type))
    .filter((types) => types.length > 0);
}

const frequency = (items: readonly string[], value: string): number => items.filter((x) => x === value).length / items.length;

// -------------------------------------------------------------------------------------------------

describe("node registry", () => {
  it("returns a registered type by id and undefined for an unknown id", () => {
    const calls: BuildCall[] = [];
    const registry = new NodeRegistry();
    const event = fakeType("event", calls);
    registry.register(event);
    expect(registry.get("event")).toBe(event);
    expect(registry.get("combat")).toBeUndefined();
  });

  it("refuses a second type with the same id (RangeError)", () => {
    const calls: BuildCall[] = [];
    const registry = new NodeRegistry();
    registry.register(fakeType("event", calls));
    expect(() => registry.register(fakeType("event", calls))).toThrow(RangeError);
  });
});

describe("starting a run", () => {
  it("builds the player from the loadout: full HP, cards in order, base stats, event tags, path rules", () => {
    const ctx = ctxOf();
    const { run } = start(ctx, "seed", "skill.t_might_a");
    const p = assemblePlayer(ctx.pack, PICKS, "skill.t_might_a");
    expect(run.player.maxHp).toBe(p.unit.maxHp);
    expect(run.player.hp).toBe(p.unit.maxHp);
    expect(run.player.cards).toEqual((p.unit.cards ?? []).map((c) => c.id));
    expect(run.player.cards).toEqual(["weapon.club", "skill.t_might_a"]);
    expect(run.player.baseStats).toEqual(p.baseStats);
    expect(run.player.eventTags).toEqual(["brute", "strong"]);
    expect(run.player.rules).toEqual(["no_dishonest_choices", "sworn"]);
  });

  it("keeps the seed, picks and technique; a null technique starts without one", () => {
    const ctx = ctxOf();
    const { run } = start(ctx, "abc", null);
    expect(run.seed).toBe("abc");
    expect(run.picks).toEqual(PICKS);
    expect(run.technique).toBeNull();
    expect(run.player.cards).toEqual((assemblePlayer(ctx.pack, PICKS, null).unit.cards ?? []).map((c) => c.id));
    expect(run.player.cards).toEqual(["weapon.club"]);
    expect(start(ctx, "abc", "skill.t_vit").run.technique).toBe("skill.t_vit");
  });

  it("starts with 0 crowns, no flags, fresh run limits, in the first act at step 1, choosing", () => {
    const { run } = start(ctxOf());
    expect(run.crowns).toBe(0);
    expect(run.flags).toEqual([]);
    expect(run.limits).toEqual(initialRunLimits());
    expect(run.act).toBe("act.one");
    expect(run.actNumber).toBe(1);
    expect(run.step).toBe(1);
    expect(run.phase).toBe("choosing");
    expect(run.offer).toHaveLength(3);
    expect(run.node).toBeNull();
    expect(run.previousType).toBeNull();
    expect(run.routes).toEqual([]);
  });

  it("starts in the act marked first, wherever it is in the pack", () => {
    const ctx = ctxOf([actFile("act.zero"), actFile("act.start", { first: true }), actFile("act.other")]);
    expect(start(ctx).run.act).toBe("act.start");
  });

  it("emits RunStarted, ActStarted, OptionsOffered in that order", () => {
    const { run, events } = start(ctxOf(), "seed-1");
    expect(kinds(events)).toEqual(["RunStarted", "ActStarted", "OptionsOffered"]);
    expect(events[0]).toMatchObject({ type: "RunStarted", seed: "seed-1" });
    expect(events[1]).toMatchObject({ type: "ActStarted", act: "act.one", actNumber: 1, steps: run.steps });
    expect(events[2]).toMatchObject({ type: "OptionsOffered", act: "act.one", step: 1, options: optionsOf(run) });
  });

  it("is plain data: a JSON round trip gives an equal state", () => {
    const { run } = start(ctxOf());
    expect(snapshot(run)).toEqual(run);
  });

  it("throws RangeError when no act is marked first", () => {
    const ctx = ctxOf([actFile("act.one"), actFile("act.two")]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError when a weight names a type with no registered module", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, weights: { event: 1, ghost: 5 } })]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError when a fixed node names a type with no registered module", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, fixed: [{ at: "last", type: "boss_fight", ref: "group.boss" }] })]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError when a weighted type's module is left out of the registry", () => {
    const ctx = ctxOf([ACT_ONE], { without: ["merchant"] });
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError when a weight-0 type has no registered module", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, weights: { event: 1, combat: 1, ghost: 0 } })]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError when a weight-0 type in a later act has no registered module", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, routes: [{ to: "act.two" }] }), actFile("act.two", { weights: { event: 1, ghost: 0 } })]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError when a fixed node in a later act names an unregistered type", () => {
    const ctx = ctxOf([
      actFile("act.one", { first: true, routes: [{ to: "act.two" }] }),
      actFile("act.two", { fixed: [{ at: 1, type: "shrine" }, BOSS] }),
    ]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError at the start for an unregistered type in a later act of the pack", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, routes: [{ to: "act.two" }] }), actFile("act.two", { weights: { event: 1, ghost: 1 } })]);
    expect(() => start(ctx)).toThrow(RangeError);
  });

  it("throws RangeError for bad picks or a bad technique (from loadout assembly)", () => {
    const ctx = ctxOf();
    expect(() => startRun(ctx, { seed: "s", picks: { ...PICKS, weapon: "weapon.missing" }, technique: null })).toThrow(RangeError);
    expect(() => startRun(ctx, { seed: "s", picks: { ...PICKS, weapon: "armor.plain" }, technique: null })).toThrow(RangeError);
    expect(() => startRun(ctx, { seed: "s", picks: PICKS, technique: "skill.untagged" })).toThrow(RangeError);
  });
});

describe("step count", () => {
  it("is rolled uniformly in [min, max] when the run enters the act", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 3, max: 6 } })]);
    const counts = seeds(800).map((s) => start(ctx, s).run.steps);
    for (const c of counts) expect([3, 4, 5, 6]).toContain(c);
    for (const v of [3, 4, 5, 6]) {
      const f = counts.filter((c) => c === v).length / counts.length;
      expect(f).toBeGreaterThan(0.17);
      expect(f).toBeLessThan(0.33);
    }
  });

  it("is exact when min equals max", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 4, max: 4 } })]);
    for (const s of seeds(20)) expect(start(ctx, s).run.steps).toBe(4);
  });

  it("is rolled once: it stays the same for every step of the act", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 3, max: 9 } })]);
    for (const s of seeds(10)) {
      const { run } = start(ctx, s);
      const steps = run.steps;
      while (run.step < steps) {
        playNode(ctx, run, 0, {});
        expect(run.steps).toBe(steps);
      }
    }
  });
});

describe("drawn steps: 3 options", () => {
  it("offers 3 options, none fixed, each built with ref null", () => {
    const ctx = ctxOf();
    for (const s of seeds(20)) {
      const { run } = start(ctx, s);
      expect(run.offer).toHaveLength(3);
      for (const o of run.offer) {
        expect(o.fixed).toBe(false);
        expect(o.ref).toBeNull();
        expect(dataOf(o).ref).toBeNull();
        expect(["event", "combat", "merchant"]).toContain(o.type);
      }
    }
  });

  it("shows at least two types whenever two can be drawn, even with very uneven weights", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, weights: { event: 1000, combat: 1 } })], { without: ["merchant"] });
    for (const s of seeds(300)) {
      const types = new Set(start(ctx, s).run.offer.map((o) => o.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    }
  });

  it("when options 1 and 2 are the same type, option 3 is another type", () => {
    const ctx = ctxOf();
    let cases = 0;
    for (const s of seeds(600)) {
      const [a, b, c] = start(ctx, s).run.offer as [NodeOption, NodeOption, NodeOption];
      if (a.type !== b.type) continue;
      cases++;
      expect(c.type).not.toBe(a.type);
    }
    expect(cases).toBeGreaterThan(50);
  });

  it("offers the same type three times when it is the only drawable type (weights)", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, weights: { event: 1, combat: 0, merchant: 0 } })]);
    for (const s of seeds(30)) expect(start(ctx, s).run.offer.map((o) => o.type)).toEqual(["event", "event", "event"]);
  });

  it("offers the same type three times when it is the only drawable type (canAppear)", () => {
    const never: CanAppear = () => false;
    const ctx = ctxOf([ACT_ONE], { canAppear: { combat: never, merchant: never } });
    for (const s of seeds(30)) expect(start(ctx, s).run.offer.map((o) => o.type)).toEqual(["event", "event", "event"]);
  });

  it("never draws a type with weight 0", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 6, max: 6 }, weights: { event: 1, combat: 0, merchant: 1 } })]);
    let offers = 0;
    for (const s of seeds(60)) {
      const { run, events } = start(ctx, s);
      const all = [...events, ...autoplay(ctx, run).events];
      for (const types of drawnOffers(all)) {
        offers++;
        expect(types).not.toContain("combat");
      }
    }
    expect(offers).toBeGreaterThan(100);
  });

  it("draws options 1 and 2 by weight (repeats allowed)", () => {
    const ctx = ctxOf();
    const first: string[] = [];
    const second: string[] = [];
    let repeats = 0;
    for (const s of seeds(3000)) {
      const offer = start(ctx, s).run.offer;
      first.push((offer[0] as NodeOption).type);
      second.push((offer[1] as NodeOption).type);
      if ((offer[0] as NodeOption).type === (offer[1] as NodeOption).type) repeats++;
    }
    for (const list of [first, second]) {
      expect(Math.abs(frequency(list, "event") - 0.5)).toBeLessThan(0.04);
      expect(Math.abs(frequency(list, "combat") - 0.35)).toBeLessThan(0.04);
      expect(Math.abs(frequency(list, "merchant") - 0.15)).toBeLessThan(0.04);
    }
    // P(same) = 0.5² + 0.35² + 0.15² = 0.395
    expect(Math.abs(repeats / 3000 - 0.395)).toBeLessThan(0.05);
  });

  it("draws option 3 by weight among the other types when options 1 and 2 match", () => {
    const ctx = ctxOf();
    const third: string[] = [];
    for (const s of seeds(3000)) {
      const [a, b, c] = start(ctx, s).run.offer as [NodeOption, NodeOption, NodeOption];
      if (a.type === "event" && b.type === "event") third.push(c.type);
    }
    expect(third.length).toBeGreaterThan(400);
    // combat 35 : merchant 15 → 0.7 : 0.3
    expect(Math.abs(frequency(third, "combat") - 0.7)).toBeLessThan(0.08);
    expect(frequency(third, "event")).toBe(0);
  });

  it("draws option 3 like the first two when options 1 and 2 differ", () => {
    const ctx = ctxOf();
    const third: string[] = [];
    for (const s of seeds(3000)) {
      const [a, b, c] = start(ctx, s).run.offer as [NodeOption, NodeOption, NodeOption];
      if (a.type !== b.type) third.push(c.type);
    }
    expect(third.length).toBeGreaterThan(1500);
    expect(Math.abs(frequency(third, "event") - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(frequency(third, "combat") - 0.35)).toBeLessThan(0.05);
    expect(Math.abs(frequency(third, "merchant") - 0.15)).toBeLessThan(0.05);
  });

  it("never draws a type whose canAppear is false", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 6, max: 6 } })], { canAppear: { combat: () => false } });
    for (const s of seeds(40)) {
      const { run, events } = start(ctx, s);
      for (const types of drawnOffers([...events, ...autoplay(ctx, run).events])) expect(types).not.toContain("combat");
    }
  });

  it("asks canAppear with the current run and act", () => {
    const seen: { seed: string; act: string; same: boolean }[] = [];
    let current: RunState | null = null;
    const ctx = ctxOf([ACT_ONE], {
      canAppear: {
        event: (run, act: ActDef) => {
          seen.push({ seed: run.seed, act: act.id, same: current === null || run === current });
          return true;
        },
      },
    });
    const { run } = start(ctx, "watch");
    current = run;
    playNode(ctx, run, 0, {});
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const s of seen) expect(s).toEqual({ seed: "watch", act: "act.one", same: true });
  });

  it("checks canAppear at each step against the run as it is now", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 4, max: 4 } })], {
      canAppear: { combat: (run) => !run.flags.includes("calm") },
    });
    let sawCombatBefore = false;
    for (const s of seeds(40)) {
      const { run } = start(ctx, s);
      if (run.offer.some((o) => o.type === "combat")) sawCombatBefore = true;
      playNode(ctx, run, 0, { setFlags: ["calm"] });
      expect(run.offer.map((o) => o.type)).not.toContain("combat");
    }
    expect(sawCombatBefore).toBe(true);
  });

  it("throws an Error when no type can be drawn at the first step", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, weights: { event: 1 } })], { canAppear: { event: () => false } });
    expect(() => start(ctx)).toThrow(Error);
  });

  it("throws an Error when no type can be drawn later in the run (merchant only, after a merchant)", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 4, max: 4 }, weights: { merchant: 1 } })]);
    const { run } = start(ctx);
    expect(run.offer.map((o) => o.type)).toEqual(["merchant", "merchant", "merchant"]);
    expect(chooseOption(ctx, run, 0).ok).toBe(true);
    expect(() => completeNode(ctx, run, {})).toThrow(Error);
  });
});

describe("the merchant never follows a merchant", () => {
  const heavy = { merchant: 100, event: 1 };

  /** Index of a merchant option, or 0. */
  const merchantOr0 = (run: RunState): number => Math.max(0, run.offer.findIndex((o) => o.type === "merchant"));

  it("drops the merchant from the draw right after a merchant node", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 8, max: 8 }, weights: heavy })]);
    let checked = 0;
    let merchantAfterOther = 0;
    for (const s of seeds(40)) {
      const { run } = start(ctx, s);
      while (run.step < run.steps) {
        const i = merchantOr0(run);
        playNode(ctx, run, i, {});
        if (run.offer.length !== 3) continue;
        const types = run.offer.map((o) => o.type);
        if (run.previousType === "merchant") {
          checked++;
          expect(types).not.toContain("merchant");
        } else if (types.includes("merchant")) merchantAfterOther++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(merchantAfterOther).toBeGreaterThan(10);
  });

  it("lets event and combat follow themselves", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 4, max: 4 }, weights: { event: 1, combat: 1 } })]);
    let eventAfterEvent = 0;
    let combatAfterCombat = 0;
    for (const s of seeds(40)) {
      const { run } = start(ctx, s);
      playNode(ctx, run, 0, {});
      const types = run.offer.map((o) => o.type);
      if (run.previousType === "event" && types.includes("event")) eventAfterEvent++;
      if (run.previousType === "combat" && types.includes("combat")) combatAfterCombat++;
    }
    expect(eventAfterEvent).toBeGreaterThan(0);
    expect(combatAfterCombat).toBeGreaterThan(0);
  });

  it("counts a fixed merchant as the previous node", () => {
    const ctx = ctxOf([
      actFile("act.one", { first: true, steps: { min: 3, max: 3 }, weights: heavy, fixed: [{ at: 1, type: "merchant" }, BOSS] }),
    ]);
    for (const s of seeds(30)) {
      const { run } = start(ctx, s);
      expect(optionsOf(run)).toEqual([{ type: "merchant", fixed: true }]);
      playNode(ctx, run, 0, {});
      expect(run.previousType).toBe("merchant");
      expect(run.offer.map((o) => o.type)).toEqual(["event", "event", "event"]);
    }
  });

  it("applies across acts: a merchant boss node keeps the merchant out of the next act's first step", () => {
    const ctx = ctxOf([
      actFile("act.one", { first: true, weights: { event: 1 }, fixed: [{ at: "last", type: "merchant" }], routes: [{ to: "act.two" }] }),
      actFile("act.two", { weights: heavy }),
    ]);
    for (const s of seeds(30)) {
      const { run } = start(ctx, s);
      finishAct(ctx, run);
      expect(run.previousType).toBe("merchant");
      ok(chooseRoute(ctx, run, 0));
      expect(run.act).toBe("act.two");
      expect(run.offer.map((o) => o.type)).toEqual(["event", "event", "event"]);
    }
  });

  it("does not apply to a fixed node: a fixed merchant is offered right after a merchant", () => {
    const ctx = ctxOf([
      actFile("act.one", { first: true, steps: { min: 3, max: 3 }, weights: heavy, fixed: [{ at: 2, type: "merchant", ref: "shop.x" }, BOSS] }),
    ]);
    let tested = 0;
    for (const s of seeds(30)) {
      const { run } = start(ctx, s);
      const i = run.offer.findIndex((o) => o.type === "merchant");
      if (i < 0) continue;
      tested++;
      playNode(ctx, run, i, {});
      expect(run.offer).toHaveLength(1);
      expect(run.offer[0]).toMatchObject({ type: "merchant", ref: "shop.x", fixed: true });
    }
    expect(tested).toBeGreaterThan(20);
  });
});

describe("fixed steps", () => {
  const MID = actFile("act.one", {
    first: true,
    steps: { min: 4, max: 4 },
    fixed: [{ at: 2, type: "event", ref: "event.mid" }, BOSS],
  });

  it("offers exactly one option, fixed, built by its type with its ref", () => {
    const ctx = ctxOf([MID]);
    const { run } = start(ctx);
    const events = playNode(ctx, run, 0, {});
    expect(run.step).toBe(2);
    expect(run.offer).toHaveLength(1);
    const o = run.offer[0] as NodeOption;
    expect(o).toMatchObject({ type: "event", ref: "event.mid", fixed: true, text: "node.event.text", tag: "node.event.tag" });
    expect(dataOf(o)).toMatchObject({ type: "event", ref: "event.mid", act: "act.one" });
    expect(find(events, "OptionsOffered")).toMatchObject({ act: "act.one", step: 2, options: [{ type: "event", fixed: true }] });
  });

  it("puts the boss at the last step, whatever count was rolled", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 3, max: 7 } })]);
    const lasts = new Set<number>();
    for (const s of seeds(30)) {
      const { run } = start(ctx, s);
      toStep(ctx, run, run.steps);
      lasts.add(run.steps);
      expect(run.offer).toHaveLength(1);
      expect(run.offer[0]).toMatchObject({ type: "combat", ref: "group.boss", fixed: true });
      expect(dataOf(run.offer[0] as NodeOption).ref).toBe("group.boss");
    }
    expect(lasts.size).toBeGreaterThan(1);
  });

  it("can be at step 1", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, fixed: [{ at: 1, type: "event", ref: "event.opening" }, BOSS] })]);
    const { run, events } = start(ctx);
    expect(run.offer).toHaveLength(1);
    expect(run.offer[0]).toMatchObject({ type: "event", ref: "event.opening", fixed: true });
    expect(find(events, "OptionsOffered")).toMatchObject({ step: 1, options: [{ type: "event", fixed: true }] });
  });

  it("passes ref null when the fixed node has no ref", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, fixed: [{ at: 1, type: "event" }, BOSS] })]);
    const { run } = start(ctx);
    expect(run.offer[0]).toMatchObject({ type: "event", ref: null, fixed: true });
    expect(dataOf(run.offer[0] as NodeOption).ref).toBeNull();
  });

  it("ignores canAppear", () => {
    const ctx = ctxOf([MID], { canAppear: { event: () => false, combat: () => false } });
    const { run } = start(ctx);
    playNode(ctx, run, 0, {});
    expect(run.offer[0]).toMatchObject({ type: "event", fixed: true });
    toStep(ctx, run, 4);
    expect(run.offer[0]).toMatchObject({ type: "combat", fixed: true });
  });

  it("ignores weights: a fixed type may have weight 0 or no weight at all", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, weights: { event: 1, combat: 0 } })]);
    const { run } = start(ctx);
    toStep(ctx, run, 3);
    expect(run.offer[0]).toMatchObject({ type: "combat", fixed: true });
    const ctx2 = ctxOf([actFile("act.one", { first: true, weights: { event: 1 } })]);
    const r2 = start(ctx2).run;
    toStep(ctx2, r2, 3);
    expect(r2.offer[0]).toMatchObject({ type: "combat", fixed: true });
  });

  it("refuses any option index but 0 at a fixed step", () => {
    const ctx = ctxOf([MID]);
    const { run } = start(ctx);
    playNode(ctx, run, 0, {});
    expectRefused(run, () => chooseOption(ctx, run, 1), "no_such_option");
    expectRefused(run, () => chooseOption(ctx, run, 2), "no_such_option");
  });

  it("sets previousType when a fixed node is entered", () => {
    const ctx = ctxOf([MID]);
    const { run } = start(ctx);
    playNode(ctx, run, 0, {});
    ok(chooseOption(ctx, run, 0));
    expect(run.previousType).toBe("event");
  });
});

describe("building options", () => {
  it("builds every option when it is offered, not when it is entered", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    expect(ctx.calls).toHaveLength(3);
    for (const [i, call] of ctx.calls.entries()) {
      const o = run.offer[i] as NodeOption;
      expect(call).toMatchObject({ type: o.type, ref: null, act: "act.one" });
      expect(o.text).toBe(`node.${o.type}.text`);
      expect(o.tag).toBe(`node.${o.type}.tag`);
      expect(o.data).toEqual({ ...call });
    }
    ok(chooseOption(ctx, run, 1));
    expect(ctx.calls).toHaveLength(3);
    ok(completeNode(ctx, run, {}));
    expect(ctx.calls).toHaveLength(6);
    playNode(ctx, run, 0, {});
    expect(ctx.calls).toHaveLength(7); // the boss: one fixed option
  });

  it("enters exactly the option that was offered", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    const offered = snapshot(run).offer[2] as NodeOption;
    const events = ok(chooseOption(ctx, run, 2));
    expect(run.phase).toBe("inNode");
    expect(run.node).toEqual({ ...offered, option: 2 });
    expect(run.previousType).toBe(offered.type);
    expect(run.offer).toEqual([]);
    expect(kinds(events)).toEqual(["NodeEntered"]);
    expect(events[0]).toMatchObject({ type: "NodeEntered", nodeType: offered.type, ref: null, option: 2 });
  });

  it("NodeCompleted names the node type of the node that was played (nodeType)", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, fixed: [{ at: 1, type: "merchant", ref: "shop.x" }, BOSS] })]);
    const { run } = start(ctx);
    expect(ok(chooseOption(ctx, run, 0))[0]).toMatchObject({ type: "NodeEntered", nodeType: "merchant", ref: "shop.x", option: 0 });
    expect(ok(completeNode(ctx, run, {}))[0]).toMatchObject({ type: "NodeCompleted", nodeType: "merchant" });
  });

  it("NodeEntered carries the fixed node's ref", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, fixed: [{ at: 1, type: "event", ref: "event.opening" }, BOSS] })]);
    const { run } = start(ctx);
    expect(ok(chooseOption(ctx, run, 0))[0]).toMatchObject({ type: "NodeEntered", nodeType: "event", ref: "event.opening", option: 0 });
  });

  it("builds two options of the same type separately (different nodes)", () => {
    const ctx = ctxOf();
    let pairs = 0;
    for (const s of seeds(100)) {
      const offer = start(ctx, s).run.offer;
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
          const a = offer[i] as NodeOption;
          const b = offer[j] as NodeOption;
          if (a.type !== b.type) continue;
          pairs++;
          expect(dataOf(a).draw).not.toBe(dataOf(b).draw);
        }
      }
    }
    expect(pairs).toBeGreaterThan(20);
  });

  it("an option's build depends on seed, act, step and position, not on what else was drawn", () => {
    // Same seeds, different weights: the drawn types change, but where both runs drew the same type at the same
    // position of the same step, the build is the same.
    const a = ctxOf([actFile("act.one", { first: true, steps: { min: 5, max: 5 } })]);
    const b = ctxOf([actFile("act.one", { first: true, steps: { min: 5, max: 5 }, weights: { event: 1, combat: 1, merchant: 3 } })]);
    let matches = 0;
    let differentElsewhere = 0;
    for (const s of seeds(150)) {
      const ra = start(a, s).run;
      const rb = start(b, s).run;
      for (let step = 1; step <= 2; step++) {
        const ta = ra.offer.map((o) => o.type).join();
        const tb = rb.offer.map((o) => o.type).join();
        for (let i = 0; i < 3; i++) {
          const oa = ra.offer[i] as NodeOption;
          const ob = rb.offer[i] as NodeOption;
          if (oa.type !== ob.type) continue;
          matches++;
          if (ta !== tb) differentElsewhere++;
          expect(dataOf(oa).draw).toBe(dataOf(ob).draw);
        }
        // Same commands in both runs: enter option 0 (previous types may differ; the draw for step 2 is checked
        // only where the types still line up).
        playNode(a, ra, 0, {});
        playNode(b, rb, 0, {});
      }
    }
    expect(matches).toBeGreaterThan(100);
    expect(differentElsewhere).toBeGreaterThan(20);
  });

  it("an option's build doesn't depend on canAppear answers for other types", () => {
    const a = ctxOf();
    const b = ctxOf([ACT_ONE], { canAppear: { merchant: () => false } });
    let matches = 0;
    for (const s of seeds(100)) {
      const oa = start(a, s).run.offer;
      const ob = start(b, s).run.offer;
      for (let i = 0; i < 3; i++) {
        const x = oa[i] as NodeOption;
        const y = ob[i] as NodeOption;
        if (x.type !== y.type) continue;
        matches++;
        expect(dataOf(x).draw).toBe(dataOf(y).draw);
      }
    }
    expect(matches).toBeGreaterThan(50);
  });

  it("gives the build the current act", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, routes: [{ to: "act.two" }] }), actFile("act.two")]);
    const { run } = start(ctx);
    finishAct(ctx, run);
    ok(chooseRoute(ctx, run, 0));
    for (const o of run.offer) expect(dataOf(o).act).toBe("act.two");
  });
});

describe("node results", () => {
  /** A run in phase inNode at step 1. */
  function inNode(acts: readonly ContentFile[] = [ACT_ONE]) {
    const ctx = ctxOf(acts);
    const { run } = start(ctx);
    ok(chooseOption(ctx, run, 0));
    return { ctx, run };
  }

  it("applies HP and crowns and reports the change actually applied", () => {
    const { ctx, run } = inNode();
    const max = run.player.maxHp;
    const nodeType = run.node?.type;
    const events = ok(completeNode(ctx, run, { hp: -5, crowns: 7 }));
    expect(run.player.hp).toBe(max - 5);
    expect(run.crowns).toBe(7);
    expect(events[0]).toMatchObject({ type: "NodeCompleted", nodeType, hpChange: -5, crownsChange: 7, hp: max - 5, crowns: 7 });
  });

  it("clamps healing at max HP (hpChange is the clamped amount)", () => {
    const { ctx, run } = inNode();
    const max = run.player.maxHp;
    ok(completeNode(ctx, run, { hp: -4 }));
    const events = playNode(ctx, run, 0, { hp: 100 });
    expect(run.player.hp).toBe(max);
    expect(events[0]).toMatchObject({ type: "NodeCompleted", hpChange: 4, hp: max });
  });

  it("clamps damage at 0 HP (hpChange is the clamped amount)", () => {
    const { ctx, run } = inNode();
    const max = run.player.maxHp;
    const events = ok(completeNode(ctx, run, { hp: -1000 }));
    expect(run.player.hp).toBe(0);
    expect(events[0]).toMatchObject({ type: "NodeCompleted", hpChange: -max, hp: 0 });
  });

  it("treats a missing or empty result as no change", () => {
    const { ctx, run } = inNode();
    const max = run.player.maxHp;
    const events = ok(completeNode(ctx, run, {}));
    expect(events[0]).toMatchObject({ type: "NodeCompleted", hpChange: 0, crownsChange: 0, hp: max, crowns: 0 });
    expect(run.flags).toEqual([]);
  });

  it("lets crowns go down to exactly 0", () => {
    const { ctx, run } = inNode();
    ok(completeNode(ctx, run, { crowns: 5 }));
    const events = playNode(ctx, run, 0, { crowns: -5 });
    expect(run.crowns).toBe(0);
    expect(events[0]).toMatchObject({ crownsChange: -5, crowns: 0 });
  });

  it("refuses a result that would take crowns below 0 (invalid_result, nothing changes)", () => {
    const { ctx, run } = inNode();
    expectRefused(run, () => completeNode(ctx, run, { crowns: -1, hp: -3, setFlags: ["x"] }), "invalid_result");
    expect(run.phase).toBe("inNode");
  });

  it.each([
    [{ hp: 1.5 }],
    [{ hp: -0.5 }],
    [{ crowns: 0.5 }],
    [{ hp: Number.NaN }],
    [{ crowns: Number.POSITIVE_INFINITY }],
    [{ hp: Number.NEGATIVE_INFINITY }],
  ])("refuses non-integer HP or crowns changes (invalid_result, nothing changes) %#", (result) => {
    const { ctx, run } = inNode();
    expectRefused(run, () => completeNode(ctx, run, result), "invalid_result");
  });

  it("adds set flags once each, in insertion order", () => {
    const { ctx, run } = inNode([actFile("act.one", { first: true, steps: { min: 5, max: 5 } })]);
    ok(completeNode(ctx, run, { setFlags: ["a", "b", "a"] }));
    expect(run.flags).toEqual(["a", "b"]);
    playNode(ctx, run, 0, { setFlags: ["c", "b"] });
    expect(run.flags).toEqual(["a", "b", "c"]);
  });

  it("removes cleared flags; clearing a flag that isn't set is fine", () => {
    const { ctx, run } = inNode([actFile("act.one", { first: true, steps: { min: 5, max: 5 } })]);
    ok(completeNode(ctx, run, { setFlags: ["a", "b", "c"] }));
    playNode(ctx, run, 0, { clearFlags: ["b", "zzz"] });
    expect(run.flags).toEqual(["a", "c"]);
  });

  it("applies clearFlags after setFlags (a flag set and cleared by the same result is not set)", () => {
    const { ctx, run } = inNode([actFile("act.one", { first: true, steps: { min: 5, max: 5 } })]);
    ok(completeNode(ctx, run, { setFlags: ["a"] }));
    playNode(ctx, run, 0, { setFlags: ["a", "b"], clearFlags: ["a"] });
    expect(run.flags).toEqual(["b"]);
  });

  it("puts a flag set again after being cleared at the end", () => {
    const { ctx, run } = inNode([actFile("act.one", { first: true, steps: { min: 5, max: 5 } })]);
    ok(completeNode(ctx, run, { setFlags: ["a", "b"] }));
    playNode(ctx, run, 0, { clearFlags: ["a"] });
    playNode(ctx, run, 0, { setFlags: ["a"] });
    expect(run.flags).toEqual(["b", "a"]);
  });

  it("advances to the next step's options when the node wasn't the last", () => {
    const { ctx, run } = inNode();
    const events = ok(completeNode(ctx, run, {}));
    expect(kinds(events)).toEqual(["NodeCompleted", "OptionsOffered"]);
    expect(events[1]).toMatchObject({ act: "act.one", step: 2, options: optionsOf(run) });
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.node).toBeNull();
    expect(run.offer).toHaveLength(3);
  });
});

describe("refused commands", () => {
  it("chooseOption: wrong phase outside choosing, no_such_option for a missing index", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    for (const i of [-1, 3, 1.5, Number.NaN]) expectRefused(run, () => chooseOption(ctx, run, i), "no_such_option");
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
  });

  it("completeNode outside inNode is wrong_phase", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    expectRefused(run, () => completeNode(ctx, run, {}), "wrong_phase");
  });

  it("chooseRoute outside route is wrong_phase", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
  });

  it("revive and endRun outside fallen are wrong_phase", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    expectRefused(run, () => revive(ctx, run, { action: "revive", source: "ad" }), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
    ok(chooseOption(ctx, run, 0));
    expectRefused(run, () => revive(ctx, run, { action: "revive", source: "ad" }), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
  });
});

describe("falling, reviving and ending", () => {
  /** A run that has just fallen at `step` (default 1). */
  function fallen(acts: readonly ContentFile[] = [actFile("act.one", { first: true, steps: { min: 6, max: 6 } })], step = 1) {
    const ctx = ctxOf(acts);
    const { run } = start(ctx);
    toStep(ctx, run, step);
    const node = snapshot(run).offer[0] as NodeOption;
    ok(chooseOption(ctx, run, 0));
    const events = ok(completeNode(ctx, run, { hp: -1000 }));
    return { ctx, run, events, node };
  }

  it("falls at 0 HP: NodeCompleted then PlayerFell, and nothing advances", () => {
    const { run, events, node } = fallen();
    expect(kinds(events)).toEqual(["NodeCompleted", "PlayerFell"]);
    expect(run.phase).toBe("fallen");
    expect(run.player.hp).toBe(0);
    expect(run.step).toBe(1);
    expect(run.offer).toEqual([]);
    expect(run.node).toEqual({ ...node, option: 0 });
  });

  it("refuses chooseOption, completeNode and chooseRoute while fallen", () => {
    const { ctx, run } = fallen();
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, { hp: 10 }), "wrong_phase");
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
  });

  it("revives at half max HP rounded up, then moves on as if the node had finished", () => {
    const { ctx, run } = fallen();
    expect(run.player.maxHp % 2).toBe(1); // Brute: 20 + 5 × 3 = 35, so rounding matters
    const events = ok(revive(ctx, run, { action: "revive", source: "ad" }));
    const hp = Math.ceil(run.player.maxHp / 2);
    expect(run.player.hp).toBe(hp);
    expect(kinds(events)).toEqual(["Revived", "OptionsOffered"]);
    expect(events[0]).toMatchObject({ type: "Revived", hp });
    expect(events[1]).toMatchObject({ act: "act.one", step: 2, options: optionsOf(run) });
    expect(run.phase).toBe("choosing");
    expect(run.step).toBe(2);
    expect(run.node).toBeNull();
    expect(run.limits.used.revive).toBe(1);
  });

  it("revives at half of an even max HP exactly", () => {
    // Crushing armor: Brute Vitality 3 − 4 → 0, so max HP = 20 + 5 × 0 + 10 = 30.
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 4, max: 4 } })]);
    const { run } = startRun(ctx, { seed: "even", picks: { ...PICKS, armor: "armor.crushing" }, technique: null });
    expect(run.player.maxHp).toBe(30);
    playNode(ctx, run, 0, { hp: -1000 });
    ok(revive(ctx, run, { action: "revive", source: "premium" }));
    expect(run.player.hp).toBe(15);
  });

  it("a revive after the last step's node completes the act (won with no routes)", () => {
    const { ctx, run } = fallen([actFile("act.one", { first: true, steps: { min: 3, max: 3 } })], 3);
    const events = ok(revive(ctx, run, { action: "revive", source: "fallback" }));
    expect(kinds(events)).toEqual(["Revived", "ActCompleted", "RunEnded"]);
    expect(events[1]).toMatchObject({ type: "ActCompleted", act: "act.one" });
    expect(events[2]).toMatchObject({ type: "RunEnded", result: "won" });
    expect(run.phase).toBe("won");
  });

  it("a revive after the last step's node offers the routes when there are some", () => {
    const acts = [actFile("act.one", { first: true, steps: { min: 3, max: 3 }, routes: [{ to: "act.two" }] }), actFile("act.two")];
    const { ctx, run } = fallen(acts, 3);
    const events = ok(revive(ctx, run, { action: "revive", source: "ad" }));
    expect(kinds(events)).toEqual(["Revived", "ActCompleted", "RoutesOffered"]);
    expect(events[2]).toMatchObject({ type: "RoutesOffered", routes: ["act.two"] });
    expect(run.phase).toBe("route");
  });

  it("allows 2 revives per run, whatever the grant source; the third is limit_reached", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, steps: { min: 6, max: 6 } })]);
    const { run } = start(ctx);
    playNode(ctx, run, 0, { hp: -1000 });
    ok(revive(ctx, run, { action: "revive", source: "premium" }));
    playNode(ctx, run, 0, { hp: -1000 });
    ok(revive(ctx, run, { action: "revive", source: "ad" }));
    playNode(ctx, run, 0, { hp: -1000 });
    expect(run.phase).toBe("fallen");
    for (const source of ["premium", "ad", "fallback"] as const) {
      expectRefused(run, () => revive(ctx, run, { action: "revive", source }), "limit_reached");
    }
  });

  it("refuses a grant for another action (wrong_action) and changes nothing", () => {
    const { ctx, run } = fallen();
    expectRefused(run, () => revive(ctx, run, { action: "reroll", source: "ad" }), "wrong_action");
    expect(run.limits.used.revive).toBe(0);
  });

  it("endRun from fallen ends the run lost", () => {
    const { ctx, run } = fallen();
    const events = ok(endRun(run));
    expect(kinds(events)).toEqual(["RunEnded"]);
    expect(events[0]).toMatchObject({ type: "RunEnded", result: "lost" });
    expect(run.phase).toBe("lost");
    expect(run.node).toBeNull();
    expectRefused(run, () => revive(ctx, run, { action: "revive", source: "ad" }), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
  });
});

describe("end of an act: routes and victory", () => {
  const ROUTED = [
    actFile("act.one", {
      first: true,
      routes: [
        { to: "act.b", flags: ["x"] },
        { to: "act.c", notFlags: ["x"] },
        { to: "act.d" },
        { to: "act.e", flags: ["x", "y"] },
        { to: "act.f", flags: ["x"], notFlags: ["y"] },
      ],
    }),
    actFile("act.b"),
    actFile("act.c"),
    actFile("act.d", { steps: { min: 5, max: 8 }, routes: [{ to: "act.b" }] }),
    actFile("act.e"),
    actFile("act.f"),
  ];

  it("wins the run after the last node of an act with no routes", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    const events = finishAct(ctx, run);
    expect(kinds(events)).toEqual(["NodeCompleted", "ActCompleted", "RunEnded"]);
    expect(events[1]).toMatchObject({ type: "ActCompleted", act: "act.one" });
    expect(events[2]).toMatchObject({ type: "RunEnded", result: "won" });
    expect(run.phase).toBe("won");
    expect(run.offer).toEqual([]);
    expect(run.routes).toEqual([]);
    expect(run.node).toBeNull();
  });

  it("refuses every command once the run is won", () => {
    const ctx = ctxOf();
    const { run } = start(ctx);
    finishAct(ctx, run);
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, {}), "wrong_phase");
    expectRefused(run, () => chooseRoute(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => revive(ctx, run, { action: "revive", source: "ad" }), "wrong_phase");
    expectRefused(run, () => endRun(run), "wrong_phase");
  });

  it.each([
    [[] as string[], ["act.c", "act.d"]],
    [["x"], ["act.b", "act.d", "act.f"]],
    [["y"], ["act.c", "act.d"]],
    [["x", "y"], ["act.b", "act.d", "act.e"]],
    [["y", "x"], ["act.b", "act.d", "act.e"]],
  ])("offers the open routes in the act's order (flags %j)", (flags, expected) => {
    const ctx = ctxOf(ROUTED);
    const { run } = start(ctx);
    const events = finishAct(ctx, run, { setFlags: flags });
    expect(kinds(events)).toEqual(["NodeCompleted", "ActCompleted", "RoutesOffered"]);
    expect(events[2]).toMatchObject({ type: "RoutesOffered", routes: expected });
    expect(run.phase).toBe("route");
    expect(run.routes).toEqual(expected);
    expect(run.offer).toEqual([]);
    expect(run.node).toBeNull();
  });

  it("reads flags as they are after the boss's result (a flag cleared by the boss closes its route)", () => {
    const ctx = ctxOf(ROUTED);
    const { run } = start(ctx);
    playNode(ctx, run, 0, { setFlags: ["x"] });
    finishAct(ctx, run, { clearFlags: ["x"] });
    expect(run.routes).toEqual(["act.c", "act.d"]);
  });

  it("choosing a route starts that act at step 1 with a newly rolled count", () => {
    const ctx = ctxOf(ROUTED);
    const counts = new Set<number>();
    for (const s of seeds(30)) {
      const { run } = start(ctx, s);
      finishAct(ctx, run);
      const i = run.routes.indexOf("act.d");
      const events = ok(chooseRoute(ctx, run, i));
      expect(kinds(events)).toEqual(["ActStarted", "OptionsOffered"]);
      expect(events[0]).toMatchObject({ type: "ActStarted", act: "act.d", actNumber: 2, steps: run.steps });
      expect(events[1]).toMatchObject({ type: "OptionsOffered", act: "act.d", step: 1, options: optionsOf(run) });
      expect(run.act).toBe("act.d");
      expect(run.actNumber).toBe(2);
      expect(run.step).toBe(1);
      expect(run.steps).toBeGreaterThanOrEqual(5);
      expect(run.steps).toBeLessThanOrEqual(8);
      expect(run.phase).toBe("choosing");
      expect(run.routes).toEqual([]);
      expect(run.offer).toHaveLength(3);
      counts.add(run.steps);
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it("carries HP, crowns, flags and limits into the next act", () => {
    const ctx = ctxOf(ROUTED);
    const { run } = start(ctx);
    playNode(ctx, run, 0, { hp: -1000 });
    ok(revive(ctx, run, { action: "revive", source: "ad" }));
    finishAct(ctx, run, { hp: -2, crowns: 9, setFlags: ["q"] });
    const before = snapshot(run);
    ok(chooseRoute(ctx, run, 0));
    expect(run.player).toEqual(before.player);
    expect(run.crowns).toBe(9);
    expect(run.flags).toEqual(["q"]);
    expect(run.limits).toEqual(before.limits);
  });

  it("counts acts: the third act is actNumber 3, and an act with no routes then wins", () => {
    const ctx = ctxOf(ROUTED);
    const { run } = start(ctx);
    finishAct(ctx, run);
    ok(chooseRoute(ctx, run, run.routes.indexOf("act.d")));
    finishAct(ctx, run);
    expect(run.routes).toEqual(["act.b"]);
    const events = ok(chooseRoute(ctx, run, 0));
    expect(events[0]).toMatchObject({ type: "ActStarted", act: "act.b", actNumber: 3 });
    expect(kinds(finishAct(ctx, run))).toEqual(["NodeCompleted", "ActCompleted", "RunEnded"]);
    expect(run.phase).toBe("won");
  });

  it("treats routes: [] as no routes: the run is won after the boss", () => {
    const ctx = ctxOf([actFile("act.one", { first: true, routes: [] })]);
    const { run } = start(ctx);
    const events = finishAct(ctx, run);
    expect(kinds(events)).toEqual(["NodeCompleted", "ActCompleted", "RunEnded"]);
    expect(events[2]).toMatchObject({ type: "RunEnded", result: "won" });
    expect(run.phase).toBe("won");
    expect(run.node).toBeNull();
  });

  it("treats empty flags and notFlags as no conditions (the route is always open)", () => {
    const ctx = ctxOf([
      actFile("act.one", { first: true, routes: [{ to: "act.b", flags: ["x"] }, { to: "act.c", flags: [], notFlags: [] }] }),
      actFile("act.b"),
      actFile("act.c"),
    ]);
    const { run } = start(ctx);
    finishAct(ctx, run, { setFlags: ["z"] });
    expect(run.routes).toEqual(["act.c"]);
    const r2 = start(ctx).run;
    finishAct(ctx, r2, { setFlags: ["x"] });
    expect(r2.routes).toEqual(["act.b", "act.c"]);
  });

  describe("a loop route back to the same act", () => {
    // act.one → (loop) act.one → act.end once "looped" is set. Steps 3–9 so the count can differ.
    const LOOP = [
      actFile("act.one", { first: true, steps: { min: 3, max: 9 }, routes: [{ to: "act.end", flags: ["looped"] }, { to: "act.one" }] }),
      actFile("act.end"),
    ];

    /** First and second visit of act.one with the same commands: step counts, step-1 offer types and builds. */
    function visits(seed: string) {
      const ctx = ctxOf(LOOP);
      const { run } = start(ctx, seed);
      const first = { steps: run.steps, offer: snapshot(run).offer };
      finishAct(ctx, run);
      expect(run.routes).toEqual(["act.one"]);
      const events = ok(chooseRoute(ctx, run, 0));
      expect(events[0]).toMatchObject({ type: "ActStarted", act: "act.one", actNumber: 2, steps: run.steps });
      expect(run.act).toBe("act.one");
      expect(run.actNumber).toBe(2);
      expect(run.step).toBe(1);
      const second = { steps: run.steps, offer: snapshot(run).offer };
      return { first, second, run };
    }

    it("enters the act again at step 1 with actNumber + 1, a count in range, and 3 fresh options", () => {
      for (const s of seeds(20)) {
        const { second } = visits(s);
        expect(second.steps).toBeGreaterThanOrEqual(3);
        expect(second.steps).toBeLessThanOrEqual(9);
        expect(second.offer).toHaveLength(3);
      }
    });

    it("draws the second visit afresh: the step count differs from the first visit for some seeds", () => {
      const results = seeds(40).map((s) => visits(s));
      expect(results.filter((r) => r.second.steps !== r.first.steps).length).toBeGreaterThan(10);
    });

    it("draws the second visit afresh: the offer (types and builds) differs from the first visit's for some seeds", () => {
      const results = seeds(40).map((s) => visits(s));
      const differ = results.filter((r) => JSON.stringify(r.second.offer) !== JSON.stringify(r.first.offer)).length;
      expect(differ).toBeGreaterThan(30);
    });

    it("stays deterministic per seed", () => {
      for (const s of seeds(10)) {
        const a = visits(s);
        const b = visits(s);
        expect(b.first).toEqual(a.first);
        expect(b.second).toEqual(a.second);
        expect(b.run).toEqual(a.run);
      }
    });

    it("leaves the loop once the flag opens the other route", () => {
      const ctx = ctxOf(LOOP);
      const { run } = start(ctx);
      finishAct(ctx, run);
      ok(chooseRoute(ctx, run, 0));
      finishAct(ctx, run, { setFlags: ["looped"] });
      expect(run.routes).toEqual(["act.end", "act.one"]);
      ok(chooseRoute(ctx, run, 0));
      expect(run).toMatchObject({ act: "act.end", actNumber: 3, step: 1 });
    });
  });

  it("refuses a route index that isn't offered (no_such_route)", () => {
    const ctx = ctxOf(ROUTED);
    const { run } = start(ctx);
    finishAct(ctx, run);
    for (const i of [-1, 2, 9, 0.5]) expectRefused(run, () => chooseRoute(ctx, run, i), "no_such_route");
    expectRefused(run, () => chooseOption(ctx, run, 0), "wrong_phase");
    expectRefused(run, () => completeNode(ctx, run, {}), "wrong_phase");
  });
});

describe("determinism and resume", () => {
  const ACTS = [
    actFile("act.one", { first: true, steps: { min: 4, max: 6 }, fixed: [{ at: 2, type: "event", ref: "event.mid" }, BOSS], routes: [{ to: "act.two", flags: ["f1"] }, { to: "act.three" }] }),
    actFile("act.two", { steps: { min: 3, max: 5 }, routes: [{ to: "act.three" }] }),
    actFile("act.three", { steps: { min: 3, max: 4 }, weights: { event: 2, combat: 2, merchant: 1 } }),
  ];

  function fullRun(seed: string) {
    const ctx = ctxOf(ACTS);
    const { run, events } = start(ctx, seed);
    const rest = autoplay(ctx, run);
    return { run, events: [...events, ...rest.events] };
  }

  it("the same seed and commands give identical events and state", () => {
    for (const s of seeds(15)) {
      const a = fullRun(s);
      const b = fullRun(s);
      expect(b.events).toEqual(a.events);
      expect(b.run).toEqual(a.run);
      expect(["won", "lost"]).toContain(a.run.phase);
    }
  });

  it("different seeds give different runs", () => {
    const logs = new Set(seeds(10).map((s) => JSON.stringify(fullRun(s).events.slice(1))));
    expect(logs.size).toBeGreaterThan(1);
  });

  it("a run JSON round-tripped at any point continues exactly like one that wasn't", () => {
    const phases = new Set<string>();
    for (const s of seeds(12)) {
      const whole = fullRun(s);
      const total = whole.events.length; // upper bound on the number of commands
      for (let k = 0; k <= total; k += 1) {
        const ctx = ctxOf(ACTS);
        const { run, events } = start(ctx, s);
        const head = autoplay(ctx, run, k);
        phases.add(run.phase);
        // Resume: a fresh context (new registry, same content) and the state through JSON.
        const ctx2 = ctxOf(ACTS);
        const resumed = snapshot(run);
        const tail = autoplay(ctx2, resumed);
        expect([...events, ...head.events, ...tail.events]).toEqual(whole.events);
        expect(resumed).toEqual(whole.run);
        if (head.commands < k) break; // the run ended before k commands
      }
    }
    for (const p of ["choosing", "inNode", "fallen", "route"]) expect(phases.has(p)).toBe(true);
    expect(phases.has("won") || phases.has("lost")).toBe(true);
  });

  it("in a node, the saved state holds the whole built option, so a restarted node is the same node", () => {
    const ctx = ctxOf(ACTS);
    const { run } = start(ctx, "pause");
    const offered = snapshot(run).offer[1] as NodeOption;
    ok(chooseOption(ctx, run, 1));
    const saved = snapshot(run);
    expect(saved.phase).toBe("inNode");
    expect(saved.node).toEqual({ ...offered, option: 1 });
    expect(saved.node?.data).toEqual(offered.data);
    expect(saved.node?.text).toBe(offered.text);
    expect(saved.node?.tag).toBe(offered.tag);
  });

  it("completing a resumed node gives the same events and state as completing the original", () => {
    const ctx = ctxOf(ACTS);
    const { run } = start(ctx, "pause-2");
    ok(chooseOption(ctx, run, 2));
    const copy = snapshot(run);
    const result = { hp: -4, crowns: 3, setFlags: ["f1"] };
    const a = ok(completeNode(ctx, run, result));
    const b = ok(completeNode(ctxOf(ACTS), copy, result));
    expect(b).toEqual(a);
    expect(copy).toEqual(run);
  });

  it("every command leaves plain data (JSON round trip is equal)", () => {
    const ctx = ctxOf(ACTS);
    const { run } = start(ctx, "plain");
    for (let i = 0; i < 60 && run.phase !== "won" && run.phase !== "lost"; i++) {
      autoplay(ctx, run, 1);
      expect(snapshot(run)).toEqual(run);
    }
  });
});
