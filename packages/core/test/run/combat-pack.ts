// Test content for the combat node tests (not a test file itself).
// Spec Draft 1.10, "Combat node"; brief M2.3. Enemies and groups with simple numbers, acts with groups and tier
// bands, and a registry with the real combat node module next to fake event and merchant types (run-pack.ts).
import {
  chooseOption,
  combatNodeType,
  completeNode,
  fightOutcome,
  fightPass,
  fightPlay,
  startFight,
  startRun,
  type CombatUnit,
  type ContentFile,
  type FightSession,
  type JsonValue,
  type LoadoutPicks,
  type RunContext,
  type RunState,
} from "../../src/index.ts";
import { picks } from "./loadout-pack.ts";
import { actFile, makeRegistry, ok, runPack, type BuildCall } from "./run-pack.ts";

type Obj = Record<string, unknown>;

const file = (data: Obj): ContentFile => ({ path: `${String(data["id"])}.json`, data });

/** A move: weight 1, cooldown 0, `damage` physical damage on the player, intent `<enemy>.<id>.intent`. */
export const move = (enemy: string, id: string, damage: number, over: Obj = {}): Obj => ({
  id,
  weight: 1,
  cooldown: 0,
  effects: [{ type: "damage", damageType: "physical", amount: damage, target: "enemy" }],
  intent: `${enemy}.${id}.intent`,
  ...over,
});

/** An enemy file. Defaults: 10 HP, one move "hit" for 1 damage. `over` replaces whole fields. */
export function enemyFile(id: string, over: Obj = {}): ContentFile {
  return file({ kind: "enemy", id, name: `${id}.name`, hp: 10, moves: [move(id, "hit", 1)], ...over });
}

/** A group file: text `<id>.text`. */
export function groupFile(id: string, tier: string, enemies: readonly string[], over: Obj = {}): ContentFile {
  return file({ kind: "group", id, name: `${id}.name`, tier, enemies, text: `${id}.text`, ...over });
}

// ---------------------------------------------------------------------------------------------
// Enemies

/** 12 HP, no Shield, all stats 2; "poke": 3 physical damage. The player (Strike 5) beats it in 3 turns. */
export const DUMMY = enemyFile("enemy.dummy", { hp: 12, moves: [move("enemy.dummy", "poke", 3)] });

/** 200 HP; "smash": 30 physical damage carrying Enfeebled 3. Starts with Kindled 5. Two smashes fell the test player. */
export const BRUTE = enemyFile("enemy.brute", {
  hp: 200,
  statuses: { kindled: 5 },
  moves: [
    move("enemy.brute", "smash", 30, {
      effects: [
        { type: "damage", damageType: "physical", amount: 30, target: "enemy" },
        { type: "status", status: "enfeebled", stacks: 3, target: "enemy" },
      ],
    }),
  ],
});

/** Agility 6 (faster than the player), 30 HP; "jab": 2 damage. */
export const SWIFT = enemyFile("enemy.swift", { stats: { agility: 6 }, hp: 30, moves: [move("enemy.swift", "jab", 2)] });

/** Every optional field: stats, Shield, powers, traits, starting statuses, two moves with different weights and cooldowns. */
export const RICH = enemyFile("enemy.rich", {
  stats: { might: 4, agility: 1, wisdom: 5 },
  hp: 25,
  shield: 6,
  powers: { bleedPower: 1, stunPower: 2 },
  traits: { decayFloors: { thorns: 1 } },
  statuses: { thorns: 2, warded: 1 },
  moves: [
    move("enemy.rich", "bite", 2, {
      weight: 3,
      effects: [{ type: "damage", damageType: "physical", amount: 2, target: "enemy", scaling: [{ stat: "might", per: 1 }] }],
    }),
    move("enemy.rich", "guard", 0, { weight: 1, cooldown: 2, effects: [{ type: "restoreShield", amount: 4, target: "self" }] }),
  ],
});

/** 3 HP and Thorns 100: the player's Strike kills it while its Thorns kills the player (the same hit). */
export const SPIKY = enemyFile("enemy.spiky", { hp: 3, statuses: { thorns: 100 }, moves: [move("enemy.spiky", "prick", 1)] });

export const ENEMY_FILES: readonly ContentFile[] = [DUMMY, BRUTE, SWIFT, RICH, SPIKY];

// ---------------------------------------------------------------------------------------------
// Groups

export const GROUP_FILES: readonly ContentFile[] = [
  groupFile("group.n1", "normal", ["enemy.dummy"]),
  groupFile("group.n2", "normal", ["enemy.dummy"]),
  groupFile("group.n3", "normal", ["enemy.dummy"]),
  groupFile("group.h1", "hard", ["enemy.dummy"]),
  groupFile("group.h2", "hard", ["enemy.dummy", "enemy.dummy"]),
  groupFile("group.e1", "elite", ["enemy.dummy"]),
  /** The default boss of actFile (run-pack's BOSS ref). */
  groupFile("group.boss", "boss", ["enemy.brute"]),
  groupFile("group.dummy", "normal", ["enemy.dummy"]),
  groupFile("group.brute", "normal", ["enemy.brute"]),
  groupFile("group.swift", "normal", ["enemy.swift"]),
  groupFile("group.spiky", "normal", ["enemy.spiky"]),
  /** Three enemies with a repeat; nobody is faster than the player (max enemy Agility 2 = the player's 2). */
  groupFile("group.trio", "hard", ["enemy.rich", "enemy.dummy", "enemy.rich"]),
  /** Two weak enemies, for multi-target commands. */
  groupFile("group.pair", "normal", ["enemy.dummy", "enemy.dummy"]),
];

export const COMBAT_FILES: readonly ContentFile[] = [...ENEMY_FILES, ...GROUP_FILES];

// ---------------------------------------------------------------------------------------------
// Acts

/**
 * An act for the combat tests: first, steps 3–3, weights { combat: 1 } (every drawn option is a combat),
 * groups n1/n2/n3, one band { from 1, normal 1 }, only the boss fixed. `over` replaces whole fields.
 */
export function combatAct(id = "act.c", over: Obj = {}): ContentFile {
  return actFile(id, {
    first: true,
    weights: { combat: 1 },
    groups: ["group.n1", "group.n2", "group.n3"],
    tiers: [{ from: 1, weights: { normal: 1 } }],
    ...over,
  });
}

/** An act whose step 1 is a fixed combat node against `group` (steps 3–3, filler event steps, the boss last). */
export const fightAct = (group: string, over: Obj = {}): ContentFile =>
  combatAct("act.fight", { weights: { event: 1 }, fixed: [{ at: 1, type: "combat", ref: group }, { at: "last", type: "combat", ref: "group.boss" }], ...over });

// ---------------------------------------------------------------------------------------------
// Context, picks, runs

/** A registry with the real combat module and fake event and merchant types (run-pack.ts). */
export function combatRegistry(): { registry: RunContext["registry"]; calls: BuildCall[] } {
  const { registry, calls } = makeRegistry({ without: ["combat"] });
  registry.register(combatNodeType);
  return { registry, calls };
}

/** A run context over the loadout test content, the combat content and `acts`. */
export function combatCtx(acts: readonly ContentFile[] = [combatAct()]): RunContext {
  return { pack: runPack([...COMBAT_FILES, ...acts]), registry: combatRegistry().registry };
}

/**
 * The fight tests' player: Brute (Might 3, Vitality 3, Agility 2), Club (Strike = 2 + Might = 5 physical),
 * plain armor, Locket (+8 HP, +1 Shield), the ruled path; technique skill.t_might_a (cooldown 1, 1 + Might).
 * Max HP 20 + 15 + 8 = 43, Shield 1. Cards: ["weapon.club", "skill.t_might_a"].
 */
export const FIGHT_PICKS: LoadoutPicks = picks({ accessory: "accessory.locket", path: "path.ruled" });
export const STRIKE = "weapon.club";
export const TECHNIQUE = "skill.t_might_a";

export function startCombatRun(ctx: RunContext, seed = "seed"): RunState {
  return startRun(ctx, { seed, picks: FIGHT_PICKS, technique: TECHNIQUE }).run;
}

/** A run in phase "inNode" at step 1, in a fixed combat node against `group`. */
export function runInFight(group: string, seed = "seed"): { ctx: RunContext; run: RunState } {
  const ctx = combatCtx([fightAct(group)]);
  const run = startCombatRun(ctx, seed);
  ok(chooseOption(ctx, run, 0));
  return { ctx, run };
}

/** A run in a fight against `group`, with the fight started. */
export function fightAgainst(group: string, seed = "seed"): { ctx: RunContext; run: RunState; session: FightSession } {
  const { ctx, run } = runInFight(group, seed);
  return { ctx, run, session: startFight(ctx, run) };
}

/** Moves the run on (option 0, empty result) until it reaches `step` in phase "choosing". */
export function advanceTo(ctx: RunContext, run: RunState, step: number): void {
  while (run.step < step) {
    ok(chooseOption(ctx, run, 0));
    ok(completeNode(ctx, run, {}));
  }
}

// ---------------------------------------------------------------------------------------------
// Reading a fight

export interface CombatData {
  readonly group: string;
  readonly tier: string;
}

export const combatData = (o: { readonly data: JsonValue }): CombatData => o.data as unknown as CombatData;

export function unitOf(session: FightSession, id: string): CombatUnit {
  const u = session.state.units.find((x) => x.id === id);
  if (u === undefined) throw new Error(`no unit "${id}" in the fight`);
  return u;
}

export const playerOf = (session: FightSession): CombatUnit => unitOf(session, "player");
export const enemiesOf = (session: FightSession): CombatUnit[] => session.state.units.filter((u) => u.side === "enemy");

/** Combat events as loose records, for searching. */
export type Ev = { readonly type: string } & Record<string, unknown>;
export const eventsOf = (session: FightSession): Ev[] => session.state.ctx.events as unknown as Ev[];

/** What a refused command must leave alone: the event count, whose turn, every unit's HP, Shield and intent. */
export function fightSnapshot(session: FightSession): string {
  const s = session.state;
  return JSON.stringify({
    events: s.ctx.events.length,
    active: s.active?.id ?? null,
    round: s.round,
    over: s.over,
    units: s.units.map((u) => ({ id: u.id, hp: u.hp, shield: u.shield, intent: u.intent })),
  });
}

/**
 * Plays Strike every turn (pass when Strike is refused) until the fight is over or `maxTurns` player actions.
 * Returns the number of player actions taken.
 */
export function strikeUntilOver(session: FightSession, strike: string, maxTurns = 500): number {
  let n = 0;
  for (; n < maxTurns && fightOutcome(session) === "ongoing"; n++) {
    const target = enemiesOf(session).find((u) => !u.fallen)?.id;
    const res = fightPlay(session, strike, target);
    if (!res.ok) {
      const passed = fightPass(session);
      if (!passed.ok) throw new Error(`neither Strike nor pass was accepted: ${passed.reason}`);
    }
  }
  return n;
}
