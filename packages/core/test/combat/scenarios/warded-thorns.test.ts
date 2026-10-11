import { describe, expect, it } from "vitest";
import { createCombatContext, createUnit, maxHpFromVitality, resolveHit, startingStats, type HitSpec } from "../../../src/index.ts";

// Spec, Testing strategy (scenario example):
//   name: Warded plus Thorns deflects and reflects
//   player: { char: sellsword, statuses: { warded: 1, thorns: 3 } }
//   enemy:  { id: hollow_warden, hp: 50, shield: 0 }
//   steps:  [ enemy_attacks: halberd_swing ]
//   expect: { player.hp: unchanged, player.warded: 0, enemy.hp: 47 }
//
// hollow_warden and halberd_swing are not defined anywhere in the spec or content yet, so
// the enemy's stats and the attack below are stand-ins. The expected results do not depend
// on them: Warded deflects any attack, and Thorns 3 is untyped and hits the enemy's 0 Shield,
// so 50 - 3 = 47.

const halberdSwing: HitSpec = {
  damageType: "physical",
  amount: 9,
  scaling: [{ stat: "might", per: 2 }],
  statuses: [{ status: "bleeding", stacks: 2 }],
};

describe("scenario: Warded plus Thorns deflects and reflects", () => {
  it("player.hp unchanged, player.warded 0, enemy.hp 47", () => {
    const ctx = createCombatContext("scenario-warded-thorns");
    // Sellsword: Might and Vitality favoured (3), so Base HP = 20 + 5 * 3 = 35.
    const sellswordStats = startingStats(["might", "vitality"]);
    const player = createUnit({
      id: "char.sellsword",
      side: "player",
      stats: sellswordStats,
      maxHp: maxHpFromVitality(sellswordStats.vitality),
      statuses: { warded: 1, thorns: 3 },
    });
    const enemy = createUnit({ id: "enemy.hollow_warden", side: "enemy", stats: { might: 4 }, maxHp: 50, maxShield: 0 });
    const hpBefore = player.hp;
    expect(hpBefore).toBe(35);

    resolveHit(ctx, enemy, player, halberdSwing);

    expect(player.hp).toBe(hpBefore);
    expect(player.statuses.stacks("warded")).toBe(0);
    expect(enemy.hp).toBe(47);

    // And the events tell the same story: Thorns reflects, then the hit is deflected.
    const types = ctx.events.map((e) => e.type);
    expect(types).toContain("ThornsDamage");
    expect(types).toContain("HitDeflected");
    expect(types.indexOf("ThornsDamage")).toBeLessThan(types.indexOf("HitDeflected"));
    expect(types).not.toContain("DamageDealt");
    expect(player.statuses.has("bleeding")).toBe(false);
    expect(player.statuses.stacks("thorns")).toBe(3);
  });
});
