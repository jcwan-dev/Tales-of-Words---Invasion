// Debug fight page model (task M1.3c): presets, unit building, turn driving and event formatting.
// Pure TypeScript on top of @tow/core only, so it can be checked headless without React.
// Developer tool: the text here is plain English on purpose. Code rule 5 (localisation keys)
// does not apply to this debug page; it is not a game screen.
import {
  beginCombat,
  createCombatContext,
  createUnit,
  endTurn,
  POWER_IDS,
  resolveAttack,
  STAT_IDS,
  startTurn,
  STATUS_IDS,
  type AttackSpec,
  type CombatContext,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type DamageType,
  type HitSpec,
  type PowerId,
  type StatId,
  type StatusId,
} from "@tow/core";

export type SideKey = "player" | "enemy";
export const SIDES: readonly SideKey[] = ["player", "enemy"];

export const MAX_ROUNDS = 50;
export const MAX_HITS = 4;

export interface AttackSetup {
  type: DamageType;
  amount: number;
  hits: number;
  piercing: boolean;
}

export interface UnitSetup {
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  stats: Record<StatId, number>;
  powers: Record<PowerId, number>;
  statuses: Record<StatusId, number>;
  attack: AttackSetup;
}

export type FightSetup = Record<SideKey, UnitSetup>;

// ---------------------------------------------------------------------------------------------
// Presets

export type PresetId = "duel" | "stun" | "rot" | "thorns";

export interface Preset {
  id: PresetId;
  label: string;
  build: () => FightSetup;
}

interface UnitOverrides {
  hp?: number;
  shield?: number;
  stats?: Partial<Record<StatId, number>>;
  powers?: Partial<Record<PowerId, number>>;
  statuses?: Partial<Record<StatusId, number>>;
  attack?: Partial<AttackSetup>;
}

/** A unit with the clarified defaults: stats 2, 50 HP, 0 Shield, no powers or statuses, 1 physical hit. */
export function unitSetup(over: UnitOverrides = {}): UnitSetup {
  const stats = {} as Record<StatId, number>;
  for (const s of STAT_IDS) stats[s] = over.stats?.[s] ?? 2;
  const powers = {} as Record<PowerId, number>;
  for (const p of POWER_IDS) powers[p] = over.powers?.[p] ?? 0;
  const statuses = {} as Record<StatusId, number>;
  for (const s of STATUS_IDS) statuses[s] = over.statuses?.[s] ?? 0;
  const hp = over.hp ?? 50;
  const shield = over.shield ?? 0;
  return {
    hp,
    maxHp: hp,
    shield,
    maxShield: shield,
    stats,
    powers,
    statuses,
    attack: { type: "physical", amount: 1, hits: 1, piercing: false, ...over.attack },
  };
}

export const PRESETS: readonly Preset[] = [
  {
    id: "duel",
    label: "Sellsword vs Hollow Warden",
    build: () => ({
      player: unitSetup({ shield: 8, stats: { might: 4, vitality: 4, agility: 1, wisdom: 3 }, attack: { amount: 12 } }),
      // 9 + 2 x Might 4 = 17
      enemy: unitSetup({ stats: { might: 4 }, attack: { amount: 17 } }),
    }),
  },
  {
    id: "stun",
    label: "Stun build",
    build: () => ({
      player: unitSetup({ powers: { stunPower: 7 }, attack: { amount: 3 } }),
      enemy: unitSetup({ hp: 80, stats: { vitality: 2 }, attack: { amount: 2 } }),
    }),
  },
  {
    id: "rot",
    label: "Triple Rot",
    build: () => ({
      player: unitSetup({ powers: { burnPower: 3, poisonPower: 2, bleedPower: 1 }, attack: { amount: 2, hits: 2 } }),
      enemy: unitSetup({ hp: 60, shield: 10, attack: { amount: 4 } }),
    }),
  },
  {
    id: "thorns",
    label: "Bramble Wall",
    build: () => ({
      player: unitSetup({ statuses: { warded: 2, thorns: 3 }, attack: { amount: 3 } }),
      enemy: unitSetup({ attack: { amount: 6, hits: 2 } }),
    }),
  },
];

export const DEFAULT_PRESET: PresetId = "duel";

export function presetSetup(id: PresetId): FightSetup {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  if (preset === undefined) throw new Error("no presets defined");
  return preset.build();
}

export const isPresetId = (value: string): value is PresetId => PRESETS.some((p) => p.id === value);

// ---------------------------------------------------------------------------------------------
// Fight driving

export interface Fight {
  ctx: CombatContext;
  state: CombatState;
  units: Record<SideKey, CombatUnit>;
  attacks: Record<SideKey, AttackSpec>;
}

/** A whole number >= 0 from an editor value, number or raw text (empty or invalid counts as 0). */
export const toCount = (n: number | string): number => {
  const v = typeof n === "string" ? (n.trim() === "" ? 0 : Number(n)) : n;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};

function buildUnit(side: SideKey, u: UnitSetup): CombatUnit {
  const statuses: Partial<Record<StatusId, number>> = {};
  for (const s of STATUS_IDS) {
    const n = toCount(u.statuses[s]);
    if (n > 0) statuses[s] = n;
  }
  const stats: Partial<Record<StatId, number>> = {};
  for (const s of STAT_IDS) stats[s] = toCount(u.stats[s]);
  return createUnit({
    id: side,
    side,
    stats,
    maxHp: toCount(u.maxHp),
    hp: toCount(u.hp),
    maxShield: toCount(u.maxShield),
    shield: toCount(u.shield),
    statuses,
    bleedPower: toCount(u.powers.bleedPower),
    burnPower: toCount(u.powers.burnPower),
    poisonPower: toCount(u.powers.poisonPower),
    stunPower: toCount(u.powers.stunPower),
    paralysisPower: toCount(u.powers.paralysisPower),
  });
}

function buildAttack(a: AttackSetup): AttackSpec {
  const hit: HitSpec = { damageType: a.type, amount: toCount(a.amount), piercing: a.piercing };
  const count = Math.min(MAX_HITS, Math.max(1, toCount(a.hits)));
  const hits: HitSpec[] = [];
  for (let i = 0; i < count; i++) hits.push(hit);
  return { hits };
}

/** Builds both units from the setup and begins the fight (no turn started yet). */
export function startFight(setup: FightSetup, seed: string): Fight {
  const units: Record<SideKey, CombatUnit> = { player: buildUnit("player", setup.player), enemy: buildUnit("enemy", setup.enemy) };
  const attacks: Record<SideKey, AttackSpec> = { player: buildAttack(setup.player.attack), enemy: buildAttack(setup.enemy.attack) };
  const ctx = createCombatContext(seed);
  const state = beginCombat(ctx, [units.player, units.enemy]);
  return { ctx, state, units, attacks };
}

const sideOf = (unit: CombatUnit): SideKey => (unit.side === "player" ? "player" : "enemy");

/**
 * Plays exactly one unit's turn: startTurn; if the unit may act it attacks the other unit with its
 * configured attack; then endTurn only if the unit is still active (startTurn's contract: a unit that
 * fell at turn start has already ended its turn, and a finished fight has no active unit).
 */
export function nextTurn(f: Fight): void {
  const { state, ctx } = f;
  const unit = state.active;
  if (unit === null || state.over || isCapped(f)) return;
  const side = sideOf(unit);
  const acts = startTurn(state);
  if (acts) resolveAttack(ctx, unit, f.units[side === "player" ? "enemy" : "player"], f.attacks[side]);
  if (state.active === unit) endTurn(state);
}

/** True once MAX_ROUNDS full rounds have been played without an end: no more turns are played. */
export const isCapped = (f: Fight): boolean => !f.state.over && f.state.round > MAX_ROUNDS;

/** Plays turns until the fight is over or MAX_ROUNDS rounds have passed. */
export function runToEnd(f: Fight): void {
  while (!f.state.over && f.state.round <= MAX_ROUNDS) nextTurn(f);
}

// ---------------------------------------------------------------------------------------------
// Display

const capitalise = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** "player" -> "Player", "enemy" -> "Enemy"; "burning" -> "Burning". */
export const nameOf = (id: string): string => capitalise(id);

const POWER_LABEL: Record<PowerId, string> = {
  bleedPower: "Bleed",
  burnPower: "Burn",
  poisonPower: "Poison",
  stunPower: "Stun",
  paralysisPower: "Paralysis",
};
export const powerLabel = (p: PowerId): string => POWER_LABEL[p];

export interface UnitView {
  name: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  fallen: boolean;
  /** Non-zero powers, e.g. "Stun 6/7", "Bleed 1". */
  powers: string[];
  /** Status chips in core status-list order, e.g. "Burning 3". */
  chips: string[];
}

/** A read-only snapshot of a unit for rendering (never mutates core state). */
export function unitView(u: CombatUnit): UnitView {
  const powers: string[] = [];
  for (const p of POWER_IDS) {
    const now = u.powers[p];
    const full = u.fullPowers[p];
    if (now === 0 && full === 0) continue;
    powers.push(now === full && p !== "stunPower" ? `${POWER_LABEL[p]} ${now}` : `${POWER_LABEL[p]} ${now}/${full}`);
  }
  const chips: string[] = [];
  for (const s of STATUS_IDS) {
    const n = u.statuses.stacks(s);
    if (n > 0) chips.push(`${nameOf(s)} ${n}`);
  }
  return { name: nameOf(u.id), hp: u.hp, maxHp: u.maxHp, shield: u.shield, maxShield: u.maxShield, fallen: u.fallen, powers, chips };
}

/** One readable English line per core event. */
export function formatEvent(e: CombatEvent): string {
  switch (e.type) {
    case "CombatStarted":
      return `Fight starts. Turn order: ${e.order.map(nameOf).join(", ")}`;
    case "TurnStarted":
      return `Round ${e.round} · ${nameOf(e.unit)}`;
    case "HitStarted":
      return `${nameOf(e.attacker)} attacks ${nameOf(e.target)} (${e.value} ${e.damageType})`;
    case "ThornsDamage":
      return `Thorns deals ${e.shieldDamage + e.hpDamage} to ${nameOf(e.target)} (${e.shieldDamage} Shield, ${e.hpDamage} HP)`;
    case "HitDeflected":
      return `${nameOf(e.target)} deflects the hit`;
    case "DamageDealt":
      return `${nameOf(e.attacker)} hits ${nameOf(e.target)} for ${e.shieldDamage + e.hpDamage} (${e.shieldDamage} Shield, ${e.hpDamage} HP)${e.piercing ? ", piercing" : ""}`;
    case "ShieldBroken":
      return `${nameOf(e.unit)}'s Shield breaks`;
    case "Healed":
      return `${nameOf(e.unit)} heals ${e.amount}`;
    case "StatusApplied":
      return `${nameOf(e.unit)} gains ${nameOf(e.status)} ${e.stacks} (now ${e.total})`;
    case "StatusResisted":
      return `${nameOf(e.unit)} resists ${e.removed} ${nameOf(e.status)}`;
    case "StatusMissed":
      return `${nameOf(e.status)} misses ${nameOf(e.unit)}`;
    case "ChargeUsed":
      return `${nameOf(e.unit)} uses a ${nameOf(e.status)} charge (${e.left} left)`;
    case "UnitFell":
      return `${nameOf(e.unit)} falls`;
    case "DotDamage":
      return `${nameOf(e.status)} deals ${e.shieldDamage + e.hpDamage} to ${nameOf(e.unit)} (${e.shieldDamage} Shield, ${e.hpDamage} HP)`;
    case "MeterTriggered":
      return `${nameOf(e.unit)}: ${nameOf(e.status)} meter full, ${e.lostTurn ? "turn lost" : "roll saved it"}`;
    case "TurnSkipped":
      return `${nameOf(e.unit)} loses the turn (${nameOf(e.reason)})`;
    case "StatusRemoved":
      return `${nameOf(e.unit)} is no longer ${nameOf(e.status)}`;
    case "TurnEnded":
      return `${nameOf(e.unit)} ends the turn`;
    case "CombatEnded":
      return `Fight over: ${nameOf(e.winner)} wins`;
    case "Consumed":
      return `${nameOf(e.unit)} loses ${e.stacks} ${nameOf(e.status)} (consumed)`;
    case "TriggerFired":
      return `${nameOf(e.unit)}'s ${e.on} trigger: +${e.stacks} ${nameOf(e.gain)} (depth ${e.depth})`;
    case "TriggerCapped":
      return `${nameOf(e.unit)}'s ${e.on} trigger ignored (depth ${e.depth} over the cap)`;
    case "CardPlayed":
      return `${nameOf(e.unit)} uses ${e.card}${e.target === null ? "" : ` on ${nameOf(e.target)}`}`;
    case "Passed":
      return `${nameOf(e.unit)} passes`;
    case "IntentChosen":
      return `${nameOf(e.unit)} intends ${e.move}`;
    case "ShieldRestored":
      return `${nameOf(e.unit)} restores ${e.amount} Shield`;
    default:
      return unknownEvent(e);
  }
}

/** Compile-time check that every event type is formatted; at run time, a generic line. */
function unknownEvent(e: never): string {
  const fields = Object.entries(e as Record<string, unknown>)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  return fields;
}

export interface LogLine {
  type: CombatEvent["type"];
  text: string;
}

export interface LogGroup {
  /** "Round N · Name", or null for events before the first turn. */
  header: string | null;
  lines: LogLine[];
}

/** The event log in order, grouped under turn headers (TurnStarted becomes the header, not a line). */
export function logGroups(events: readonly CombatEvent[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let current: LogGroup = { header: null, lines: [] };
  groups.push(current);
  for (const e of events) {
    if (e.type === "TurnStarted") {
      current = { header: formatEvent(e), lines: [] };
      groups.push(current);
    } else {
      current.lines.push({ type: e.type, text: formatEvent(e) });
    }
  }
  return groups.filter((g) => g.header !== null || g.lines.length > 0);
}
