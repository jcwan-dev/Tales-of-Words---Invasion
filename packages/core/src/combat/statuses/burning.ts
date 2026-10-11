import type { StatusModule } from "./types.ts";

/** Burning: at turn start, take damage equal to stacks (Shield first), then lose 1 stack. No hit hooks; its hooks arrive with the turn pipeline. */
export const burning: StatusModule = {
  def: { id: "burning", kind: "debuff", decay: "ticking", resistedBy: ["arcana"] },
  hooks: {},
};
