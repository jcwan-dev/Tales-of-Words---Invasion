import { describe, expect, it } from "vitest";
import {
  cardWithRarity,
  floorAmount,
  heldRarity,
  higherRarity,
  learnCard,
  loadoutStartRarity,
  RARITIES,
  upgradeCard,
  validatePack,
  type CardSpec,
  type ContentFile,
} from "../../../src/index.ts";
import { progressCtx, startProgressRun } from "../progress-pack.ts";

// Builder unit tests for model/rarity, the amount rounding and run/progress details.

describe("floorAmount", () => {
  it("rounds down, absorbing floating-point error just below a whole number", () => {
    expect(floorAmount(11.2)).toBe(11);
    expect(floorAmount(4 + 0.95 * 6 * 10)).toBe(61);
    expect(floorAmount(60.999999999999)).toBe(61);
    expect(floorAmount(60.99)).toBe(60);
    expect(floorAmount(0)).toBe(0);
  });
});

describe("cardWithRarity details", () => {
  const card: CardSpec = {
    id: "skill.x",
    cooldown: 1,
    effects: [{ type: "damage", damageType: "physical", amount: 4, target: "enemy", scaling: [{ stat: "might", per: 6 }] }],
  };

  it("stores tidy per values (6 × 0.95 = 5.7)", () => {
    const e = cardWithRarity(card, "green").effects[0];
    expect(e?.type === "damage" ? e.scaling?.[0] : null).toEqual({ stat: "might", per: 5.7 });
  });

  it("blue returns the same card object (no copy)", () => {
    expect(cardWithRarity(card, "blue")).toBe(card);
  });

  it("an effect without scaling is shared, not copied", () => {
    const flat: CardSpec = { id: "skill.f", cooldown: 1, effects: [{ type: "heal", amount: 3, target: "self" }] };
    expect(cardWithRarity(flat, "orange").effects[0]).toBe(flat.effects[0]);
  });
});

describe("rarity helpers", () => {
  it("higherRarity picks the higher, either way round", () => {
    for (const a of RARITIES) for (const b of RARITIES) expect(higherRarity(a, b)).toBe(RARITIES.indexOf(a) >= RARITIES.indexOf(b) ? a : b);
  });

  it("heldRarity: grey without an own entry (inherited keys don't count)", () => {
    expect(heldRarity({}, "skill.x")).toBe("grey");
    expect(heldRarity({}, "constructor")).toBe("grey");
    expect(heldRarity({ "skill.x": "purple" }, "skill.x")).toBe("purple");
  });

  it("loadoutStartRarity ignores inherited keys of a startRarity record", () => {
    const files: ContentFile[] = [
      { path: "c.json", data: { kind: "character", id: "char.c", name: "n", favoured: ["might"], eventTags: [] } },
      { path: "w.json", data: { kind: "weapon", id: "weapon.w", name: "n", attack: { damage: 1, damageType: "physical", scaling: [] }, startRarity: { "weapon.w": "purple" } } },
      { path: "a.json", data: { kind: "armor", id: "armor.a", name: "n" } },
      { path: "x.json", data: { kind: "accessory", id: "accessory.x", name: "n" } },
      { path: "p.json", data: { kind: "path", id: "path.p", name: "n" } },
    ];
    const res = validatePack("t", files);
    expect(res.issues).toEqual([]);
    if (res.pack === undefined) return;
    const picks = { character: "char.c", weapon: "weapon.w", armor: "armor.a", accessory: "accessory.x", path: "path.p" };
    expect(loadoutStartRarity(res.pack, picks, "weapon.w")).toBe("purple");
    expect(loadoutStartRarity(res.pack, picks, "toString")).toBe("grey");
  });
});

describe("progress details", () => {
  it("learnCard and upgradeCard throw RangeError for an unknown rarity, changing nothing", () => {
    const ctx = progressCtx();
    const run = startProgressRun(ctx);
    const before = JSON.stringify(run);
    expect(() => learnCard(ctx.pack, run, "skill.t_cun", "gold" as never, null)).toThrow(RangeError);
    expect(() => upgradeCard(run, "skill.t_might_a", "gold" as never)).toThrow(RangeError);
    expect(JSON.stringify(run)).toBe(before);
  });

  it("learning or upgrading drops stray rarity entries for cards no longer held", () => {
    const ctx = progressCtx();
    const run = startProgressRun(ctx);
    run.player.rarities = { ...run.player.rarities, "skill.gone": "orange" };
    expect(upgradeCard(run, "skill.t_might_a", "green")).toEqual({ ok: true });
    expect(Object.keys(run.player.rarities).sort()).toEqual([...run.player.cards].sort());
  });
});
