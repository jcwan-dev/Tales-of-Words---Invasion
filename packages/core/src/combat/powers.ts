import type { StatusId } from "../content/types.ts";
import type { PowerId } from "./power-ids.ts";
import { bleeding } from "./statuses/bleeding.ts";
import { burning } from "./statuses/burning.ts";
import { paralysed } from "./statuses/paralysed.ts";
import { poisoned } from "./statuses/poisoned.ts";
import { stunned } from "./statuses/stunned.ts";

/**
 * A power as data (spec: Powers): which status it adds, when, and whether it drops during a fight.
 * - `perHit`: at hit step 7 of every landed hit, after the hit's statuses.
 * - `perAttack`: once after an attack's last hit, if a hit landed and neither unit has fallen.
 * `decays`: −1 at the end of each of the owner's turns (minimum 0), back to full at fight start.
 */
export interface PowerDef {
  readonly power: PowerId;
  readonly status: StatusId;
  readonly timing: "perHit" | "perAttack";
  readonly decays: boolean;
}

/** In application order inside each timing: Bleed, then Stun per hit; Burn, Poison, then Paralysis per attack. */
export const POWERS: readonly PowerDef[] = [
  { power: "bleedPower", status: bleeding.def.id, timing: "perHit", decays: false },
  { power: "stunPower", status: stunned.def.id, timing: "perHit", decays: true },
  { power: "burnPower", status: burning.def.id, timing: "perAttack", decays: false },
  { power: "poisonPower", status: poisoned.def.id, timing: "perAttack", decays: false },
  { power: "paralysisPower", status: paralysed.def.id, timing: "perAttack", decays: false },
];

export const PER_HIT_POWERS: readonly PowerDef[] = POWERS.filter((p) => p.timing === "perHit");
export const PER_ATTACK_POWERS: readonly PowerDef[] = POWERS.filter((p) => p.timing === "perAttack");
export const DECAYING_POWERS: readonly PowerDef[] = POWERS.filter((p) => p.decays);
