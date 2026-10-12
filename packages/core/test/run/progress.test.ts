import { describe, expect, it } from "vitest";
import {
  applyLevelUp,
  assemblePlayer,
  cardFromSkill,
  cardWithRarity,
  chooseOption,
  createRng,
  createUnit,
  equipItem,
  forgetCard,
  gainRelic,
  itemOfferRarity,
  learnCard,
  levelUpOffer,
  playerUnitFromRun,
  powersOf,
  rarityRank,
  RARITIES,
  STAT_CAP,
  STAT_IDS,
  startFight,
  traitsOf,
  upgradeCard,
  weaponStrikeCard,
  type CardSpec,
  type ContentPack,
  type LearnResult,
  type Rarity,
  type RelicDef,
  type RunContext,
  type RunState,
  type StatBlock,
  type StatId,
} from "../../src/index.ts";
import { picks } from "./loadout-pack.ts";
import { fightAct } from "./combat-pack.ts";
import { ok } from "./run-pack.ts";
import { progressCtx, RELIC_IDS, snap, startProgressRun } from "./progress-pack.ts";

// Spec Draft 1.11, "Rarity" (decided 12 Oct 2026):
//   "Everything starts grey, Strike included, unless the loadout raises it: items and paths (later companions) can
//    name cards to start at a higher rarity (`startRarity`, e.g. the weapon's Strike at blue). Several sources: the
//    highest counts."
//   "Upgrading: when a reward, merchant or event offers a skill you hold at a higher rarity, taking it raises your
//    card to that rarity in its slot (no forgetting needed). A held skill is never offered at the same or a lower
//    rarity."
// Spec Draft 1.11, "Rewards and level-ups":
//   "A relic (content kind `relic`) is a passive held for the rest of the run with no slot limit: stats, powers,
//    traits, starting statuses in every fight, HP or Shield (e.g. Pilgrim's Bell: start every fight Warded 1)."
//   "Item swaps: the new item replaces the one in its slot; the old one is gone. Stats, max HP and Shield are
//    recomputed; the HP you were missing stays missing (50/60 → new max 70 → 60/70), and HP never drops below 1 from
//    a swap. A new weapon offers its Strike as a new skill (forget one or leave it, as in Skills); a new accessory
//    offers its granted skill or Word the same way. Cards from the old item stay."
//   "Level-ups ... The player is offered two stats, one of them always favoured, and raises one: a favoured stat +2,
//    any other +1, never above the run cap of 7 (base stats). The favoured stat is drawn among the character's
//    favoured stats below the cap; the other among the remaining stats below the cap. If no favoured stat can rise,
//    one other stat is offered; if none can rise, there is no level-up. Raising Vitality recomputes max HP (20 + 5 ×
//    final Vitality + items and relics) and current HP rises by the same amount as max HP."
// Spec "Skills": "A player holds at most 5." "Gaining a skill when full: ... The player forgets one current skill or
//   leaves the new one. Forgetting is permanent for the run." "Strike can be forgotten." "Changing weapon mid-run
//   offers the new weapon's Strike as a new skill through the same choice. The weapon's stat bonus applies either way."
// Spec "Loadout assembly": "max HP = 20 + 5 × Vitality (after modifiers) + the HP the items give"; "A stat never goes
//   below 0"; "The floor of 0 applies once, after all modifiers are added"; "Modifiers, powers and traits are read in
//   slot order: weapon, armor, accessory, path. Combined converts and slow-decay entries keep that order"; "Several
//   decay floors on the same status: the highest counts."
// Brief M2.4a: public API (run state `player.rarities`, `relics`; playerUnitFromRun with rarities and relics;
//   levelUpOffer, applyLevelUp, equipItem, itemOfferRarity, gainRelic, learnCard, upgradeCard, forgetCard) and notes
//   (maxHp at start equals loadout assembly; base stats track level-ups only).
// Brief M2.4a, clarifications: (1) assemblePlayer applies the starting rarities; (2) a held card with no rarity entry
//   counts as grey; (5) no favoured stat below the cap: one other stat; (6) a Vitality level-up recomputes max HP from
//   final Vitality (floor 0 applies) and current HP rises by the same amount; (7) learnCard with a forget id while
//   holding fewer than 5 ignores the forget and appends; (8) a newly equipped item's startRarity doesn't change held
//   cards; rarities only for held cards; unknown stat → RangeError; relic hp/shield integers >= 0.
//
// Test character: Brute (loadout-pack), Might and Vitality favoured: base Might 3, Vitality 3, others 2.
// Neutral picks: max HP 20 + 5 × 3 = 35, Shield 0. Starting cards: ["weapon.club", "skill.t_might_a"].

const STRIKE = "weapon.club";
const TECH = "skill.t_might_a";
const FAVOURED: readonly StatId[] = ["might", "vitality"];

const def = (pack: ContentPack, id: string) => {
  const d = pack.byId.get(id);
  if (d === undefined) throw new Error(`no ${id} in the pack`);
  return d;
};

/** The card an id builds at blue (content numbers): a weapon's Strike or a skill/Word card. */
function blueCard(pack: ContentPack, id: string): CardSpec {
  const d = def(pack, id);
  if (d.kind === "weapon") return weaponStrikeCard(d);
  if (d.kind === "skill" || d.kind === "word") return cardFromSkill(d);
  throw new Error(`${id} is not a card`);
}

const relicDef = (pack: ContentPack, id: string): RelicDef => {
  const d = def(pack, id);
  if (d.kind !== "relic") throw new Error(`${id} is not a relic`);
  return d;
};

/** Sets base stats (plain data, as a save would hold them). */
function setBase(run: RunState, stats: Partial<Record<StatId, number>>): void {
  run.player.baseStats = { ...run.player.baseStats, ...stats };
}

/** Every base stat at the cap except the given ones. */
function capAllBut(run: RunState, below: Partial<Record<StatId, number>>): void {
  const block = {} as Record<StatId, number>;
  for (const s of STAT_IDS) block[s] = below[s] ?? STAT_CAP;
  run.player.baseStats = block;
}

function fresh(over: Parameters<typeof startProgressRun>[1] = {}, technique: string | null = TECH): { ctx: RunContext; run: RunState } {
  const ctx = progressCtx();
  return { ctx, run: startProgressRun(ctx, over, technique) };
}

/** Fills the hand to 5 with t_cun, t_agi, t_wis (green). */
function fillHand(ctx: RunContext, run: RunState): void {
  for (const id of ["skill.t_cun", "skill.t_agi", "skill.t_wis"]) expect(learnCard(ctx.pack, run, id, "green", null)).toEqual({ ok: true });
  expect(run.player.cards).toHaveLength(5);
}

function expectRefused(run: RunState, act: () => LearnResult, reason: string): void {
  const before = snap(run);
  expect(act()).toEqual({ ok: false, reason });
  expect(snap(run)).toBe(before);
}

function expectThrowsUnchanged(run: RunState, act: () => unknown): void {
  const before = snap(run);
  expect(act).toThrow(RangeError);
  expect(snap(run)).toBe(before);
}

// =============================================================================================
describe("starting rarities", () => {
  it("everything starts grey, Strike included; every held card has an entry and only held cards do", () => {
    const { run } = fresh();
    expect(run.player.cards).toEqual([STRIKE, TECH]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "grey", [TECH]: "grey" });
  });

  it("the accessory's granted card starts grey too", () => {
    const { run } = fresh({ accessory: "accessory.focus" });
    expect(run.player.cards).toEqual([STRIKE, "skill.t_cun", TECH]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "grey", "skill.t_cun": "grey", [TECH]: "grey" });
  });

  it("a weapon's startRarity for its own Strike raises it (Blessed: green)", () => {
    const { run } = fresh({ weapon: "weapon.blessed" });
    expect(run.player.rarities).toEqual({ "weapon.blessed": "green", [TECH]: "grey" });
  });

  it("an armor's startRarity raises the cards it names (Tutor: technique purple, Club's Strike blue)", () => {
    const { run } = fresh({ armor: "armor.tutor" });
    expect(run.player.rarities).toEqual({ [STRIKE]: "blue", [TECH]: "purple" });
  });

  it("an accessory's startRarity raises its granted card (Charm: t_vit orange)", () => {
    const { run } = fresh({ accessory: "accessory.charm" });
    expect(run.player.cards).toEqual([STRIKE, "skill.t_vit", TECH]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "grey", "skill.t_vit": "orange", [TECH]: "grey" });
  });

  it("a path's startRarity raises cards too (Mentor: Club's Strike orange, technique green)", () => {
    const { run } = fresh({ path: "path.mentor" });
    expect(run.player.rarities).toEqual({ [STRIKE]: "orange", [TECH]: "green" });
  });

  it("several sources: the highest counts, whatever the slot order", () => {
    // Tutor (armor): technique purple, Strike blue. Mentor (path): technique green, Strike orange.
    const { run } = fresh({ armor: "armor.tutor", accessory: "accessory.charm", path: "path.mentor" });
    expect(run.player.cards).toEqual([STRIKE, "skill.t_vit", TECH]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "orange", "skill.t_vit": "orange", [TECH]: "purple" });
  });

  it("a startRarity naming a card that isn't held adds no entry", () => {
    const { run } = fresh({ armor: "armor.tutor" }, null);
    expect(run.player.cards).toEqual([STRIKE]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "blue" });
  });

  it("starts with no relics", () => {
    const { run } = fresh();
    expect(run.relics).toEqual([]);
  });

  it("max HP at the start still equals loadout assembly's (with and without startRarity items)", () => {
    for (const over of [{}, { armor: "armor.mail" }, { armor: "armor.tutor", path: "path.mentor" }, { accessory: "accessory.charm", armor: "armor.quilted" }]) {
      const { ctx, run } = fresh(over, null);
      const expected = assemblePlayer(ctx.pack, picks(over), null).unit.maxHp;
      expect(run.player.maxHp).toBe(expected);
      expect(run.player.hp).toBe(expected);
    }
  });

  it("assemblePlayer's unit carries the starting rarities (clarification 1)", () => {
    const over = { armor: "armor.tutor", accessory: "accessory.charm", path: "path.mentor" };
    const { ctx } = fresh(over);
    const cards = assemblePlayer(ctx.pack, picks(over), TECH).unit.cards ?? [];
    expect(cards.map((c) => c.id)).toEqual([STRIKE, "skill.t_vit", TECH]);
    expect(cards[0]).toEqual(cardWithRarity(blueCard(ctx.pack, STRIKE), "orange"));
    expect(cards[1]).toEqual(cardWithRarity(blueCard(ctx.pack, "skill.t_vit"), "orange"));
    expect(cards[2]).toEqual(cardWithRarity(blueCard(ctx.pack, TECH), "purple"));
  });

  it("assemblePlayer's cards are grey without startRarity, and a fresh run's unit matches them", () => {
    const { ctx, run } = fresh();
    const cards = assemblePlayer(ctx.pack, picks(), TECH).unit.cards ?? [];
    expect(cards[0]).toEqual(cardWithRarity(blueCard(ctx.pack, STRIKE), "grey"));
    expect(cards[1]).toEqual(cardWithRarity(blueCard(ctx.pack, TECH), "grey"));
    expect(playerUnitFromRun(ctx.pack, run).cards).toEqual(cards);
  });

  it("the run state is JSON-safe at the start", () => {
    const { run } = fresh({ armor: "armor.tutor", path: "path.mentor" });
    expect(JSON.parse(snap(run))).toEqual(run);
  });
});

// =============================================================================================
describe("playerUnitFromRun: rarities", () => {
  it("each card is built at its rarity (cardWithRarity of the content card)", () => {
    const { ctx, run } = fresh({ armor: "armor.tutor", accessory: "accessory.charm", path: "path.mentor" });
    const cards = playerUnitFromRun(ctx.pack, run).cards ?? [];
    expect(cards.map((c) => c.id)).toEqual(run.player.cards);
    run.player.cards.forEach((id, i) => {
      const rarity = run.player.rarities[id];
      expect(rarity).toBeDefined();
      if (rarity !== undefined) expect(cards[i]).toEqual(cardWithRarity(blueCard(ctx.pack, id), rarity));
    });
  });

  it("a fresh run's Strike is grey: the Club's 1 per Might becomes 0.9", () => {
    const { ctx, run } = fresh();
    const strike = (playerUnitFromRun(ctx.pack, run).cards ?? [])[0];
    const e = strike?.effects[0];
    expect(e?.type).toBe("damage");
    if (e?.type === "damage") {
      const term = e.scaling?.[0];
      expect(term !== undefined && "stat" in term ? term.per : null).toBeCloseTo(0.9, 9);
      expect(e.amount).toBe(2);
    }
  });

  it("a held card with no rarity entry counts as grey (clarification 2)", () => {
    const { ctx, run } = fresh();
    run.player.cards = [STRIKE, TECH, "word.t_arc"];
    run.player.rarities = { [STRIKE]: "orange" };
    const cards = playerUnitFromRun(ctx.pack, run).cards ?? [];
    expect(cards[0]).toEqual(cardWithRarity(blueCard(ctx.pack, STRIKE), "orange"));
    expect(cards[1]).toEqual(cardWithRarity(blueCard(ctx.pack, TECH), "grey"));
    expect(cards[2]).toEqual(cardWithRarity(blueCard(ctx.pack, "word.t_arc"), "grey"));
  });

  it("follows upgrades: an upgraded card is built at its new rarity", () => {
    const { ctx, run } = fresh();
    expect(upgradeCard(run, TECH, "orange")).toEqual({ ok: true });
    const cards = playerUnitFromRun(ctx.pack, run).cards ?? [];
    expect(cards[1]).toEqual(cardWithRarity(blueCard(ctx.pack, TECH), "orange"));
    expect(cards[0]).toEqual(cardWithRarity(blueCard(ctx.pack, STRIKE), "grey"));
  });
});

// =============================================================================================
describe("playerUnitFromRun: relics", () => {
  it("relic stats add to the item and path modifiers (Stone: +1 Might)", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.stone");
    expect(playerUnitFromRun(ctx.pack, run).stats).toMatchObject({ might: 4, vitality: 3, agility: 2 });
  });

  it("relic stats join the same floor-0 sum: Agility 2 − 3 (Heavy) + 1 (relic) = 0, not 1", () => {
    const { ctx, run } = fresh({ weapon: "weapon.heavy" });
    gainRelic(ctx.pack, run, "relic.rich"); // Agility +1, Cunning +2
    expect(playerUnitFromRun(ctx.pack, run).stats).toMatchObject({ agility: 0, cunning: 4, might: 8 });
  });

  it("relic stats sit on the run's base stats after level-ups", () => {
    const { ctx, run } = fresh();
    setBase(run, { might: 6 });
    gainRelic(ctx.pack, run, "relic.stone");
    expect(playerUnitFromRun(ctx.pack, run).stats?.might).toBe(7);
  });

  it("powers add up over the items, path and relics", () => {
    const over = { weapon: "weapon.fang", armor: "armor.thorned", accessory: "accessory.censer", path: "path.glutton" };
    const { ctx, run } = fresh(over);
    gainRelic(ctx.pack, run, "relic.rich");
    gainRelic(ctx.pack, run, "relic.second");
    const unit = playerUnitFromRun(ctx.pack, run);
    const sources = [over.weapon, over.armor, over.accessory, over.path, "relic.rich", "relic.second"].map((id) => {
      const d = def(ctx.pack, id) as { readonly powers?: Parameters<typeof powersOf>[0][number] };
      return d.powers;
    });
    const expected = powersOf(sources);
    expect(unit.bleedPower ?? 0).toBe(expected.bleedPower); // 1 + 2 + 0 + 1 + 2 + 1 = 7
    expect(unit.bleedPower).toBe(7);
    expect(unit.paralysisPower ?? 0).toBe(1);
    expect(unit.stunPower ?? 0).toBe(expected.stunPower);
    expect(unit.burnPower ?? 0).toBe(expected.burnPower);
    expect(unit.poisonPower ?? 0).toBe(expected.poisonPower);
  });

  it("traits: relics come after the path, in relic order (converts and slow decay); decay floors by max", () => {
    const over = { weapon: "weapon.fang", armor: "armor.thorned", accessory: "accessory.censer", path: "path.glutton" };
    const { ctx, run } = fresh(over);
    gainRelic(ctx.pack, run, "relic.second");
    gainRelic(ctx.pack, run, "relic.rich");
    const traitSources = [over.weapon, over.armor, over.accessory, over.path, "relic.second", "relic.rich"].map((id) => {
      const d = def(ctx.pack, id) as { readonly traits?: Parameters<typeof traitsOf>[0][number] };
      return d.traits;
    });
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(unit.traits).toEqual(traitsOf(traitSources));
    const converts = unit.traits?.converts ?? [];
    expect(converts.slice(-2)).toEqual([
      { on: "attacked", gain: "thorns", stacks: 2 },
      { on: "deflect", gain: "emboldened", stacks: 1 },
    ]);
    expect(unit.traits?.decayFloors).toMatchObject({ leeching: 5, thorns: 1, burning: 2 });
  });

  it("relic Shield adds to the items' max Shield, full at the start of a fight", () => {
    const { ctx, run } = fresh({ weapon: "weapon.knife", armor: "armor.mail" }); // 4 + 5
    gainRelic(ctx.pack, run, "relic.rich"); // + 4
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(unit.maxShield).toBe(13);
    expect(unit.shield ?? unit.maxShield).toBe(13);
  });

  it("starting statuses: summed over relics (Bell Warded 1 + Rich Warded 2, Thorns 3)", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.bell");
    gainRelic(ctx.pack, run, "relic.rich");
    const init = playerUnitFromRun(ctx.pack, run);
    expect(init.statuses).toMatchObject({ warded: 3, thorns: 3 });
    const u = createUnit(init);
    expect(u.statuses.stacks("warded")).toBe(3);
    expect(u.statuses.stacks("thorns")).toBe(3);
    expect(u.statuses.stacks("burning")).toBe(0);
  });

  it("no relics: still no statuses", () => {
    const { ctx, run } = fresh();
    const init = playerUnitFromRun(ctx.pack, run);
    expect(Object.values(init.statuses ?? {}).every((n) => n === undefined || n === 0)).toBe(true);
  });

  it("the Bell's Warded 1 is there at the start of every fight", () => {
    const ctx = progressCtx([fightAct("group.post")]);
    const run = startProgressRun(ctx, {}, null);
    gainRelic(ctx.pack, run, "relic.bell");
    ok(chooseOption(ctx, run, 0));
    const first = startFight(ctx, run);
    const p1 = first.state.units.find((u) => u.id === "player");
    expect(p1?.statuses.stacks("warded")).toBe(1);
    // Restarting the node (a new fight) starts Warded 1 again.
    const second = startFight(ctx, run);
    expect(second.state.units.find((u) => u.id === "player")?.statuses.stacks("warded")).toBe(1);
  });

  it("relic HP is part of max HP through run.player.maxHp (Heart: +10)", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.heart");
    const unit = playerUnitFromRun(ctx.pack, run);
    expect(run.player.maxHp).toBe(45);
    expect(unit.maxHp).toBe(45);
    expect(unit.hp).toBe(run.player.hp);
  });
});

// =============================================================================================
describe("gainRelic", () => {
  it("appends relics in the order gained", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.stone");
    gainRelic(ctx.pack, run, "relic.bell");
    gainRelic(ctx.pack, run, "relic.heart");
    expect(run.relics).toEqual(["relic.stone", "relic.bell", "relic.heart"]);
  });

  it("there is no slot limit", () => {
    const { ctx, run } = fresh();
    for (const id of RELIC_IDS) gainRelic(ctx.pack, run, id);
    expect(run.relics).toEqual([...RELIC_IDS]);
  });

  it("throws RangeError for a relic already held, and changes nothing", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.bell");
    expectThrowsUnchanged(run, () => gainRelic(ctx.pack, run, "relic.bell"));
  });

  it("throws RangeError for an unknown id or another kind, and changes nothing", () => {
    const { ctx, run } = fresh();
    for (const id of ["relic.nope", "armor.plain", "skill.t_cun", "weapon.longsword", "char.brute", ""]) {
      expectThrowsUnchanged(run, () => gainRelic(ctx.pack, run, id));
    }
  });

  it("relic HP raises max and current HP by that amount; missing HP stays missing (30/35 → 40/45)", () => {
    const { ctx, run } = fresh();
    run.player.hp = 30;
    gainRelic(ctx.pack, run, "relic.heart");
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(40);
  });

  it("a relic's Vitality raises max HP by 5, missing HP kept (30/35 → 35/40)", () => {
    const { ctx, run } = fresh();
    run.player.hp = 30;
    gainRelic(ctx.pack, run, "relic.vigour");
    expect(run.player.maxHp).toBe(40);
    expect(run.player.hp).toBe(35);
  });

  it("a relic without HP or Vitality leaves HP alone", () => {
    const { ctx, run } = fresh();
    run.player.hp = 12;
    gainRelic(ctx.pack, run, "relic.bell");
    gainRelic(ctx.pack, run, "relic.stone");
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(12);
  });

  it("doesn't change cards, rarities, picks or base stats", () => {
    const { ctx, run } = fresh();
    const before = JSON.parse(snap(run)) as RunState;
    gainRelic(ctx.pack, run, "relic.rich");
    expect(run.player.cards).toEqual(before.player.cards);
    expect(run.player.rarities).toEqual(before.player.rarities);
    expect(run.picks).toEqual(before.picks);
    expect(run.player.baseStats).toEqual(before.player.baseStats);
  });

  it("the relic def is readable from the pack (content kind relic)", () => {
    const { ctx } = fresh();
    expect(relicDef(ctx.pack, "relic.bell").statuses).toEqual({ warded: 1 });
  });
});

// =============================================================================================
describe("levelUpOffer", () => {
  const offerFor = (run: RunState, seed: string, pack: ContentPack): readonly StatId[] => levelUpOffer(pack, run, createRng(seed));

  it("a fresh Brute: two different stats, the first favoured", () => {
    const { ctx, run } = fresh();
    for (let i = 0; i < 50; i++) {
      const offer = offerFor(run, `s${i}`, ctx.pack);
      expect(offer).toHaveLength(2);
      expect(FAVOURED).toContain(offer[0]);
      expect(offer[0]).not.toBe(offer[1]);
      expect(STAT_IDS).toContain(offer[1]);
    }
  });

  it("over many draws: each favoured stat comes first sometimes; the second can be any other stat, favoured or not", () => {
    const { ctx, run } = fresh();
    const firsts = new Set<StatId>();
    const seconds = new Set<StatId>();
    let secondFavoured = false;
    for (let i = 0; i < 400; i++) {
      const offer = offerFor(run, `d${i}`, ctx.pack);
      const [a, b] = offer;
      if (a !== undefined) firsts.add(a);
      if (b !== undefined) seconds.add(b);
      if (b !== undefined && FAVOURED.includes(b)) secondFavoured = true;
    }
    expect([...firsts].sort()).toEqual([...FAVOURED].sort());
    expect([...seconds].sort()).toEqual([...STAT_IDS].sort());
    expect(secondFavoured).toBe(true);
  });

  it("is deterministic: the same rng seed gives the same offer; it doesn't change the run", () => {
    const { ctx, run } = fresh();
    const before = snap(run);
    for (let i = 0; i < 20; i++) expect(offerFor(run, `x${i}`, ctx.pack)).toEqual(offerFor(run, `x${i}`, ctx.pack));
    expect(snap(run)).toBe(before);
  });

  it("a favoured stat at the cap is never offered; the other favoured stat comes first", () => {
    const { ctx, run } = fresh();
    setBase(run, { might: STAT_CAP });
    for (let i = 0; i < 100; i++) {
      const offer = offerFor(run, `m${i}`, ctx.pack);
      expect(offer).toHaveLength(2);
      expect(offer[0]).toBe("vitality");
      expect(offer).not.toContain("might");
    }
  });

  it("the second stat is drawn only among stats below the cap", () => {
    const { ctx, run } = fresh();
    capAllBut(run, { might: 3, vitality: 3, wisdom: 5 });
    const seconds = new Set<StatId>();
    for (let i = 0; i < 200; i++) {
      const offer = offerFor(run, `w${i}`, ctx.pack);
      expect(offer).toHaveLength(2);
      expect(FAVOURED).toContain(offer[0]);
      const b = offer[1];
      if (b !== undefined) seconds.add(b);
    }
    expect([...seconds].sort()).toEqual(["might", "vitality", "wisdom"]);
  });

  it("a stat at 6 is below the cap and can be offered", () => {
    const { ctx, run } = fresh();
    capAllBut(run, { vitality: 6 });
    expect(offerFor(run, "a", ctx.pack)).toEqual(["vitality"]);
  });

  it("only one stat can rise (a favoured one): it is the only option", () => {
    const { ctx, run } = fresh();
    capAllBut(run, { might: 5 });
    for (let i = 0; i < 10; i++) expect(offerFor(run, `o${i}`, ctx.pack)).toEqual(["might"]);
  });

  it("only one stat can rise (not favoured): it is the only option", () => {
    const { ctx, run } = fresh();
    capAllBut(run, { arcana: 2 });
    for (let i = 0; i < 10; i++) expect(offerFor(run, `p${i}`, ctx.pack)).toEqual(["arcana"]);
  });

  it("no favoured stat below the cap: one stat drawn among the others below the cap (clarification 5)", () => {
    const { ctx, run } = fresh();
    setBase(run, { might: STAT_CAP, vitality: STAT_CAP });
    const seen = new Set<StatId>();
    for (let i = 0; i < 200; i++) {
      const offer = offerFor(run, `q${i}`, ctx.pack);
      expect(offer).toHaveLength(1);
      const a = offer[0];
      expect(FAVOURED).not.toContain(a);
      if (a !== undefined) seen.add(a);
    }
    expect([...seen].sort()).toEqual(["agility", "arcana", "cunning", "intelligence", "wisdom"]);
  });

  it("no stat can rise: no level-up (empty offer)", () => {
    const { ctx, run } = fresh();
    capAllBut(run, {});
    expect(offerFor(run, "z", ctx.pack)).toEqual([]);
  });

  it("the cap counts base stats, not item bonuses (Heavy +5 Might: final 8, base 3, still offered)", () => {
    const { ctx, run } = fresh({ weapon: "weapon.heavy" });
    capAllBut(run, { might: 3 });
    expect(playerUnitFromRun(ctx.pack, run).stats?.might).toBe(8);
    expect(offerFor(run, "h", ctx.pack)).toEqual(["might"]);
  });

  it("uses the character's favoured stats (Sage: Intelligence and Wisdom first)", () => {
    const ctx = progressCtx();
    const run = startProgressRun(ctx, { character: "char.sage" });
    for (let i = 0; i < 50; i++) {
      const offer = offerFor(run, `g${i}`, ctx.pack);
      expect(["intelligence", "wisdom"]).toContain(offer[0]);
      expect(offer).toHaveLength(2);
    }
  });
});

// =============================================================================================
describe("applyLevelUp", () => {
  it("a favoured stat gains 2 (Brute Might 3 → 5)", () => {
    const { ctx, run } = fresh();
    applyLevelUp(ctx.pack, run, "might");
    expect(run.player.baseStats.might).toBe(5);
  });

  it("any other stat gains 1 (Brute Agility 2 → 3)", () => {
    const { ctx, run } = fresh();
    applyLevelUp(ctx.pack, run, "agility");
    expect(run.player.baseStats.agility).toBe(3);
  });

  it("only the chosen stat changes", () => {
    const { ctx, run } = fresh();
    const before: StatBlock = { ...run.player.baseStats };
    applyLevelUp(ctx.pack, run, "wisdom");
    for (const s of STAT_IDS) expect(run.player.baseStats[s]).toBe(s === "wisdom" ? before[s] + 1 : before[s]);
  });

  it("never above the cap: a favoured stat at 6 gains only 1", () => {
    const { ctx, run } = fresh();
    setBase(run, { might: 6 });
    applyLevelUp(ctx.pack, run, "might");
    expect(run.player.baseStats.might).toBe(STAT_CAP);
  });

  it("a stat at the cap can't rise: RangeError, nothing changes", () => {
    const { ctx, run } = fresh();
    setBase(run, { might: STAT_CAP, agility: STAT_CAP });
    expectThrowsUnchanged(run, () => applyLevelUp(ctx.pack, run, "might"));
    expectThrowsUnchanged(run, () => applyLevelUp(ctx.pack, run, "agility"));
  });

  it("an unknown stat id: RangeError, nothing changes", () => {
    const { ctx, run } = fresh();
    expectThrowsUnchanged(run, () => applyLevelUp(ctx.pack, run, "luck" as StatId));
  });

  it("the cap counts base stats: Heavy's +5 Might doesn't stop a level-up", () => {
    const { ctx, run } = fresh({ weapon: "weapon.heavy" });
    applyLevelUp(ctx.pack, run, "might");
    expect(run.player.baseStats.might).toBe(5);
    expect(playerUnitFromRun(ctx.pack, run).stats?.might).toBe(10);
  });

  it("Vitality (favoured, +2) raises max HP and current HP by 10; missing HP stays missing", () => {
    const { ctx, run } = fresh();
    run.player.hp = 20;
    applyLevelUp(ctx.pack, run, "vitality");
    expect(run.player.baseStats.vitality).toBe(5);
    expect(run.player.maxHp).toBe(45);
    expect(run.player.hp).toBe(30);
  });

  it("Vitality (not favoured, +1) raises max HP and current HP by 5", () => {
    const ctx = progressCtx();
    const run = startProgressRun(ctx, { character: "char.sage" }, null);
    expect(run.player.maxHp).toBe(30);
    run.player.hp = 7;
    applyLevelUp(ctx.pack, run, "vitality");
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(12);
  });

  it("Vitality at 6 (favoured): only 1 point gained, so +5 max and current HP", () => {
    const { ctx, run } = fresh();
    setBase(run, { vitality: 6 });
    run.player.maxHp = 50; // 20 + 5 × 6
    run.player.hp = 40;
    applyLevelUp(ctx.pack, run, "vitality");
    expect(run.player.baseStats.vitality).toBe(7);
    expect(run.player.maxHp).toBe(55);
    expect(run.player.hp).toBe(45);
  });

  it("Vitality under a malus: max HP recomputed from final Vitality (floor 0), HP rises by the same amount (clarification 6)", () => {
    // Brute Vitality 3 − 4 (Crushing) = −1 → 0: max HP 20 + 0 + 10 = 30. Level-up +2: base 5, final 1 → max 35.
    const { ctx, run } = fresh({ armor: "armor.crushing" });
    expect(run.player.maxHp).toBe(30);
    run.player.hp = 20;
    applyLevelUp(ctx.pack, run, "vitality");
    expect(run.player.baseStats.vitality).toBe(5);
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(25);
  });

  it("Vitality fully absorbed by a malus: max HP and HP don't change (clarification 6)", () => {
    // Base Vitality 1 (set), Crushing −4: final 0 before and after a +2 level-up (base 3 − 4 → 0).
    const { ctx, run } = fresh({ armor: "armor.crushing" });
    setBase(run, { vitality: 1 });
    run.player.hp = 20;
    applyLevelUp(ctx.pack, run, "vitality");
    expect(run.player.baseStats.vitality).toBe(3);
    expect(run.player.maxHp).toBe(30);
    expect(run.player.hp).toBe(20);
  });

  it("Vitality with relics: max HP counts the relics' HP and Vitality", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.heart");
    gainRelic(ctx.pack, run, "relic.vigour"); // 20 + 5 × 4 + 10 = 50
    run.player.hp = 40;
    applyLevelUp(ctx.pack, run, "vitality"); // final 6: 60
    expect(run.player.maxHp).toBe(60);
    expect(run.player.hp).toBe(50);
  });

  it("another stat leaves max HP and HP alone", () => {
    const { ctx, run } = fresh();
    run.player.hp = 20;
    applyLevelUp(ctx.pack, run, "might");
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(20);
  });

  it("the fight's unit sees the raised stat", () => {
    const { ctx, run } = fresh();
    applyLevelUp(ctx.pack, run, "cunning");
    expect(playerUnitFromRun(ctx.pack, run).stats?.cunning).toBe(3);
  });

  it("repeated level-ups climb to the cap and then stop", () => {
    const { ctx, run } = fresh();
    applyLevelUp(ctx.pack, run, "might"); // 5
    applyLevelUp(ctx.pack, run, "might"); // 7
    expect(run.player.baseStats.might).toBe(7);
    expect(() => applyLevelUp(ctx.pack, run, "might")).toThrow(RangeError);
    expect(levelUpOffer(ctx.pack, run, createRng("after"))).not.toContain("might");
  });
});

// =============================================================================================
describe("equipItem", () => {
  it("replaces the item in its slot; the other picks stay", () => {
    const { ctx, run } = fresh();
    equipItem(ctx.pack, run, "armor.mail");
    expect(run.picks).toEqual(picks({ armor: "armor.mail" }));
    equipItem(ctx.pack, run, "weapon.longsword");
    equipItem(ctx.pack, run, "accessory.focus");
    expect(run.picks).toEqual(picks({ weapon: "weapon.longsword", armor: "armor.mail", accessory: "accessory.focus" }));
  });

  it("the spec's example: 50/60 → new max 70 → 60/70", () => {
    const { ctx, run } = fresh({ armor: "armor.quilted" });
    expect(run.player.maxHp).toBe(60);
    run.player.hp = 50;
    equipItem(ctx.pack, run, "armor.plate");
    expect(run.player.maxHp).toBe(70);
    expect(run.player.hp).toBe(60);
  });

  it("a lower max HP keeps the missing HP missing: 50/60 → 35 max → 25/35", () => {
    const { ctx, run } = fresh({ armor: "armor.quilted" });
    run.player.hp = 50;
    equipItem(ctx.pack, run, "armor.plain");
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(25);
  });

  it("full HP stays full", () => {
    const { ctx, run } = fresh({ armor: "armor.quilted" });
    equipItem(ctx.pack, run, "armor.plain");
    expect(run.player.hp).toBe(35);
    equipItem(ctx.pack, run, "armor.plate");
    expect(run.player.hp).toBe(70);
  });

  it("HP never drops below 1 from a swap: 5/60 → 35 max → 1/35", () => {
    const { ctx, run } = fresh({ armor: "armor.quilted" });
    run.player.hp = 5;
    equipItem(ctx.pack, run, "armor.plain");
    expect(run.player.maxHp).toBe(35);
    expect(run.player.hp).toBe(1);
  });

  it("max HP uses Vitality after modifiers: Mail (+2 Vitality, +10 HP) → 20 + 25 + 10 = 55", () => {
    const { ctx, run } = fresh();
    run.player.hp = 30;
    equipItem(ctx.pack, run, "armor.mail");
    expect(run.player.maxHp).toBe(55);
    expect(run.player.hp).toBe(50);
  });

  it("max HP floors Vitality at 0: Crushing (−4 Vitality, +10 HP) → 20 + 0 + 10 = 30", () => {
    const { ctx, run } = fresh();
    equipItem(ctx.pack, run, "armor.crushing");
    expect(run.player.maxHp).toBe(30);
    expect(run.player.hp).toBe(30);
  });

  it("max HP counts the run's base stats after level-ups and the relics' HP", () => {
    const { ctx, run } = fresh();
    applyLevelUp(ctx.pack, run, "vitality"); // base 5: 45
    gainRelic(ctx.pack, run, "relic.heart"); // 55
    gainRelic(ctx.pack, run, "relic.vigour"); // Vitality 6: 60
    expect(run.player.maxHp).toBe(60);
    equipItem(ctx.pack, run, "armor.quilted"); // + 25
    expect(run.player.maxHp).toBe(85);
    expect(run.player.hp).toBe(85);
  });

  it("Shield is recomputed: the fight's unit has the new item's Shield", () => {
    const { ctx, run } = fresh({ armor: "armor.mail" });
    expect(playerUnitFromRun(ctx.pack, run).maxShield).toBe(5);
    equipItem(ctx.pack, run, "weapon.knife");
    expect(playerUnitFromRun(ctx.pack, run).maxShield).toBe(9);
    equipItem(ctx.pack, run, "armor.plain");
    expect(playerUnitFromRun(ctx.pack, run).maxShield).toBe(4);
  });

  it("stats are recomputed: the new weapon's stat bonus applies whether or not its Strike is learned", () => {
    const { ctx, run } = fresh();
    equipItem(ctx.pack, run, "weapon.longsword"); // +1 Might
    expect(playerUnitFromRun(ctx.pack, run).stats?.might).toBe(4);
    expect(run.player.baseStats.might).toBe(3);
  });

  it("a new weapon offers its Strike (its id); cards are not added; the old Strike stays", () => {
    const { ctx, run } = fresh();
    const res = equipItem(ctx.pack, run, "weapon.longsword");
    expect(res.offers).toEqual(["weapon.longsword"]);
    expect(run.player.cards).toEqual([STRIKE, TECH]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "grey", [TECH]: "grey" });
    // The old weapon's Strike still builds.
    expect((playerUnitFromRun(ctx.pack, run).cards ?? []).map((c) => c.id)).toEqual([STRIKE, TECH]);
  });

  it("a new weapon whose Strike is already held offers nothing", () => {
    const { ctx, run } = fresh();
    equipItem(ctx.pack, run, "weapon.longsword");
    expect(equipItem(ctx.pack, run, STRIKE).offers).toEqual([]);
  });

  it("a new accessory with a grant offers that card unless held", () => {
    const { ctx, run } = fresh();
    expect(equipItem(ctx.pack, run, "accessory.focus").offers).toEqual(["skill.t_cun"]);
    expect(run.player.cards).toEqual([STRIKE, TECH]);
    expect(learnCard(ctx.pack, run, "skill.t_vit", "grey", null)).toEqual({ ok: true });
    expect(equipItem(ctx.pack, run, "accessory.charm").offers).toEqual([]);
  });

  it("an accessory that grants the starting technique offers nothing (already held)", () => {
    const { ctx, run } = fresh();
    expect(equipItem(ctx.pack, run, "accessory.scroll_case").offers).toEqual([]);
  });

  it("armor, and an accessory without a grant, offer nothing", () => {
    const { ctx, run } = fresh();
    expect(equipItem(ctx.pack, run, "armor.mail").offers).toEqual([]);
    expect(equipItem(ctx.pack, run, "accessory.locket").offers).toEqual([]);
  });

  it("cards from the old item stay (the old accessory's grant)", () => {
    const { ctx, run } = fresh({ accessory: "accessory.focus" });
    equipItem(ctx.pack, run, "accessory.plain");
    expect(run.player.cards).toEqual([STRIKE, "skill.t_cun", TECH]);
  });

  it("a new item's startRarity doesn't change held cards", () => {
    const { ctx, run } = fresh();
    equipItem(ctx.pack, run, "armor.tutor");
    expect(run.player.rarities).toEqual({ [STRIKE]: "grey", [TECH]: "grey" });
  });

  it("throws RangeError for an item already equipped, and changes nothing", () => {
    const { ctx, run } = fresh();
    for (const id of [STRIKE, "armor.plain", "accessory.plain"]) expectThrowsUnchanged(run, () => equipItem(ctx.pack, run, id));
  });

  it("throws RangeError for an id that isn't a weapon, armor or accessory, and changes nothing", () => {
    const { ctx, run } = fresh();
    for (const id of ["path.mentor", "char.sage", "skill.t_cun", "word.t_arc", "relic.bell", "enemy.post", "armor.nope", ""]) {
      expectThrowsUnchanged(run, () => equipItem(ctx.pack, run, id));
    }
  });
});

// =============================================================================================
describe("itemOfferRarity", () => {
  it("grey when nothing names the card", () => {
    const { ctx, run } = fresh();
    expect(itemOfferRarity(ctx.pack, run, "weapon.longsword")).toBe("grey");
    expect(itemOfferRarity(ctx.pack, run, "skill.t_cun")).toBe("grey");
  });

  it("a newly equipped weapon's startRarity for its own Strike (Blessed: green)", () => {
    const { ctx, run } = fresh();
    expect(equipItem(ctx.pack, run, "weapon.blessed").offers).toEqual(["weapon.blessed"]);
    expect(itemOfferRarity(ctx.pack, run, "weapon.blessed")).toBe("green");
  });

  it("a newly equipped accessory's startRarity for its grant (Charm: t_vit orange)", () => {
    const { ctx, run } = fresh();
    expect(equipItem(ctx.pack, run, "accessory.charm").offers).toEqual(["skill.t_vit"]);
    expect(itemOfferRarity(ctx.pack, run, "skill.t_vit")).toBe("orange");
  });

  it("the highest across the current weapon, armor, accessory and path", () => {
    const { ctx, run } = fresh({ path: "path.mentor" });
    expect(itemOfferRarity(ctx.pack, run, TECH)).toBe("green");
    expect(itemOfferRarity(ctx.pack, run, STRIKE)).toBe("orange");
    equipItem(ctx.pack, run, "armor.tutor");
    expect(itemOfferRarity(ctx.pack, run, TECH)).toBe("purple");
    expect(itemOfferRarity(ctx.pack, run, STRIKE)).toBe("orange");
  });

  it("only current items count: a swapped-out item's startRarity no longer applies", () => {
    const { ctx, run } = fresh({ armor: "armor.tutor" });
    expect(itemOfferRarity(ctx.pack, run, TECH)).toBe("purple");
    equipItem(ctx.pack, run, "armor.plain");
    expect(itemOfferRarity(ctx.pack, run, TECH)).toBe("grey");
  });

  it("learning an offered Strike at itemOfferRarity records that rarity", () => {
    const { ctx, run } = fresh();
    const { offers } = equipItem(ctx.pack, run, "weapon.blessed");
    for (const id of offers) expect(learnCard(ctx.pack, run, id, itemOfferRarity(ctx.pack, run, id), null)).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, TECH, "weapon.blessed"]);
    expect(run.player.rarities["weapon.blessed"]).toBe("green");
  });

  it("doesn't change the run", () => {
    const { ctx, run } = fresh({ path: "path.mentor" });
    const before = snap(run);
    itemOfferRarity(ctx.pack, run, STRIKE);
    expect(snap(run)).toBe(before);
  });
});

// =============================================================================================
describe("learnCard", () => {
  it("appends a skill below 5 cards, at the given rarity", () => {
    const { ctx, run } = fresh();
    expect(learnCard(ctx.pack, run, "skill.t_cun", "purple", null)).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, TECH, "skill.t_cun"]);
    expect(run.player.rarities["skill.t_cun"]).toBe("purple");
  });

  it("learns a Word, and a weapon's Strike (by the weapon id)", () => {
    const { ctx, run } = fresh();
    expect(learnCard(ctx.pack, run, "word.t_arc", "blue", null)).toEqual({ ok: true });
    expect(learnCard(ctx.pack, run, "weapon.longsword", "orange", null)).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, TECH, "word.t_arc", "weapon.longsword"]);
    const cards = playerUnitFromRun(ctx.pack, run).cards ?? [];
    expect(cards[2]).toEqual(cardWithRarity(blueCard(ctx.pack, "word.t_arc"), "blue"));
    expect(cards[3]).toEqual(cardWithRarity(blueCard(ctx.pack, "weapon.longsword"), "orange"));
  });

  it("every rarity can be learned", () => {
    for (const r of RARITIES) {
      const { ctx, run } = fresh();
      expect(learnCard(ctx.pack, run, "skill.t_agi", r, null)).toEqual({ ok: true });
      expect(run.player.rarities["skill.t_agi"]).toBe(r);
    }
  });

  it("with 5 held and no card to forget: refused \"full\", nothing changes", () => {
    const { ctx, run } = fresh();
    fillHand(ctx, run);
    expectRefused(run, () => learnCard(ctx.pack, run, "skill.t_vit", "orange", null), "full");
  });

  it("with 5 held, forgetting a card not held: refused \"not_held\", nothing changes", () => {
    const { ctx, run } = fresh();
    fillHand(ctx, run);
    expectRefused(run, () => learnCard(ctx.pack, run, "skill.t_vit", "orange", "skill.t_might_b"), "not_held");
    expectRefused(run, () => learnCard(ctx.pack, run, "skill.t_vit", "orange", "skill.nope"), "not_held");
  });

  it("with 5 held, forgetting a held card: the new card takes its place; the old rarity entry goes", () => {
    const { ctx, run } = fresh();
    fillHand(ctx, run); // [club, t_might_a, t_cun, t_agi, t_wis]
    expect(learnCard(ctx.pack, run, "skill.t_vit", "orange", TECH)).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, "skill.t_vit", "skill.t_cun", "skill.t_agi", "skill.t_wis"]);
    expect(TECH in run.player.rarities).toBe(false);
    expect(run.player.rarities["skill.t_vit"]).toBe("orange");
    expect(Object.keys(run.player.rarities).sort()).toEqual([...run.player.cards].sort());
  });

  it("Strike can be forgotten to make room", () => {
    const { ctx, run } = fresh();
    fillHand(ctx, run);
    expect(learnCard(ctx.pack, run, "skill.t_vit", "grey", STRIKE)).toEqual({ ok: true });
    expect(run.player.cards[0]).toBe("skill.t_vit");
    expect(run.player.cards).not.toContain(STRIKE);
  });

  it("a card already held: refused \"already_held\" (whatever the rarity), nothing changes", () => {
    const { ctx, run } = fresh();
    for (const r of RARITIES) expectRefused(run, () => learnCard(ctx.pack, run, TECH, r, null), "already_held");
    expectRefused(run, () => learnCard(ctx.pack, run, STRIKE, "orange", null), "already_held");
  });

  it("an id that isn't a skill, Word or weapon: refused \"unknown_card\", nothing changes", () => {
    const { ctx, run } = fresh();
    for (const id of ["skill.nope", "armor.plain", "accessory.focus", "path.mentor", "relic.bell", "char.brute", "enemy.post", ""]) {
      expectRefused(run, () => learnCard(ctx.pack, run, id, "grey", null), "unknown_card");
    }
  });

  it("with fewer than 5 held, a forget id is ignored: the card is appended (clarification 7)", () => {
    const { ctx, run } = fresh();
    expect(learnCard(ctx.pack, run, "skill.t_cun", "blue", TECH)).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, TECH, "skill.t_cun"]);
    expect(run.player.rarities).toEqual({ [STRIKE]: "grey", [TECH]: "grey", "skill.t_cun": "blue" });
    // An unknown or unheld forget id is ignored too.
    expect(learnCard(ctx.pack, run, "skill.t_agi", "grey", "skill.nope")).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, TECH, "skill.t_cun", "skill.t_agi"]);
  });

  it("the hand never exceeds 5", () => {
    const { ctx, run } = fresh();
    fillHand(ctx, run);
    learnCard(ctx.pack, run, "word.t_arc", "grey", null);
    learnCard(ctx.pack, run, "skill.t_vit", "grey", "skill.t_cun");
    expect(run.player.cards).toHaveLength(5);
    expect(createUnit(playerUnitFromRun(ctx.pack, run)).cards).toHaveLength(5);
  });
});

// =============================================================================================
describe("upgradeCard", () => {
  it("raises a held card's rarity in its slot", () => {
    const { ctx, run } = fresh();
    expect(upgradeCard(run, TECH, "blue")).toEqual({ ok: true });
    expect(run.player.rarities[TECH]).toBe("blue");
    expect(run.player.cards).toEqual([STRIKE, TECH]);
    expect(upgradeCard(run, TECH, "orange")).toEqual({ ok: true });
    expect(run.player.rarities[TECH]).toBe("orange");
    expect((playerUnitFromRun(ctx.pack, run).cards ?? [])[1]).toEqual(cardWithRarity(blueCard(ctx.pack, TECH), "orange"));
  });

  it("works on Strike too", () => {
    const { run } = fresh();
    expect(upgradeCard(run, STRIKE, "green")).toEqual({ ok: true });
    expect(run.player.rarities[STRIKE]).toBe("green");
  });

  it("the same or a lower rarity: refused \"not_higher\", nothing changes", () => {
    const { run } = fresh();
    expect(upgradeCard(run, TECH, "purple")).toEqual({ ok: true });
    for (const r of RARITIES.filter((x) => rarityRank(x) <= rarityRank("purple"))) {
      expectRefused(run, () => upgradeCard(run, TECH, r), "not_higher");
    }
    expectRefused(run, () => upgradeCard(run, STRIKE, "grey"), "not_higher");
  });

  it("a card not held: refused \"not_held\", nothing changes", () => {
    const { run } = fresh();
    expectRefused(run, () => upgradeCard(run, "skill.t_cun", "orange"), "not_held");
    expectRefused(run, () => upgradeCard(run, "skill.nope", "orange"), "not_held");
  });

  it("a held card with no rarity entry upgrades from grey (clarification 2)", () => {
    const { run } = fresh();
    run.player.rarities = { [STRIKE]: "grey" };
    expectRefused(run, () => upgradeCard(run, TECH, "grey"), "not_higher");
    expect(upgradeCard(run, TECH, "green")).toEqual({ ok: true });
    expect(run.player.rarities[TECH]).toBe("green");
  });

  it("after an upgrade every rarity entry still matches a held card", () => {
    const { run } = fresh();
    upgradeCard(run, TECH, "blue");
    expect(Object.keys(run.player.rarities).sort()).toEqual([...run.player.cards].sort());
  });
});

// =============================================================================================
describe("forgetCard", () => {
  it("removes a held card and its rarity entry; the others keep their order", () => {
    const { ctx, run } = fresh();
    fillHand(ctx, run);
    expect(forgetCard(run, "skill.t_cun")).toEqual({ ok: true });
    expect(run.player.cards).toEqual([STRIKE, TECH, "skill.t_agi", "skill.t_wis"]);
    expect("skill.t_cun" in run.player.rarities).toBe(false);
    expect(Object.keys(run.player.rarities).sort()).toEqual([...run.player.cards].sort());
  });

  it("Strike can be forgotten: the fight's unit has no Strike", () => {
    const { ctx, run } = fresh();
    expect(forgetCard(run, STRIKE)).toEqual({ ok: true });
    expect(run.player.cards).toEqual([TECH]);
    expect((playerUnitFromRun(ctx.pack, run).cards ?? []).map((c) => c.id)).toEqual([TECH]);
  });

  it("a forgotten card can be learned again, at a new rarity", () => {
    const { ctx, run } = fresh();
    upgradeCard(run, TECH, "orange");
    forgetCard(run, TECH);
    expect(learnCard(ctx.pack, run, TECH, "green", null)).toEqual({ ok: true });
    expect(run.player.rarities[TECH]).toBe("green");
    expect(run.player.cards).toEqual([STRIKE, TECH]);
  });

  it("a card not held: refused \"not_held\", nothing changes", () => {
    const { run } = fresh();
    expectRefused(run, () => forgetCard(run, "skill.t_cun"), "not_held");
  });
});

// =============================================================================================
describe("progress keeps the run state plain data", () => {
  it("survives a JSON round trip after every kind of progress, and the copy builds the same unit", () => {
    const { ctx, run } = fresh({ path: "path.mentor" });
    applyLevelUp(ctx.pack, run, "vitality");
    gainRelic(ctx.pack, run, "relic.rich");
    gainRelic(ctx.pack, run, "relic.heart");
    equipItem(ctx.pack, run, "armor.mail");
    learnCard(ctx.pack, run, "skill.t_cun", "blue", null);
    upgradeCard(run, TECH, "orange");
    forgetCard(run, STRIKE);
    run.player.hp = 17;

    const copy = JSON.parse(snap(run)) as RunState;
    expect(copy).toEqual(run);
    expect(playerUnitFromRun(ctx.pack, copy)).toEqual(playerUnitFromRun(ctx.pack, run));
  });

  it("rarities are rarity names and relics a list of ids", () => {
    const { ctx, run } = fresh();
    gainRelic(ctx.pack, run, "relic.bell");
    for (const r of Object.values(run.player.rarities)) expect(RARITIES).toContain(r as Rarity);
    expect(Array.isArray(run.relics)).toBe(true);
    expect(run.relics.every((id) => typeof id === "string")).toBe(true);
  });
});
