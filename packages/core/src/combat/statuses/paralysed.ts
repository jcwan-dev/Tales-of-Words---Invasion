import type { StatusModule } from "./types.ts";

/** Paralysed: 50% chance to skip each turn while it lasts (stacks are turns). No hit hooks; its hooks arrive with the action gate. */
export const paralysed: StatusModule = {
  def: { id: "paralysed", kind: "debuff", decay: "timed", resistedBy: ["wisdom"] },
  hooks: {},
};
