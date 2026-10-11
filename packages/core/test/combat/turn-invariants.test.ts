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
  type AttackSpec,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type HitSpec,
  type Rng,
  type StatId,
  type StatusApplication,
  type StatusId,
  type UnitInit,
} from "../../src/index.ts";

// Property-style tests without fast-check: many seeded random fights driven through the turn API.
// Spec 1.4, Testing strategy: "HP never above max; Shield and stacks never negative; cooldowns tick on
// skipped turns; Stunned and Paralysed reset to 0 when they trigger; same seed and commands give the
// same event log." Plus the Turn details: fixed alternation, fight ends as soon as a side has fallen.

const FIGHTS = 300;
const MAX_ROUNDS = 50;
const CARDS = ["c1", "c2", "c3"] as const;

function planUnit(rng: Rng, id: string, side: "player" | "enemy"): UnitInit {
  const stats: Partial<Record<StatId, number>> = {};
  for (const s of STAT_IDS) stats[s] = rng.int(0, 7);
  const maxHp = side === "player" ? rng.int(20, 60) : rng.int(8, 40);
  const maxShield = rng.chance(0.5) ? 0 : rng.int(0, 15);
  const statuses: Partial<Record<StatusId, number>> = {};
  for (const s of STATUS_IDS) {
    if (!rng.chance(0.25)) continue;
    statuses[s] = s === "ambushed" ? 1 : s === "stunned" || s === "paralysed" ? rng.int(0, 12) : rng.int(0, 6);
  }
  return {
    id,
    side,
    stats,
    maxHp,
    hp: rng.int(1, maxHp),
    maxShield,
    shield: rng.int(0, maxShield),
    statuses,
    stunPower: rng.chance(0.4) ? rng.int(1, 8) : 0,
    paralysisPower: rng.chance(0.4) ? rng.int(1, 6) : 0,
  };
}

function planHit(rng: Rng): HitSpec {
  const statuses: StatusApplication[] = [];
  const n = rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const status = rng.pick(STATUS_IDS);
    const stacks = rng.int(1, 6);
    statuses.push(rng.chance(0.6) ? { status, stacks } : { status, stacks, chance: rng.pick([0, 0.3, 0.5, 1]) });
  }
  return {
    damageType: rng.chance(0.5) ? "physical" : "arcane",
    amount: rng.int(0, 12),
    scaling: rng.chance(0.3) ? [{ stat: rng.pick(STAT_IDS), per: rng.int(0, 2) }] : [],
    piercing: rng.chance(0.15),
    statuses,
  };
}

const sideFallen = (units: readonly CombatUnit[], side: "player" | "enemy"): boolean =>
  units.filter((u) => u.side === side).every((u) => u.fallen);

function assertBounds(units: readonly CombatUnit[]): void {
  for (const u of units) {
    expect(u.hp).toBeGreaterThanOrEqual(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
    expect(u.shield).toBeGreaterThanOrEqual(0);
    expect(u.shield).toBeLessThanOrEqual(u.maxShield);
    expect(u.fallen).toBe(u.hp === 0);
    expect(u.stunPower).toBeGreaterThanOrEqual(0);
    expect(u.stunPower).toBeLessThanOrEqual(u.maxStunPower);
    for (const s of STATUS_IDS) {
      const n = u.statuses.stacks(s);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(n)).toBe(true);
    }
    for (const c of CARDS) expect(u.cooldowns.remaining(c)).toBeGreaterThanOrEqual(0);
  }
}

/** activeAlive: the active unit must be alive (true between turns; false mid-turn, where Thorns can fell the attacker). */
function assertFightState(state: CombatState, activeAlive: boolean): void {
  const ended = eventsOfType(state.ctx.events, "CombatEnded");
  expect(ended.length).toBeLessThanOrEqual(1);
  const pFallen = sideFallen(state.units, "player");
  const eFallen = sideFallen(state.units, "enemy");
  // The fight ends as soon as every unit on one side has fallen, and only then.
  expect(state.over).toBe(pFallen || eFallen);
  expect(ended.length).toBe(state.over ? 1 : 0);
  if (state.over) {
    expect(state.active).toBeNull();
    const winner = ended[0]?.winner;
    expect(state.winner).toBe(winner);
    expect(sideFallen(state.units, winner === "player" ? "enemy" : "player")).toBe(true);
    // Both sides fallen in the same hit: the enemies win.
    if (pFallen && eFallen) expect(winner).toBe("enemy");
  } else {
    expect(state.winner).toBeNull();
    expect(state.active).not.toBeNull();
    if (activeAlive) expect(state.active?.fallen).toBe(false);
  }
}

function eventsOfType<T extends CombatEvent["type"]>(events: readonly CombatEvent[], type: T): Extract<CombatEvent, { type: T }>[] {
  return events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
}

interface FightResult {
  events: CombatEvent[];
  state: CombatState;
  stats: { meters: number; skipped: number; cooldownChecks: number };
}

/** Plays one random fight. With check = true, asserts the invariants after every call. */
function playFight(i: number, check: boolean): FightResult {
  const plan = createRng(`turn-invariants-plan-${i}`);
  const inits: UnitInit[] = [planUnit(plan, "p", "player")];
  const enemies = plan.int(1, 3);
  for (let k = 0; k < enemies; k++) inits.push(planUnit(plan, `e${k + 1}`, "enemy"));
  // Shuffle the input order a little: turn order must not depend on it except within a side.
  if (plan.chance(0.5)) inits.reverse();
  const units = inits.map(createUnit);
  const ctx = createCombatContext(`turn-invariants-${i}`);
  const state = beginCombat(ctx, units);
  const stats = { meters: 0, skipped: 0, cooldownChecks: 0 };
  if (check) {
    assertBounds(state.units);
    assertFightState(state, true);
    for (const u of state.units) expect(u.stunPower).toBe(u.maxStunPower);
  }

  while (!state.over && state.round <= MAX_ROUNDS) {
    const unit = state.active;
    if (unit === null) throw new Error("active is null while the fight is not over");
    const before: Record<string, number> = {};
    for (const c of CARDS) before[c] = unit.cooldowns.remaining(c);
    const used = new Map<string, number>();

    const startAt = ctx.events.length;
    const acts = startTurn(state);
    const startEvents = ctx.events.slice(startAt);
    if (check) {
      assertBounds(state.units);
      assertFightState(state, true);
      // Stunned and Paralysed are 0 right after they trigger.
      for (const m of eventsOfType(startEvents, "MeterTriggered")) {
        stats.meters++;
        const owner = state.units.find((u) => u.id === m.unit);
        expect(owner?.statuses.stacks(m.status)).toBe(0);
      }
      const skipped = eventsOfType(startEvents, "TurnSkipped");
      stats.skipped += skipped.length;
      expect(acts).toBe(skipped.length === 0 && !unit.fallen && !state.over);
    }
    if (state.over) break;
    // A unit that fell at turn start has already ended its turn.
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
        // Pick a card (or none, index CARDS.length); a card on cooldown is not used.
        const cardId = CARDS[plan.int(0, CARDS.length)];
        let spec: AttackSpec = { hits };
        if (cardId !== undefined && unit.cooldowns.ready(cardId)) {
          const cooldown = plan.int(0, 3);
          spec = { hits, cardId, cooldown };
          if (cooldown > 0) used.set(cardId, cooldown);
        }
        resolveAttack(ctx, unit, target, spec);
        if (check) {
          assertBounds(state.units);
          assertFightState(state, false);
        }
      }
    }
    if (state.over) break;

    const fellDuringTurn = unit.fallen;
    endTurn(state);
    if (check) {
      assertBounds(state.units);
      assertFightState(state, true);
      if (!fellDuringTurn) {
        // Cooldowns tick at the end of the owner's turn (skipped turns included), except cards used this turn.
        for (const c of CARDS) {
          const expected = used.get(c) ?? Math.max(0, (before[c] ?? 0) - 1);
          expect(unit.cooldowns.remaining(c)).toBe(expected);
          stats.cooldownChecks++;
        }
      }
    }
  }
  return { events: ctx.events, state, stats };
}

describe("turn invariants (spec: Testing strategy, random seeded fights)", () => {
  it(`bounds, meters reset, cooldowns tick (skipped turns too), fight end exactly when a side has fallen (${FIGHTS} fights)`, () => {
    const total = { meters: 0, skipped: 0, cooldownChecks: 0, ended: 0 };
    for (let i = 0; i < FIGHTS; i++) {
      const r = playFight(i, true);
      total.meters += r.stats.meters;
      total.skipped += r.stats.skipped;
      total.cooldownChecks += r.stats.cooldownChecks;
      if (r.state.over) total.ended++;
    }
    // Sanity: the generator really exercises the features.
    expect(total.meters).toBeGreaterThan(20);
    expect(total.skipped).toBeGreaterThan(20);
    expect(total.cooldownChecks).toBeGreaterThan(500);
    expect(total.ended).toBeGreaterThan(FIGHTS / 2);
  });

  it("no living unit gets two turns in a row while another living unit exists; rounds only go up", () => {
    for (let i = 0; i < FIGHTS; i++) {
      const { events } = playFight(i, false);
      const starts = eventsOfType(events, "TurnStarted");
      for (let k = 1; k < starts.length; k++) {
        const prev = starts[k - 1];
        const cur = starts[k];
        expect(cur?.unit).not.toBe(prev?.unit);
        expect(cur?.round ?? 0).toBeGreaterThanOrEqual(prev?.round ?? 0);
      }
      expect(starts[0]?.round).toBe(1);
    }
  });

  it("CombatStarted comes first; CombatEnded at most once and is the last event", () => {
    for (let i = 0; i < FIGHTS; i++) {
      const { events } = playFight(i, false);
      expect(events[0]?.type).toBe("CombatStarted");
      expect(eventsOfType(events, "CombatStarted")).toHaveLength(1);
      const ended = events.filter((e) => e.type === "CombatEnded");
      expect(ended.length).toBeLessThanOrEqual(1);
      if (ended.length === 1) expect(events.at(-1)?.type).toBe("CombatEnded");
    }
  });

  it("determinism: the same seed and commands give the same event log", () => {
    for (let i = 0; i < 60; i++) {
      const a = playFight(i, false).events;
      const b = playFight(i, false).events;
      expect(b).toEqual(a);
    }
    expect(playFight(1, false).events).not.toEqual(playFight(2, false).events);
  });
});
