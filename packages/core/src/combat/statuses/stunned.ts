import type { StatusModule } from "./types.ts";

/** Stunned: skip the next turn (stacks are turns). No hit hooks; its hooks arrive with the action gate. */
export const stunned: StatusModule = {
  def: { id: "stunned", kind: "debuff", decay: "timed", resistedBy: ["vitality"] },
  hooks: {},
};
