/** The power attributes of a unit (spec: Powers). Field names match `UnitInit` and `CombatUnit`. */
export const POWER_IDS = ["bleedPower", "burnPower", "poisonPower", "stunPower", "paralysisPower"] as const;
export type PowerId = (typeof POWER_IDS)[number];
