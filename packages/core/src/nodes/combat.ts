/**
 * The combat node module (spec: Combat node; ADR 0011). Draws a tier from the act's step band, then a group of that
 * tier; a fixed combat node fights its `ref` group. The fight itself runs in run/fight.ts.
 *
 * Tiers are a data enum of the content format, read from the group files; no content id decides behaviour
 * (code rule 2). Randomness comes only from the build's rng (code rule 3).
 */
import { DRAWN_TIERS, type ActDef, type ContentPack, type DrawnTier, type GroupDef, type GroupTier, type TierBand } from "../content/types.ts";
import { pickWeighted, type WeightedType } from "../run/draw.ts";
import type { NodeBuild, NodeBuildContext, NodeType } from "./types.ts";

/** What a combat option carries in `data`: the group to fight and its tier. */
export interface CombatNodeData {
  readonly group: string;
  readonly tier: GroupTier;
}

/** The band that applies at `step`: the last one starting at or before it. */
export function tierBandAt(act: ActDef, step: number): TierBand | null {
  let band: TierBand | null = null;
  for (const b of act.tiers ?? []) if (b.from <= step) band = b;
  return band;
}

/** The act's groups of a tier, in the act's `groups` order. Ids that aren't groups are skipped. */
function groupsOfTier(pack: ContentPack, act: ActDef, tier: GroupTier): GroupDef[] {
  const out: GroupDef[] = [];
  for (const id of act.groups ?? []) {
    const def = pack.byId.get(id);
    if (def?.kind === "group" && def.tier === tier) out.push(def);
  }
  return out;
}

/** The band's tiers with weight > 0 that have at least one group in the act, with their weights, in tier order. */
function drawableTiers(pack: ContentPack, act: ActDef, band: TierBand): WeightedType[] {
  const out: WeightedType[] = [];
  for (const tier of DRAWN_TIERS) {
    const weight = band.weights[tier] ?? 0;
    if (weight > 0 && groupsOfTier(pack, act, tier).length > 0) out.push({ type: tier, weight });
  }
  return out;
}

const isDrawnTier = (tier: string): tier is DrawnTier => (DRAWN_TIERS as readonly string[]).includes(tier);

function buildFor(group: GroupDef): NodeBuild {
  const data: CombatNodeData = { group: group.id, tier: group.tier };
  return { text: group.text, tag: `node.tag.${group.tier}`, data: { ...data } };
}

export const combatNodeType: NodeType = {
  id: "combat",
  mayFollowItself: true,

  canAppear(run, act, pack) {
    const band = tierBandAt(act, run.step);
    return band !== null && drawableTiers(pack, act, band).length > 0;
  },

  build(ctx: NodeBuildContext): NodeBuild {
    const { act, pack } = ctx;
    if (ctx.fixed) {
      // A fixed node fights its ref, whatever the tier and whether or not the act lists it.
      if (ctx.ref === null) throw new RangeError(`combat node: the fixed combat node in "${act.id}" has no ref (a group id)`);
      const def = pack.byId.get(ctx.ref);
      if (def?.kind !== "group") throw new RangeError(`combat node: ref "${ctx.ref}" in "${act.id}" is not a group in pack "${pack.id}"`);
      return buildFor(def);
    }
    const band = tierBandAt(act, ctx.run.step);
    const tiers = band === null ? [] : drawableTiers(pack, act, band);
    if (tiers.length === 0) throw new RangeError(`combat node: nothing to draw at step ${ctx.run.step} of "${act.id}"`);
    const tier = pickWeighted(ctx.rng, tiers);
    if (!isDrawnTier(tier)) throw new RangeError(`combat node: "${tier}" is not a drawable tier`);
    const groups = groupsOfTier(pack, act, tier);
    const group = groups[ctx.rng.int(0, groups.length - 1)];
    if (group === undefined) throw new RangeError(`combat node: no ${tier} group in "${act.id}"`);
    return buildFor(group);
  },
};
