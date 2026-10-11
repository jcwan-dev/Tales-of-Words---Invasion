import type { StatusModule } from "./types.ts";

/** Poisoned: like Burning, but straight to HP. No hit hooks; its hooks arrive with the turn pipeline. */
export const poisoned: StatusModule = {
  def: { id: "poisoned", kind: "debuff", decay: "ticking", resistedBy: ["vitality"] },
  hooks: {},
};
