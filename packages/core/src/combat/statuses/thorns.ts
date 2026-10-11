import { applyDamage, reportDamage } from "../actions.ts";
import type { CombatContext } from "../context.ts";
import type { HitState } from "../hit-state.ts";
import type { CombatUnit } from "../unit.ts";
import { loseOneStack } from "./decay.ts";
import type { StatusModule } from "./types.ts";

/**
 * Thorns X (buff): each time the owner is attacked, the attacker takes X damage, even if the
 * attack is deflected. The damage is untyped and not an attack: Shield first, no modifiers,
 * and it runs no hooks, so it triggers no Thorns, Warded, Leeching or Bleeding.
 */
function onAttacked(hit: HitState, owner: CombatUnit, stacks: number, ctx: CombatContext): void {
  const attacker = hit.attacker;
  const out = hit.scratch;
  applyDamage(attacker, stacks, false, out);
  ctx.events.push({ type: "ThornsDamage", source: owner.id, target: attacker.id, shieldDamage: out.shield, hpDamage: out.hp });
  reportDamage(ctx, attacker, out);
}

export const thorns: StatusModule = {
  def: { id: "thorns", kind: "buff", decay: "ticking", resistedBy: [], priority: 0, tags: [] },
  hooks: { onAttacked, onTurnEnd: loseOneStack },
};
