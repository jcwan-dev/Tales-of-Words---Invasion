import type { StatusModule } from "./types.ts";

/** Ambushed: skip the first turn of combat (stacks are turns). No hit hooks; its hooks arrive with the action gate. */
export const ambushed: StatusModule = {
  def: { id: "ambushed", kind: "debuff", decay: "timed", resistedBy: ["agility", "cunning"] },
  hooks: {},
};
