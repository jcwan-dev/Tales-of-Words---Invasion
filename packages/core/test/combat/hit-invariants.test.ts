import { describe, expect, it } from "vitest";
import {
  createCombatContext,
  createRng,
  createUnit,
  resolveHit,
  STAT_IDS,
  STATUS_IDS,
  type CombatEvent,
  type CombatUnit,
  type HitSpec,
  type Rng,
  type StatId,
  type StatusApplication,
  type StatusId,
} from "../../src/index.ts";

// Property-style tests without fast-check: many seeded random cases.
// Spec, Testing strategy: "HP never above max; Shield and stacks never negative;
// Thorns never triggers Thorns; same seed and commands give the same event log."

const CASES = 2_000;

interface UnitPlan {
  id: string;
  side: "player" | "enemy";
  stats: Partial<Record<StatId, number>>;
  maxHp: number;
  hp: number;
  maxShield: number;
  shield: number;
  statuses: Partial<Record<StatusId, number>>;
}

function planUnit(rng: Rng, id: string, side: "player" | "enemy"): UnitPlan {
  const stats: Partial<Record<StatId, number>> = {};
  for (const s of STAT_IDS) stats[s] = rng.int(0, 7);
  const maxHp = rng.int(1, 80);
  const maxShield = rng.int(0, 3) === 0 ? 0 : rng.int(0, 30);
  const statuses: Partial<Record<StatusId, number>> = {};
  for (const s of STATUS_IDS) if (rng.chance(0.3)) statuses[s] = rng.int(0, 60);
  return { id, side, stats, maxHp, hp: rng.int(1, maxHp), maxShield, shield: rng.int(0, maxShield), statuses };
}

function planHit(rng: Rng): HitSpec {
  const statuses: StatusApplication[] = [];
  const n = rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const status = rng.pick(STATUS_IDS);
    const stacks = rng.int(1, 10);
    statuses.push(rng.chance(0.5) ? { status, stacks } : { status, stacks, chance: rng.pick([0, 0.2, 0.5, 1]) });
  }
  const scaling = rng.chance(0.5) ? [{ stat: rng.pick(STAT_IDS), per: rng.int(0, 3) }] : [];
  return {
    damageType: rng.chance(0.5) ? "physical" : "arcane",
    amount: rng.int(0, 40),
    scaling,
    piercing: rng.chance(0.2),
    statuses,
  };
}

const build = (p: UnitPlan): CombatUnit =>
  createUnit({ id: p.id, side: p.side, stats: p.stats, maxHp: p.maxHp, hp: p.hp, maxShield: p.maxShield, shield: p.shield, statuses: p.statuses });

const snapshotStatuses = (u: CombatUnit): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of STATUS_IDS) out[s] = u.statuses.stacks(s);
  return out;
};

interface Case {
  attacker: UnitPlan;
  target: UnitPlan;
  hits: HitSpec[];
}

function planCase(i: number): Case {
  const rng = createRng(`hit-invariants-${i}`);
  const attacker = planUnit(rng, "a", rng.chance(0.5) ? "player" : "enemy");
  const target = planUnit(rng, "t", attacker.side === "player" ? "enemy" : "player");
  const hits: HitSpec[] = [];
  const n = rng.int(1, 3);
  for (let h = 0; h < n; h++) hits.push(planHit(rng));
  return { attacker, target, hits };
}

interface UnitSnapshot {
  hp: number;
  shield: number;
  fallen: boolean;
  statuses: Record<string, number>;
}
const snap = (u: CombatUnit): UnitSnapshot => ({ hp: u.hp, shield: u.shield, fallen: u.fallen, statuses: snapshotStatuses(u) });

interface HitCheck {
  a: CombatUnit;
  t: CombatUnit;
  hit: HitSpec;
  /** Events this hit emitted. */
  ev: CombatEvent[];
  before: { a: UnitSnapshot; t: UnitSnapshot };
}

/** Runs a case; checks per-hit invariants via the callback. Returns the full event log. */
function runCase(c: Case, seed: string, check?: (h: HitCheck) => void): CombatEvent[] {
  const ctx = createCombatContext(seed);
  const a = build(c.attacker);
  const t = build(c.target);
  for (const hit of c.hits) {
    const start = ctx.events.length;
    const before = { a: snap(a), t: snap(t) };
    resolveHit(ctx, a, t, hit);
    check?.({ a, t, hit, ev: ctx.events.slice(start), before });
  }
  return ctx.events;
}

const assertUnitBounds = (u: CombatUnit): void => {
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
    expect(u.statuses.has(s)).toBe(n > 0);
  }
};

describe("hit invariants (spec: Testing strategy, random seeded hits)", () => {
  it(`HP stays within [0, maxHp], Shield within [0, maxShield], stacks never negative (${CASES} cases)`, () => {
    for (let i = 0; i < CASES; i++) {
      runCase(planCase(i), `inv-bounds-${i}`, ({ a, t }) => {
        assertUnitBounds(a);
        assertUnitBounds(t);
      });
    }
  });

  it("same seed + same inputs = identical event log", () => {
    for (let i = 0; i < 300; i++) {
      const c = planCase(i);
      const first = runCase(c, `inv-det-${i}`);
      const second = runCase(planCase(i), `inv-det-${i}`);
      expect(second).toEqual(first);
    }
  });

  it("a deflected hit changes neither the target's HP/Shield nor its statuses (other than Warded -1)", () => {
    let deflected = 0;
    for (let i = 0; i < CASES; i++) {
      runCase(planCase(i), `inv-deflect-${i}`, ({ t, ev, before }) => {
        if (!ev.some((e) => e.type === "HitDeflected")) return;
        deflected++;
        expect(t.hp).toBe(before.t.hp);
        expect(t.shield).toBe(before.t.shield);
        const after = snapshotStatuses(t);
        for (const s of STATUS_IDS) {
          const expected = s === "warded" ? (before.t.statuses[s] ?? 0) - 1 : before.t.statuses[s];
          expect(after[s]).toBe(expected);
        }
        expect(ev.some((e) => e.type === "DamageDealt" || e.type === "Healed" || e.type === "StatusApplied" || e.type === "StatusMissed" || e.type === "StatusResisted")).toBe(false);
      });
    }
    // The generator must actually exercise deflection.
    expect(deflected).toBeGreaterThan(50);
  });

  it("Thorns never triggers Thorns: no ThornsDamage is followed by another ThornsDamage in the same hit", () => {
    let thornsSeen = 0;
    for (let i = 0; i < CASES; i++) {
      runCase(planCase(i), `inv-thorns-${i}`, ({ ev }) => {
        const n = ev.filter((e) => e.type === "ThornsDamage").length;
        if (n > 0) thornsSeen++;
        expect(n).toBeLessThanOrEqual(1);
      });
    }
    expect(thornsSeen).toBeGreaterThan(50);
  });

  it("A hit by or against a unit that has already fallen does nothing (no events, no state change)", () => {
    let fallenHits = 0;
    for (let i = 0; i < CASES; i++) {
      runCase(planCase(i), `inv-fallen-${i}`, ({ a, t, ev, before }) => {
        if (!before.a.fallen && !before.t.fallen) return;
        fallenHits++;
        expect(ev).toEqual([]);
        expect(snap(a)).toEqual(before.a);
        expect(snap(t)).toEqual(before.t);
      });
    }
    // The generator must actually produce hits involving fallen units (later hits of a case).
    expect(fallenHits).toBeGreaterThan(50);
  });

  it("every hit between living units starts with exactly one HitStarted and ends deflected xor with one DamageDealt", () => {
    for (let i = 0; i < CASES; i++) {
      runCase(planCase(i), `inv-shape-${i}`, ({ ev, before }) => {
        if (before.a.fallen || before.t.fallen) return;
        expect(ev[0]?.type).toBe("HitStarted");
        expect(ev.filter((e) => e.type === "HitStarted")).toHaveLength(1);
        const deflected = ev.filter((e) => e.type === "HitDeflected").length;
        const dealt = ev.filter((e) => e.type === "DamageDealt").length;
        expect(deflected + dealt).toBe(1);
      });
    }
  });

  it("Piercing ignores Warded: a piercing hit (keyword or attacker charge) is never deflected and uses no Warded charge", () => {
    let piercingIntoWarded = 0;
    for (let i = 0; i < CASES; i++) {
      runCase(planCase(i), `inv-pierce-${i}`, ({ t, hit, ev, before }) => {
        if (before.a.fallen || before.t.fallen) return;
        const piercing = hit.piercing === true || (before.a.statuses.piercing ?? 0) > 0;
        if (!piercing) return;
        if ((before.t.statuses.warded ?? 0) > 0) piercingIntoWarded++;
        expect(ev.some((e) => e.type === "HitDeflected")).toBe(false);
        expect(ev.some((e) => e.type === "ChargeUsed" && e.status === "warded")).toBe(false);
        // Warded only changes by what step 7 applied (no charge used).
        const wardedApplied = ev.reduce((n, e) => (e.type === "StatusApplied" && e.status === "warded" ? n + e.stacks : n), 0);
        expect(t.statuses.stacks("warded")).toBe((before.t.statuses.warded ?? 0) + wardedApplied);
        const dealt = ev.find((e) => e.type === "DamageDealt");
        expect(dealt).toMatchObject({ piercing: true, shieldDamage: 0 });
        expect(t.shield).toBe(before.t.shield);
      });
    }
    expect(piercingIntoWarded).toBeGreaterThan(50);
  });

  it("UnitFell is emitted exactly once per unit that reached 0 HP, and a fallen unit's HP stays 0", () => {
    for (let i = 0; i < CASES; i++) {
      const c = planCase(i);
      const last: CombatUnit[] = [];
      const events = runCase(c, `inv-fell-${i}`, ({ a, t, ev, before }) => {
        last[0] = a;
        last[1] = t;
        for (const u of [a, t]) {
          const was = u.id === "a" ? before.a : before.t;
          const fellNow = ev.some((e) => e.type === "UnitFell" && e.unit === u.id);
          // UnitFell exactly when the unit went from alive to 0 HP in this hit.
          expect(fellNow).toBe(!was.fallen && u.hp === 0);
          // Once at 0 HP, a unit stays at 0 (no Leeching back up after falling to Thorns).
          if (was.fallen) expect(u.hp).toBe(0);
        }
      });
      // Units start alive (hp >= 1), so over the case UnitFell appears once per unit at 0 HP.
      for (const u of last) {
        const fell = events.filter((e) => e.type === "UnitFell" && e.unit === u.id).length;
        expect(fell).toBe(u.hp === 0 ? 1 : 0);
      }
    }
  });
});
