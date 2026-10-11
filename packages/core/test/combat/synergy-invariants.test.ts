import { describe, expect, it } from "vitest";
import {
  beginCombat,
  createCombatContext,
  createRng,
  createUnit,
  endTurn,
  resolveAttack,
  startTurn,
  STAT_IDS,
  STATUS_IDS,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type ConvertTrigger,
  type HitSpec,
  type Rng,
  type SlowDecay,
  type StatId,
  type StatusApplication,
  type StatusId,
  type TriggerEvent,
  type UnitInit,
} from "../../src/index.ts";

// Property-style tests: seeded random fights with powers (Bleed, Burn, Poison, Stun, Paralysis), convert
// triggers and slow decay, driven through the turn API.
// Spec 1.5, Testing strategy ("HP never above max; Shield and stacks never negative; same seed and commands give
// the same event log") and Synergy effects ("up to a depth of 4 per hit; deeper triggers are ignored and the event
// log notes it"; "A unit that has fallen doesn't trigger"; slow decay: "loses a stack only every other round (rounds 2, 4, 6…)").

const FIGHTS = 200;
const MAX_ROUNDS = 30;
const TRIGGERS: readonly TriggerEvent[] = ["deflect", "attacked", "dealtDamage", "tookDamage"];
const DOTS: readonly StatusId[] = ["burning", "bleeding", "poisoned"];
// Spec 1.6: Plague Censer, the only slow decay these fights generate.
const CENSER: SlowDecay = { statuses: { tag: "dot" }, whose: "enemies" };

function planUnit(rng: Rng, id: string, side: "player" | "enemy"): UnitInit {
  const stats: Partial<Record<StatId, number>> = {};
  for (const s of STAT_IDS) stats[s] = rng.int(0, 7);
  const maxHp = side === "player" ? rng.int(30, 80) : rng.int(10, 50);
  const maxShield = rng.chance(0.5) ? 0 : rng.int(0, 15);
  const statuses: Partial<Record<StatusId, number>> = {};
  for (const s of STATUS_IDS) {
    if (!rng.chance(0.25)) continue;
    statuses[s] = s === "ambushed" ? 1 : s === "stunned" || s === "paralysed" ? rng.int(0, 12) : rng.int(0, 6);
  }
  const converts: ConvertTrigger[] = [];
  const n = rng.int(0, 3);
  for (let i = 0; i < n; i++) converts.push({ on: rng.pick(TRIGGERS), gain: rng.pick(STATUS_IDS), stacks: rng.int(1, 3) });
  return {
    id,
    side,
    stats,
    maxHp,
    hp: rng.int(1, maxHp),
    maxShield,
    shield: rng.int(0, maxShield),
    statuses,
    stunPower: rng.chance(0.3) ? rng.int(1, 6) : 0,
    paralysisPower: rng.chance(0.3) ? rng.int(1, 4) : 0,
    bleedPower: rng.chance(0.4) ? rng.int(1, 4) : 0,
    burnPower: rng.chance(0.4) ? rng.int(1, 4) : 0,
    poisonPower: rng.chance(0.4) ? rng.int(1, 4) : 0,
    traits: { slowDecay: rng.chance(0.3) ? [CENSER] : [], converts },
  };
}

function planHit(rng: Rng): HitSpec {
  const statuses: StatusApplication[] = [];
  const n = rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const status = rng.pick(STATUS_IDS);
    const stacks = rng.int(1, 5);
    statuses.push(rng.chance(0.6) ? { status, stacks } : { status, stacks, chance: rng.pick([0, 0.3, 0.5, 1]) });
  }
  const scaling: NonNullable<HitSpec["scaling"]>[number][] = [];
  if (rng.chance(0.3)) scaling.push({ stat: rng.pick(STAT_IDS), per: rng.int(0, 2) });
  if (rng.chance(0.3)) scaling.push({ afflictions: true, per: rng.int(1, 4) });
  if (rng.chance(0.3)) scaling.push({ stacksOfTag: "dot", per: 1 });
  return {
    damageType: rng.chance(0.5) ? "physical" : "arcane",
    amount: rng.int(0, 10),
    scaling,
    piercing: rng.chance(0.15),
    statuses,
  };
}

function eventsOfType<T extends CombatEvent["type"]>(events: readonly CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

function assertBounds(units: readonly CombatUnit[], inits: ReadonlyMap<string, UnitInit>): void {
  for (const u of units) {
    expect(u.hp).toBeGreaterThanOrEqual(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
    expect(u.shield).toBeGreaterThanOrEqual(0);
    expect(u.shield).toBeLessThanOrEqual(u.maxShield);
    expect(Number.isInteger(u.hp)).toBe(true);
    expect(Number.isInteger(u.shield)).toBe(true);
    expect(u.fallen).toBe(u.hp === 0);
    for (const s of STATUS_IDS) {
      const n = u.statuses.stacks(s);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(n)).toBe(true);
    }
    // Bleed, Burn and Poison power never drop.
    const init = inits.get(u.id);
    expect(u.bleedPower).toBe(init?.bleedPower ?? 0);
    expect(u.burnPower).toBe(init?.burnPower ?? 0);
    expect(u.poisonPower).toBe(init?.poisonPower ?? 0);
  }
}

interface Counts {
  triggers: number;
  kept: number;
  lost: number;
}

/**
 * Every TriggerFired: depth 1..4, matches one of the owner's converts, is followed at once by the unresisted gain,
 * and never comes from a unit that has fallen ("A unit that has fallen doesn't trigger").
 */
function assertTriggers(events: readonly CombatEvent[], units: readonly CombatUnit[], counts: Counts): void {
  const fell = new Set<string>();
  events.forEach((e, i) => {
    if (e.type === "UnitFell") fell.add(e.unit);
    if (e.type === "TriggerCapped") expect(e.depth).toBeGreaterThan(4);
    if (e.type !== "TriggerFired") return;
    counts.triggers++;
    expect(fell.has(e.unit)).toBe(false);
    expect(Number.isInteger(e.depth)).toBe(true);
    expect(e.depth).toBeGreaterThanOrEqual(1);
    expect(e.depth).toBeLessThanOrEqual(4);
    const owner = units.find((u) => u.id === e.unit);
    expect(owner).toBeDefined();
    expect((owner?.traits.converts ?? []).some((c) => c.on === e.on && c.gain === e.gain && c.stacks === e.stacks)).toBe(true);
    expect(events[i + 1]).toMatchObject({ type: "StatusApplied", unit: e.unit, status: e.gain, stacks: e.stacks });
  });
}

/** Plays one random fight. With check = true, asserts the invariants after every call. */
function playFight(i: number, check: boolean, counts: Counts): CombatEvent[] {
  const plan = createRng(`synergy-invariants-plan-${i}`);
  const inits: UnitInit[] = [planUnit(plan, "p", "player")];
  const enemies = plan.int(1, 3);
  for (let k = 0; k < enemies; k++) inits.push(planUnit(plan, `e${k + 1}`, "enemy"));
  const byId = new Map(inits.map((u) => [u.id, u] as const));
  const units = inits.map(createUnit);
  const ctx = createCombatContext(`synergy-invariants-${i}`);
  const state: CombatState = beginCombat(ctx, units);
  if (check) assertBounds(state.units, byId);

  while (!state.over && state.round <= MAX_ROUNDS) {
    const unit = state.active;
    if (unit === null) throw new Error("active is null while the fight is not over");

    // Slow decay: a DoT keeps its stack on odd rounds while a living unit of the other side has the trait.
    const round = state.round;
    const slowed = state.units.some((u) => u.side !== unit.side && !u.fallen && (u.traits.slowDecay ?? []).length > 0);
    const dotBefore = DOTS.map((s) => unit.statuses.stacks(s));

    const startAt = ctx.events.length;
    const acts = startTurn(state);
    const startEvents = ctx.events.slice(startAt);
    if (check) {
      assertBounds(state.units, byId);
      assertTriggers(startEvents, state.units, counts);
      // Damage over time triggers no converts.
      expect(eventsOfType(startEvents, "TriggerFired")).toEqual([]);
      if (!unit.fallen) {
        DOTS.forEach((s, k) => {
          const before = dotBefore[k] ?? 0;
          if (before === 0) return;
          const ticked = eventsOfType(startEvents, "DotDamage").some((d) => d.unit === unit.id && d.status === s);
          expect(ticked).toBe(true);
          const keep = slowed && round % 2 === 1;
          if (keep) counts.kept++;
          else counts.lost++;
          expect(unit.statuses.stacks(s)).toBe(keep ? before : before - 1);
        });
      }
    }
    if (state.over) break;
    if (unit.fallen) continue;

    if (acts) {
      const attacks = plan.int(0, 2);
      for (let a = 0; a < attacks && !state.over && !unit.fallen; a++) {
        const targets = state.units.filter((u) => u.side !== unit.side && !u.fallen);
        if (targets.length === 0) break;
        const target = plan.pick(targets);
        const hits: HitSpec[] = [];
        const n = plan.int(1, 3);
        for (let h = 0; h < n; h++) hits.push(planHit(plan));
        const at = ctx.events.length;
        resolveAttack(ctx, unit, target, { hits });
        if (check) {
          assertBounds(state.units, byId);
          assertTriggers(ctx.events.slice(at), state.units, counts);
        }
      }
    }
    if (state.over) break;
    endTurn(state);
    if (check) assertBounds(state.units, byId);
  }
  return ctx.events;
}

describe("synergy invariants (spec 1.5: powers, convert triggers, slow decay; random seeded fights)", () => {
  it(`bounds, powers never drop, triggers at depth 1-4 with their unresisted gain, slow decay on odd rounds (${FIGHTS} fights)`, () => {
    const counts: Counts = { triggers: 0, kept: 0, lost: 0 };
    for (let i = 0; i < FIGHTS; i++) playFight(i, true, counts);
    // Sanity: the generator really exercises the features.
    expect(counts.triggers).toBeGreaterThan(200);
    expect(counts.kept).toBeGreaterThan(30);
    expect(counts.lost).toBeGreaterThan(30);
  });

  it("every TriggerFired in every fight has depth <= 4", () => {
    const counts: Counts = { triggers: 0, kept: 0, lost: 0 };
    let seen = 0;
    for (let i = 0; i < FIGHTS; i++) {
      for (const e of eventsOfType(playFight(i, false, counts), "TriggerFired")) {
        seen++;
        expect(e.depth).toBeLessThanOrEqual(4);
      }
    }
    expect(seen).toBeGreaterThan(200);
  });

  it("determinism: the same seed and commands give the same event log", () => {
    const counts: Counts = { triggers: 0, kept: 0, lost: 0 };
    for (let i = 0; i < 60; i++) {
      const a = playFight(i, false, counts);
      const b = playFight(i, false, counts);
      expect(b).toEqual(a);
    }
    expect(playFight(1, false, counts)).not.toEqual(playFight(2, false, counts));
  });
});
