import { describe, expect, it } from "vitest";
import {
  cardFromSkill,
  cardWithRarity,
  fightPlay,
  playCard,
  RARITIES,
  RARITY_SCALING,
  rarityRank,
  startTurn,
  strikeCard,
  upgradeCard,
  type CardSpec,
  type CombatEvent,
  type Effect,
  type Rarity,
  type Scaling,
  type WeaponDef,
} from "../src/index.ts";
import { skillDef } from "./combat/base-pack.ts";
import { eventsOf } from "./combat/helpers.ts";
import { during, enemy, fight, player } from "./combat/turn-helpers.ts";
import { postFight } from "./run/progress-pack.ts";
import { unitOf } from "./run/combat-pack.ts";

// Spec Draft 1.11, "Rarity" (decided 12 Oct 2026):
//   "Every skill and Word card has a rarity: grey, green, blue, purple or orange."
//   "Rarity scales what the card gets from stats: each stat-scaling term is multiplied by 90% (grey), 95% (green),
//    100% (blue), 110% (purple) or 125% (orange). Flat base amounts, afflictions and stack scaling, hits, statuses and
//    cooldowns don't change. The final amount still rounds down. Content numbers are written at blue (100%).
//    Example: Strike "4 damage +2 per Might" at Might 4 is 11 at grey (4 + 7.2), 12 at blue, 12 at purple (4 + 8.8),
//    14 at orange."
//   "Items don't have rarities (for now). Enemy moves have none."
// Brief M2.4a, public API:
//   RARITIES = ["grey", "green", "blue", "purple", "orange"]; RARITY_SCALING 0.9, 0.95, 1, 1.1, 1.25;
//   rarityRank(r) 0..4; cardWithRarity(card, rarity): every `{ stat, per }` term in every effect gets
//   per × RARITY_SCALING[rarity]; nothing else changes (flat amounts, afflictions/stacksOfTag terms, hits, statuses,
//   cooldown, id). Blue returns an equal card. Amounts still round down in the hit pipeline.

const FACTORS: readonly [Rarity, number][] = [
  ["grey", 0.9],
  ["green", 0.95],
  ["blue", 1],
  ["purple", 1.1],
  ["orange", 1.25],
];

/** The spec's example Strike: 4 physical damage +2 per Might, one hit. */
const SPEC_WEAPON: WeaponDef = {
  kind: "weapon",
  id: "weapon.spec",
  name: "weapon.spec.name",
  attack: { damage: 4, damageType: "physical", scaling: [{ stat: "might", per: 2 }] },
};

/** A card with every effect type and every scaling kind. */
const RICH_CARD: CardSpec = {
  id: "skill.rich",
  cooldown: 3,
  effects: [
    {
      type: "damage",
      damageType: "physical",
      amount: 5,
      target: "enemy",
      hits: 2,
      piercing: true,
      scaling: [
        { stat: "might", per: 2 },
        { afflictions: true, per: 3 },
        { stat: "agility", per: 1 },
        { stacksOfTag: "dot", per: 4 },
      ],
    },
    { type: "status", status: "bleeding", stacks: 3, target: "enemy", chance: 0.5 },
    { type: "heal", amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 3 }] },
    { type: "restoreShield", amount: 6, target: "self", scaling: [{ stat: "vitality", per: 2 }] },
    { type: "consume", status: "bleeding", multiplier: 2, damageType: "physical", target: "enemy", max: 5 },
    { type: "damage", damageType: "arcane", amount: 7, target: "allEnemies" },
  ],
};

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const scalingOf = (e: Effect | undefined): readonly Scaling[] => {
  if (e === undefined || e.type === "status" || e.type === "consume") return [];
  return e.scaling ?? [];
};

/** Strips every stat term's `per`, to compare everything else. */
function withoutStatPer(card: CardSpec): unknown {
  return {
    ...card,
    effects: card.effects.map((e) =>
      e.type === "status" || e.type === "consume" || e.scaling === undefined
        ? e
        : { ...e, scaling: e.scaling.map((s) => ("stat" in s ? { stat: s.stat } : s)) },
    ),
  };
}

const hitValues = (events: readonly CombatEvent[]): number[] => eventsOf(events, "HitStarted").map((e) => e.value);

// ---------------------------------------------------------------------------------------------
describe("rarities", () => {
  it("RARITIES lists grey, green, blue, purple, orange in that order", () => {
    expect([...RARITIES]).toEqual(["grey", "green", "blue", "purple", "orange"]);
  });

  for (const [r, f] of FACTORS) {
    it(`RARITY_SCALING.${r} is ${f}`, () => expect(RARITY_SCALING[r]).toBe(f));
  }

  it("RARITY_SCALING has exactly the five rarities", () => {
    expect(Object.keys(RARITY_SCALING).sort()).toEqual([...RARITIES].sort());
  });

  it("rarityRank: grey 0, green 1, blue 2, purple 3, orange 4", () => {
    expect(RARITIES.map((r) => rarityRank(r))).toEqual([0, 1, 2, 3, 4]);
  });

  it("rarityRank orders the rarities as RARITY_SCALING does", () => {
    for (const a of RARITIES) {
      for (const b of RARITIES) {
        expect(rarityRank(a) < rarityRank(b)).toBe(RARITY_SCALING[a] < RARITY_SCALING[b]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("cardWithRarity", () => {
  for (const [r, f] of FACTORS) {
    it(`${r}: every stat term's per is multiplied by ${f}`, () => {
      const out = cardWithRarity(RICH_CARD, r);
      const terms = out.effects.map(scalingOf);
      const original = RICH_CARD.effects.map(scalingOf);
      expect(terms.map((t) => t.length)).toEqual(original.map((t) => t.length));
      original.forEach((list, i) =>
        list.forEach((term, j) => {
          const got = terms[i]?.[j];
          if ("stat" in term) {
            expect(got !== undefined && "stat" in got).toBe(true);
            if (got !== undefined && "stat" in got) {
              expect(got.stat).toBe(term.stat);
              expect(got.per).toBeCloseTo(term.per * f, 9);
            }
          } else {
            // Afflictions and stack scaling don't change.
            expect(got).toEqual(term);
          }
        }),
      );
    });

    it(`${r}: id, cooldown, flat amounts, hits, piercing, statuses, consume and term order don't change`, () => {
      const out = cardWithRarity(RICH_CARD, r);
      expect(withoutStatPer(out)).toEqual(withoutStatPer(RICH_CARD));
      expect(out.id).toBe(RICH_CARD.id);
      expect(out.cooldown).toBe(RICH_CARD.cooldown);
    });

    it(`${r}: leaves the input card unchanged`, () => {
      const before = deepCopy(RICH_CARD);
      cardWithRarity(RICH_CARD, r);
      expect(RICH_CARD).toEqual(before);
    });
  }

  it("blue returns an equal card", () => {
    expect(cardWithRarity(RICH_CARD, "blue")).toEqual(RICH_CARD);
    const strike = strikeCard(SPEC_WEAPON);
    expect(cardWithRarity(strike, "blue")).toEqual(strike);
  });

  it("a card with no stat terms is equal at every rarity", () => {
    const flat: CardSpec = {
      id: "skill.flat",
      cooldown: 1,
      effects: [
        { type: "damage", damageType: "arcane", amount: 3, target: "enemy", scaling: [{ afflictions: true, per: 2 }] },
        { type: "status", status: "burning", stacks: 2, target: "enemy" },
      ],
    };
    for (const r of RARITIES) expect(cardWithRarity(flat, r)).toEqual(flat);
  });

  it("works on real content: Cleave at orange scales both its stat terms by 1.25", () => {
    const cleave = cardFromSkill(skillDef("skill.cleave"));
    const out = cardWithRarity(cleave, "orange");
    const before = scalingOf(cleave.effects[0]);
    const after = scalingOf(out.effects[0]);
    expect(after).toHaveLength(before.length);
    before.forEach((t, i) => {
      const a = after[i];
      if ("stat" in t && a !== undefined && "stat" in a) expect(a.per).toBeCloseTo(t.per * 1.25, 9);
      else expect(a).toEqual(t);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe("rarity in the hit pipeline: the spec's Strike example (4 +2 per Might, Might 4)", () => {
  const expected: readonly [Rarity, number][] = [
    ["grey", 11], // 4 + 7.2
    ["green", 11], // 4 + 7.6
    ["blue", 12], // 4 + 8
    ["purple", 12], // 4 + 8.8
    ["orange", 14], // 4 + 10
  ];

  for (const [r, value] of expected) {
    it(`${r}: one hit of ${value}`, () => {
      const p = player({ stats: { might: 4 }, cards: [cardWithRarity(strikeCard(SPEC_WEAPON), r)] });
      const e = enemy("e", { maxHp: 100 });
      const { ctx, state } = fight([p, e]);
      startTurn(state);
      const ev = during(ctx, () => expect(playCard(state, "strike")).toEqual({ ok: true }));
      expect(hitValues(ev)).toEqual([value]);
      expect(e.hp).toBe(100 - value);
    });
  }

  it("rounds down a product that is a whole number: green, 4 +6 per Might at Might 10 is 4 + 57 = 61", () => {
    // 6 × 0.95 × 10 = 57 exactly; the amount must not lose a point to floating-point error.
    const card: CardSpec = {
      id: "skill.big",
      cooldown: 1,
      effects: [{ type: "damage", damageType: "physical", amount: 4, target: "enemy", scaling: [{ stat: "might", per: 6 }] }],
    };
    const p = player({ stats: { might: 10 }, cards: [cardWithRarity(card, "green")] });
    const e = enemy("e", { maxHp: 200 });
    const { ctx, state } = fight([p, e]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "skill.big")).toEqual({ ok: true }));
    expect(hitValues(ev)).toEqual([61]);
  });

  it("heals round down: Mend (4 +3 per Wisdom) at grey, Wisdom 3, heals 12 (4 + 8.1)", () => {
    const mend = cardWithRarity(cardFromSkill(skillDef("skill.mend")), "grey");
    const p = player({ stats: { wisdom: 3 }, maxHp: 50, hp: 10, cards: [mend] });
    const { ctx, state } = fight([p, enemy()]);
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "skill.mend")).toEqual({ ok: true }));
    expect(eventsOf(ev, "Healed").map((h) => h.amount)).toEqual([12]);
    expect(p.hp).toBe(22);
  });

  it("restore Shield rounds down: Shore Up (5 +2 per Vitality) at grey, Vitality 3, restores 10 (5 + 5.4)", () => {
    const shore = cardWithRarity(cardFromSkill(skillDef("skill.shore_up")), "grey");
    const p = player({ stats: { vitality: 3 }, maxShield: 30, cards: [shore] });
    const { ctx, state } = fight([p, enemy()]);
    p.shield = 0; // Shield refills at the start of a fight; empty it to read the restore.
    startTurn(state);
    const ev = during(ctx, () => expect(playCard(state, "skill.shore_up")).toEqual({ ok: true }));
    expect(eventsOf(ev, "ShieldRestored").map((h) => h.amount)).toEqual([10]);
    expect(p.shield).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------
describe("rarity in a run's fight: the spec's Strike example (Brute Might 3 + 1)", () => {
  /** Strike once against the 500 HP post and return the damage dealt. */
  function strikeDamage(weapon: string, rarity: Rarity | null): number {
    const { session } = postFight({ weapon }, (_ctx, run) => {
      if (rarity !== null) expect(upgradeCard(run, weapon, rarity)).toEqual({ ok: true });
    });
    const post = unitOf(session, "enemy1");
    const before = post.hp;
    expect(fightPlay(session, weapon, "enemy1")).toEqual({ ok: true });
    return before - post.hp;
  }

  it("grey by default: 11", () => expect(strikeDamage("weapon.longsword", null)).toBe(11));
  it("green from the weapon's startRarity: 11", () => expect(strikeDamage("weapon.blessed", null)).toBe(11));
  it("blue: 12", () => expect(strikeDamage("weapon.longsword", "blue")).toBe(12));
  it("purple: 12", () => expect(strikeDamage("weapon.longsword", "purple")).toBe(12));
  it("orange: 14", () => expect(strikeDamage("weapon.longsword", "orange")).toBe(14));
});
