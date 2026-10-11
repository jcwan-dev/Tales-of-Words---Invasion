/**
 * Performance benchmark (spec: Performance rules; task M1.5).
 *
 * - Workload: 10,000 seeded fights through the public API (cards, moves, one action per turn), each
 *   starting with 50+ stacks over many statuses, plus powers, converts, slow decay and decay floors,
 *   multi-hit cards and consumes; capped at 30 rounds.
 * - Micro-measures: µs per hit (10 statuses on each side) and per full round (player + enemy responses).
 * - Machine normalisation: ratio = workload time / a fixed pure-JS calibration loop; one warm-up pass,
 *   then 5 measured passes, median ratio.
 * - Workload hash: FNV-1a over every fight's event log (computed in the warm-up pass, untimed).
 *
 * Usage: pnpm --filter @tow/sim bench [-- --check | --record [--force]] [--fights N]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import {
  beginCombat,
  createCombatContext,
  createRng,
  createUnit,
  endTurn,
  enemyAct,
  passTurn,
  playCard,
  resolveHit,
  startTurn,
  type CardSpec,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type EnemyMove,
  type Rng,
  type StatusId,
  type UnitInit,
} from "@tow/core";
import { annotation, compareToBaseline, parseBaseline, recordRun, type BaselineFile, type BenchResult } from "./bench-compare.ts";

const BASELINE_FILE = fileURLToPath(new URL("../bench-baseline.json", import.meta.url));
const SEED = "bench-v1";
const MAX_ROUNDS = 30;
const PASSES = 5;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const FIGHTS = Number(arg("fights") ?? "10000");

// ---------------------------------------------------------------------------------------------
// Cards and moves (data, as content would give them)

const PLAYER_CARDS: readonly CardSpec[] = [
  // Twin-knives Strike: 2 hits.
  { id: "strike", cooldown: 0, effects: [{ type: "damage", damageType: "physical", amount: 3, target: "enemy", hits: 2, scaling: [{ stat: "agility", per: 2 }] }] },
  // Dirty Trick: a riding status.
  {
    id: "dirty_trick",
    cooldown: 1,
    effects: [
      { type: "damage", damageType: "physical", amount: 3, target: "enemy", scaling: [{ stat: "cunning", per: 2 }] },
      { type: "status", status: "enfeebled", stacks: 2, target: "enemy" },
    ],
  },
  // Fester: Afflictions and stack scaling, on all enemies.
  { id: "fester", cooldown: 2, effects: [{ type: "damage", damageType: "arcane", amount: 0, target: "allEnemies", scaling: [{ afflictions: true, per: 3 }, { stacksOfTag: "dot", per: 1 }] }] },
  // Combustion: a capped consume, then self Shield.
  {
    id: "combustion",
    cooldown: 3,
    effects: [
      { type: "consume", status: "burning", multiplier: 2, damageType: "arcane", target: "enemy", max: 10 },
      { type: "restoreShield", amount: 4, target: "self", scaling: [{ stat: "wisdom", per: 1 }] },
    ],
  },
  // Miasma: direct statuses on all enemies, heal on self.
  {
    id: "miasma",
    cooldown: 2,
    effects: [
      { type: "status", status: "poisoned", stacks: 3, target: "allEnemies" },
      { type: "status", status: "stunned", stacks: 3, target: "allEnemies", chance: 0.5 },
      { type: "heal", amount: 4, target: "self" },
    ],
  },
];

const ENEMY_MOVES: readonly EnemyMove[] = [
  { card: { id: "bite", cooldown: 0, effects: [{ type: "damage", damageType: "physical", amount: 6, target: "enemy", scaling: [{ stat: "might", per: 1 }] }] }, weight: 3 },
  {
    card: {
      id: "rake",
      cooldown: 1,
      effects: [
        { type: "damage", damageType: "physical", amount: 3, target: "enemy", hits: 3 },
        { type: "status", status: "bleeding", stacks: 1, target: "enemy" },
      ],
    },
    weight: 2,
  },
  { card: { id: "hex", cooldown: 2, effects: [{ type: "status", status: "dimmed", stacks: 2, target: "enemy" }, { type: "status", status: "warded", stacks: 1, target: "self" }] }, weight: 1 },
  { card: { id: "ember", cooldown: 1, effects: [{ type: "damage", damageType: "arcane", amount: 5, target: "enemy", piercing: true }] }, weight: 1 },
];

// ---------------------------------------------------------------------------------------------
// Workload: seeded fight plans

const PLAYER_STATUSES: readonly StatusId[] = ["emboldened", "kindled", "thorns", "leeching", "warded", "piercing", "burning", "poisoned"];
const ENEMY_STATUSES: readonly StatusId[] = ["burning", "bleeding", "poisoned", "enfeebled", "dimmed", "stunned", "paralysed", "thorns", "warded", "emboldened"];

function stacksOf(rng: Rng, ids: readonly StatusId[], min: number, max: number): Partial<Record<StatusId, number>> {
  const out: Partial<Record<StatusId, number>> = {};
  for (const id of ids) out[id] = rng.int(min, max);
  return out;
}

function planFight(i: number): UnitInit[] {
  const rng = createRng(`${SEED}/plan/${i}`);
  const player: UnitInit = {
    id: "p",
    side: "player",
    maxHp: rng.int(220, 300),
    maxShield: rng.int(5, 15),
    stats: { might: rng.int(2, 5), agility: rng.int(2, 5), cunning: rng.int(2, 5), arcana: rng.int(2, 5), vitality: rng.int(2, 5), wisdom: rng.int(2, 5) },
    // 8 statuses x 2-5 stacks.
    statuses: stacksOf(rng, PLAYER_STATUSES, 2, 5),
    bleedPower: rng.int(0, 2),
    burnPower: rng.int(0, 3),
    poisonPower: rng.int(0, 2),
    stunPower: rng.int(0, 4),
    paralysisPower: rng.int(0, 2),
    cards: PLAYER_CARDS,
    traits: {
      converts: [
        { on: "deflect", gain: "thorns", stacks: 1 },
        { on: "tookDamage", gain: "emboldened", stacks: 1 },
      ],
      slowDecay: [{ statuses: { tag: "dot" }, whose: "enemies" }],
      decayFloors: { leeching: 1 },
    },
  };
  const units: UnitInit[] = [player];
  const enemies = rng.int(1, 3);
  for (let k = 0; k < enemies; k++) {
    units.push({
      id: `e${k + 1}`,
      side: "enemy",
      maxHp: rng.int(130, 200),
      maxShield: rng.int(0, 10),
      stats: { might: rng.int(2, 4), vitality: rng.int(2, 4), wisdom: rng.int(2, 4), agility: rng.int(1, 4) },
      // 10 statuses x 3-6 stacks (meters below 10, so turns are mostly played).
      statuses: stacksOf(rng, ENEMY_STATUSES, 3, 6),
      bleedPower: rng.int(0, 1),
      stunPower: rng.int(0, 2),
      moves: ENEMY_MOVES,
      traits: { converts: [{ on: "attacked", gain: "kindled", stacks: 1 }], decayFloors: { burning: 1 } },
    });
  }
  return units;
}

const PLANS: readonly UnitInit[][] = Array.from({ length: FIGHTS }, (_, i) => planFight(i));

/** Plays one fight to its end or the round cap; the player's choices come from a seeded driver RNG. */
function playFight(i: number): CombatEvent[] {
  const units: CombatUnit[] = (PLANS[i] ?? []).map(createUnit);
  const ctx = createCombatContext(`${SEED}/fight/${i}`);
  const state = beginCombat(ctx, units);
  const driver = createRng(`${SEED}/driver/${i}`);
  while (!state.over && state.round <= MAX_ROUNDS) takeTurn(state, driver);
  return ctx.events;
}

function takeTurn(state: CombatState, driver: Rng): void {
  const unit = state.active;
  if (unit === null) return;
  if (!startTurn(state)) {
    if (state.active === unit && !state.over) endTurn(state);
    return;
  }
  if (unit.side === "enemy") {
    enemyAct(state);
    return;
  }
  // Player: a ready card picked by the driver (Strike is always ready), aimed at a living enemy.
  let target: string | undefined;
  for (const u of state.units) {
    if (u.side !== unit.side && !u.fallen) {
      target = u.id;
      if (driver.chance(0.5)) break;
    }
  }
  const start = driver.int(0, unit.cards.length - 1);
  for (let k = 0; k < unit.cards.length; k++) {
    const card = unit.cards[(start + k) % unit.cards.length];
    if (card !== undefined && unit.cooldowns.ready(card.id) && playCard(state, card.id, target).ok) return;
  }
  passTurn(state);
}

// ---------------------------------------------------------------------------------------------
// Hashing (untimed)

function fnv1a(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Events repeat a small set of strings (types, unit ids, statuses), so their hashes are cached.
const stringHashes = new Map<string, number>();
function hashString(text: string): number {
  let h = stringHashes.get(text);
  if (h === undefined) {
    h = fnv1a(2166136261, text);
    stringHashes.set(text, h);
  }
  return h;
}

const mix = (h: number, v: number): number => Math.imul(h ^ v, 16777619) >>> 0;

/**
 * Order-sensitive hash of one event: every field name and value (numbers, strings, booleans, null, and
 * arrays of plain values). Nested object fields are not hashed; no event has one today. If one is added,
 * hash it here, or a rules change inside it won't show in the workload hash.
 */
function hashEvent(hash: number, e: CombatEvent): number {
  let h = hash;
  const fields = e as unknown as Readonly<Record<string, unknown>>;
  for (const key in fields) {
    const value = fields[key];
    h = mix(h, hashString(key));
    if (typeof value === "number") h = mix(mix(h, value | 0), Math.round((value % 1) * 1e6));
    else if (typeof value === "string") h = mix(h, hashString(value));
    else if (typeof value === "boolean") h = mix(h, value ? 0x9e3779b9 : 0x7f4a7c15);
    else if (value === null) h = mix(h, 0x85ebca6b);
    else if (Array.isArray(value)) for (const item of value) h = mix(h, hashString(String(item)));
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// Calibration: fixed pure-JS work (integer maths, small objects, array access), close in kind to the rules.

function calibrate(): number {
  // Like the workload: short-lived small objects pushed to logs that are dropped (GC pressure),
  // integer maths and property reads. Fixed size, about a seventh of the workload's time (ratio about 7).
  const started = performance.now();
  let acc = 0;
  for (let round = 0; round < 20_000; round++) {
    const log: { type: number; unit: string; amount: number }[] = [];
    for (let i = 0; i < 400; i++) {
      acc = (Math.imul(acc ^ i, 2654435761) + (acc >>> 7)) | 0;
      log.push({ type: acc & 15, unit: (i & 1) === 0 ? "p" : "e", amount: acc & 1023 });
      const prev = log[i >> 1];
      if (prev !== undefined) acc = (acc + prev.amount) | 0;
    }
    for (let k = 0; k < 40; k++) acc = (Math.imul(acc, 31) + (log[(k * 7) % log.length]?.type ?? 0)) | 0;
  }
  if (acc === 42) console.log(""); // keep the loop observable
  return performance.now() - started;
}

function workload(hashIt: boolean): { ms: number; hash: number; events: number } {
  let hash = 2166136261;
  let events = 0;
  const started = performance.now();
  for (let i = 0; i < FIGHTS; i++) {
    const ev = playFight(i);
    events += ev.length;
    if (hashIt) for (const e of ev) hash = hashEvent(hash, e);
  }
  return { ms: performance.now() - started, hash, events };
}

// ---------------------------------------------------------------------------------------------
// Micro-measures

const TEN: Partial<Record<StatusId, number>> = {
  burning: 5,
  bleeding: 5,
  poisoned: 5,
  enfeebled: 3,
  dimmed: 3,
  emboldened: 4,
  kindled: 4,
  thorns: 2,
  leeching: 3,
  stunned: 5,
};

function perHitUs(): number {
  const ctx = createCombatContext(`${SEED}/hit`);
  const a = createUnit({ id: "a", side: "player", maxHp: 1_000_000_000, statuses: TEN, bleedPower: 1, stunPower: 1 });
  const t = createUnit({ id: "t", side: "enemy", maxHp: 1_000_000_000, maxShield: 1_000_000, statuses: TEN });
  const hit = { damageType: "physical" as const, amount: 6, scaling: [{ stat: "might" as const, per: 2 }], statuses: [{ status: "burning" as const, stacks: 1 }] };
  const n = 100_000;
  for (let i = 0; i < 10_000; i++) resolveHit(ctx, a, t, hit); // warm-up
  ctx.events.length = 0;
  const started = performance.now();
  for (let i = 0; i < n; i++) {
    resolveHit(ctx, a, t, hit);
    if (ctx.events.length > 10_000) ctx.events.length = 0;
  }
  return ((performance.now() - started) * 1000) / n;
}

function perRoundUs(): number {
  let totalMs = 0;
  let rounds = 0;
  for (let f = 0; f < 200; f++) {
    const plan = planFight(1_000_000 + f).map((u) => ({ ...u, maxHp: 100_000 }));
    const ctx = createCombatContext(`${SEED}/round/${f}`);
    const state = beginCombat(ctx, plan.map(createUnit));
    const driver = createRng(`${SEED}/round-driver/${f}`);
    for (let r = 0; r < 20 && !state.over; r++) {
      const round = state.round;
      const started = performance.now();
      while (!state.over && state.round === round) takeTurn(state, driver);
      totalMs += performance.now() - started;
      rounds++;
    }
  }
  return (totalMs * 1000) / rounds;
}

// ---------------------------------------------------------------------------------------------

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const warm = workload(true);
const ratios: number[] = [];
const times: number[] = [];
const calibrations: number[] = [];
calibrate(); // warm the calibration loop too
for (let p = 0; p < PASSES; p++) {
  // Calibration right before and right after each pass, averaged, so drift during the pass cancels out.
  const before = calibrate();
  const w = workload(false);
  const c = (before + calibrate()) / 2;
  calibrations.push(c);
  times.push(w.ms);
  ratios.push(w.ms / c);
}

const totalMs = median(times);
const result: BenchResult = {
  fights: FIGHTS,
  totalMs: Math.round(totalMs),
  perFightUs: round3((totalMs * 1000) / FIGHTS),
  perHitUs: round3(perHitUs()),
  perRoundUs: round3(perRoundUs()),
  calibrationMs: Math.round(median(calibrations)),
  ratio: round3(median(ratios)),
  workloadHash: warm.hash.toString(16).padStart(8, "0"),
  node: process.version,
  cpu: (cpus()[0]?.model ?? "unknown").trim().replace(/\s+/g, " "),
  cores: cpus().length,
};
console.log(JSON.stringify({ ...result, events: warm.events }));

/** The baseline file, or null when there is none; an unreadable or old-format file is an error. */
function readBaseline(): BaselineFile | null {
  if (!existsSync(BASELINE_FILE)) return null;
  return parseBaseline(JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as unknown);
}

if (process.argv.includes("--record")) {
  // Adds or replaces the entry for this CPU; entries for other CPUs are kept. A file that can't be read is
  // not overwritten unless --force is given (it may hold CI baselines for other CPUs).
  let current: BaselineFile | null = null;
  let readable = true;
  try {
    current = readBaseline();
  } catch (e) {
    readable = false;
    const why = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--force")) {
      console.log(annotation({ level: "notice", text: `--force: replacing the unreadable baseline file (${why})` }, result));
    } else {
      console.log(annotation({ level: "error", text: `not recording: ${why}. Fix the file, or pass --force to start a new one` }, result));
      process.exitCode = 1;
    }
  }
  if (readable || process.argv.includes("--force")) {
    const file = recordRun(current, result, PASSES, `${process.env["GITHUB_SHA"] ?? "local"} ${process.version} ${process.platform}`);
    writeFileSync(BASELINE_FILE, `${JSON.stringify(file, null, 2)}\n`);
    console.log(annotation({ level: "notice", text: `baseline recorded for this CPU in tools/sim/bench-baseline.json` }, result));
  }
}

if (process.argv.includes("--check")) {
  try {
    const verdict = compareToBaseline(result, readBaseline());
    for (const m of verdict.messages) console.log(annotation(m, result));
    if (!verdict.ok) process.exitCode = 1;
  } catch (e) {
    console.log(annotation({ level: "error", text: e instanceof Error ? e.message : String(e) }, result));
    process.exitCode = 1;
  }
}
