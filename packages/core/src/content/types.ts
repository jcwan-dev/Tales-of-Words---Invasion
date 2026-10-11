import type { StatId } from "../model/stats.ts";

/** Status ids from the spec's status list. New statuses are added here and as modules (M1). */
export const STATUS_IDS = [
  "burning",
  "poisoned",
  "bleeding",
  "stunned",
  "paralysed",
  "ambushed",
  "enfeebled",
  "dimmed",
  "emboldened",
  "kindled",
  "warded",
  "thorns",
  "leeching",
  "piercing",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export type DamageType = "physical" | "arcane";
export type Target = "self" | "enemy";

/** Status tags: cross-status queries go through these, never through ids (spec: Combat core design). */
export const STATUS_TAGS = ["dot"] as const;
export type StatusTag = (typeof STATUS_TAGS)[number];

/**
 * One scaling term of an amount (spec: How stats, items and skills combine; Synergy effects).
 * - `{ stat, per }`: + per × the attacker's stat.
 * - `{ afflictions: true, per }`: + per × the target's Afflictions (different DoTs present, 0-3).
 * - `{ stacksOfTag, per }`: + per × the target's stacks of statuses with that tag.
 * Target terms read the target when the hit starts.
 */
export type Scaling =
  | { readonly stat: StatId; readonly per: number }
  | { readonly afflictions: true; readonly per: number }
  | { readonly stacksOfTag: StatusTag; readonly per: number };

export type Effect =
  | { readonly type: "damage"; readonly damageType: DamageType; readonly amount: number; readonly target: Target; readonly scaling?: readonly Scaling[]; readonly piercing?: boolean }
  | { readonly type: "heal"; readonly amount: number; readonly target: Target; readonly scaling?: readonly Scaling[] }
  | { readonly type: "restoreShield"; readonly amount: number; readonly target: Target; readonly scaling?: readonly Scaling[] }
  | { readonly type: "status"; readonly status: StatusId; readonly stacks: number; readonly target: Target; readonly chance?: number }
  /** A consume (spec: Synergy effects): one typed hit for stacks × multiplier; `max` caps the stacks taken. */
  | {
      readonly type: "consume";
      readonly status: StatusId;
      readonly multiplier: number;
      readonly damageType: DamageType;
      readonly target: Target;
      readonly max?: number;
    };

export type StatBonus = Readonly<Partial<Record<StatId, number>>>;

interface Base {
  readonly id: string;
  /** Localisation key for the display name. */
  readonly name: string;
}

export interface CharacterDef extends Base {
  readonly kind: "character";
  readonly favoured: readonly StatId[];
  readonly eventTags: readonly string[];
}

interface ItemBase extends Base {
  readonly stats?: StatBonus;
  readonly hp?: number;
  readonly shield?: number;
}

export interface WeaponDef extends ItemBase {
  readonly kind: "weapon";
  /** Strike: the basic attack. Free, no cooldown (spec: Skills). */
  readonly attack: { readonly damage: number; readonly damageType: DamageType; readonly scaling: readonly Scaling[] };
}

export interface ArmorDef extends ItemBase {
  readonly kind: "armor";
}

export interface AccessoryDef extends ItemBase {
  readonly kind: "accessory";
  /** Id of a skill or Word the accessory grants. */
  readonly grants?: string;
}

export interface PathDef extends Base {
  readonly kind: "path";
  readonly stats?: StatBonus;
  /** Rule tags the narrative layer checks, e.g. "no_dishonest_choices". */
  readonly rules?: readonly string[];
}

export interface SkillDef extends Base {
  readonly kind: "skill";
  readonly cost: number;
  /** Every skill except Strike has a cooldown of at least 1 (spec: Skills). */
  readonly cooldown: number;
  readonly effects: readonly Effect[];
  readonly upgrade?: string;
}

/** A Word is a skill with a glyph, a spoken form and a meaning (spec: Magic: words of power). */
export interface WordDef extends Omit<SkillDef, "kind"> {
  readonly kind: "word";
  readonly glyph: string;
  readonly spoken: string;
  /** Localisation key for the translated meaning. The glyph and spoken form are never translated. */
  readonly meaning: string;
}

export type ContentDef = CharacterDef | WeaponDef | ArmorDef | AccessoryDef | PathDef | SkillDef | WordDef;
export type ContentKind = ContentDef["kind"];

export interface ContentPack {
  readonly id: string;
  readonly byId: ReadonlyMap<string, ContentDef>;
}
