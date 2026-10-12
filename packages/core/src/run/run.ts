/**
 * The run engine (spec: Run map, "Core loop", "Monetisation architecture"). Commands in, events out.
 *
 * The run state is plain data, mutated in place by the commands, and survives a JSON round trip, so a run can be
 * saved between nodes and when a node is entered. A refused command changes nothing. Node types come from a
 * registry of modules; the engine never looks at a type's id to decide behaviour (code rule 2).
 *
 * Randomness: each decision has its own stream from the run seed, the act's position in the run, the act and the
 * step (and the option's position), so nothing else in the run shifts it and an act visited twice draws afresh.
 *
 * After a node whose result carries a fight tier (spec: Rewards, items and level-ups; ADR 0012): the rewards screen
 * (phase "rewards"), learning when a card arrives with a full hand ("learning"), the level-up after elite and boss
 * fights ("levelUp"), then the usual advance. The draw, learning, item swaps and level-ups live in their own modules.
 */
import { GROUP_TIERS, type ActDef, type ContentPack, type FixedNodeDef, type GroupTier } from "../content/types.ts";
import type { StatBlock, StatId } from "../model/stats.ts";
import type { NodeRegistry } from "../nodes/registry.ts";
import type { JsonValue, NodeType } from "../nodes/types.ts";
import { RngStreams } from "../rng/rng.ts";
import { drawOptionTypes, type WeightedType } from "./draw.ts";
import { consume, initialRunLimits, type Grant, type RunLimitsState } from "./limits.ts";
import { equipItem } from "./items.ts";
import { gainCard, learnInPlaceOf } from "./learning.ts";
import { favouredStats, levelsUp, levelUpOptions, raiseStat } from "./levelup.ts";
import { assemblePlayer, intelligenceBonusOptions, loadoutTotals, type LoadoutPicks } from "./loadout.ts";
import { drawRewards, type ItemSlot, type RewardOption } from "./rewards.ts";

export interface RunContext {
  readonly pack: ContentPack;
  readonly registry: NodeRegistry;
}

/** A built option at the current step. `text` and `tag` are localisation keys; `data` is the module's own. */
export interface NodeOption {
  readonly type: string;
  readonly ref: string | null;
  readonly fixed: boolean;
  readonly text: string;
  readonly tag: string | null;
  readonly data: JsonValue;
}

export type RunPhase = "choosing" | "inNode" | "rewards" | "learning" | "levelUp" | "route" | "fallen" | "won" | "lost";

/** The rewards screen (phase "rewards"). */
export interface RewardScreen {
  /** The tier of the fight it rewards. */
  tier: GroupTier;
  /** Rerolls of this screen so far (0 for its first draw); the run-wide count is in `limits`. */
  rerolls: number;
  options: RewardOption[];
}

export interface RunPlayer {
  hp: number;
  maxHp: number;
  /** Card ids in order (the weapon's Strike has the weapon's id). */
  cards: string[];
  baseStats: StatBlock;
  eventTags: string[];
  rules: string[];
}

export interface RunState {
  seed: string;
  phase: RunPhase;
  picks: LoadoutPicks;
  technique: string | null;
  player: RunPlayer;
  crowns: number;
  /** Story flags: a set, in insertion order, no duplicates. */
  flags: string[];
  limits: RunLimitsState;
  act: string;
  /** The act's position in the run, from 1. */
  actNumber: number;
  /** From 1 to `steps`. */
  step: number;
  /** The step count rolled for this act. */
  steps: number;
  /** The current options (phase "choosing"); [] otherwise. */
  offer: NodeOption[];
  /** The node being played (phase "inNode", kept while "fallen"); null otherwise. */
  node: (NodeOption & { option: number }) | null;
  /** Type of the last node entered (fixed nodes count, across acts). */
  previousType: string | null;
  /** The open routes, as act ids (phase "route"); [] otherwise. */
  routes: string[];
  /**
   * True while the player has fallen in the middle of the current node (fallInNode, phase "fallen"): a revive
   * then goes back into the node instead of moving on (spec: Combat node). False otherwise.
   */
  fellInNode: boolean;
  /**
   * The fight tier of the current node's result (from completeNode until the run moves on; kept through a fall, so a
   * revive opens the same rewards). It drives the rewards screen and the level-up. Null otherwise.
   */
  rewardTier: GroupTier | null;
  /** The rewards screen (phase "rewards"); null otherwise. */
  rewards: RewardScreen | null;
  /** The incoming card (phase "learning"); null otherwise. */
  learning: { card: string } | null;
  /** The level-up offer, favoured stat first (phase "levelUp"); null otherwise. */
  levelUp: { options: StatId[] } | null;
}

/** What a node hands back when it finishes. Integers only. */
export interface NodeResult {
  readonly hp?: number;
  readonly crowns?: number;
  readonly setFlags?: readonly string[];
  readonly clearFlags?: readonly string[];
  /** A won fight's tier: opens the rewards screen (and the level-up for elite and boss). The act needs its table. */
  readonly rewardTier?: GroupTier;
}

export type RunRefusal = "wrong_phase" | "no_such_option" | "no_such_route" | "invalid_result" | "limit_reached" | "wrong_action";

export interface OfferedOption {
  readonly type: string;
  readonly fixed: boolean;
}

export type RunEvent =
  | { readonly type: "RunStarted"; readonly seed: string }
  | { readonly type: "ActStarted"; readonly act: string; readonly actNumber: number; readonly steps: number }
  | { readonly type: "OptionsOffered"; readonly act: string; readonly step: number; readonly options: readonly OfferedOption[] }
  | { readonly type: "NodeEntered"; readonly nodeType: string; readonly ref: string | null; readonly option: number }
  | {
      readonly type: "NodeCompleted";
      readonly nodeType: string;
      /** The change actually applied, after clamping to [0, max HP]. */
      readonly hpChange: number;
      readonly crownsChange: number;
      readonly hp: number;
      readonly crowns: number;
    }
  | { readonly type: "PlayerFell" }
  | { readonly type: "Revived"; readonly hp: number }
  | { readonly type: "ActCompleted"; readonly act: string }
  | { readonly type: "RewardsOffered"; readonly tier: GroupTier; readonly options: readonly RewardOption[]; readonly rerolls: number }
  /** `rerollsUsed` counts the whole run's rerolls (the limit is per run). */
  | { readonly type: "RewardsRerolled"; readonly rerollsUsed: number }
  | { readonly type: "RewardTaken"; readonly option: RewardOption }
  | { readonly type: "RewardSkipped" }
  | { readonly type: "CrownsGained"; readonly amount: number; readonly crowns: number }
  | {
      readonly type: "ItemEquipped";
      readonly slot: ItemSlot;
      readonly item: string;
      /** The item it replaced (lost). */
      readonly previous: string;
      readonly maxHp: number;
      readonly hp: number;
    }
  /** A card leaving with its item. */
  | { readonly type: "CardRemoved"; readonly card: string }
  /** A card arriving with a full hand: the player forgets one or leaves it (phase "learning"). */
  | { readonly type: "CardOffered"; readonly card: string }
  | { readonly type: "CardLearned"; readonly card: string; readonly replaced: string | null }
  | { readonly type: "CardLeft"; readonly card: string }
  | { readonly type: "LevelUpOffered"; readonly options: readonly StatId[] }
  | { readonly type: "StatRaised"; readonly stat: StatId; readonly gain: number; readonly value: number; readonly maxHp: number; readonly hp: number }
  | { readonly type: "RoutesOffered"; readonly routes: readonly string[] }
  | { readonly type: "RunEnded"; readonly result: "won" | "lost" };

export type CommandResult = { readonly ok: true; readonly events: readonly RunEvent[] } | { readonly ok: false; readonly reason: RunRefusal };

const refuse = (reason: RunRefusal): CommandResult => ({ ok: false, reason });
const accept = (events: readonly RunEvent[]): CommandResult => ({ ok: true, events });

// ---------------------------------------------------------------------------------------------
// Lookups

function actDef(pack: ContentPack, id: string): ActDef {
  const def = pack.byId.get(id);
  if (def?.kind !== "act") throw new RangeError(`run: "${id}" is not an act in pack "${pack.id}"`);
  return def;
}

function nodeType(ctx: RunContext, id: string): NodeType {
  const type = ctx.registry.get(id);
  if (type === undefined) throw new RangeError(`run: no node module registered for type "${id}"`);
  return type;
}

/** Every act of the pack, in pack order. */
function actsOf(pack: ContentPack): ActDef[] {
  const acts: ActDef[] = [];
  for (const def of pack.byId.values()) if (def.kind === "act") acts.push(def);
  return acts;
}

/** Every node type named by any act (weights, even at 0, and fixed nodes) must have a module. */
function checkModules(ctx: RunContext, acts: readonly ActDef[]): void {
  for (const act of acts) {
    for (const id of Object.keys(act.weights)) nodeType(ctx, id);
    for (const f of act.fixed) nodeType(ctx, f.type);
  }
}

function fixedAt(act: ActDef, step: number, steps: number): FixedNodeDef | undefined {
  return act.fixed.find((f) => f.at === step || (f.at === "last" && step === steps));
}

const isIndex = (i: number, length: number): boolean => Number.isInteger(i) && i >= 0 && i < length;

// ---------------------------------------------------------------------------------------------
// Steps, options and acts

function buildOption(ctx: RunContext, run: RunState, act: ActDef, type: NodeType, ref: string | null, fixed: boolean, index: number): NodeOption {
  const rng = new RngStreams(run.seed).derive("node", run.actNumber, act.id, run.step, index);
  const built = type.build({ run, act, pack: ctx.pack, fixed, ref, rng });
  return { type: type.id, ref, fixed, text: built.text, tag: built.tag, data: built.data };
}

/** The node types that can be drawn now, with their weights, in the act's order. */
function drawable(ctx: RunContext, run: RunState, act: ActDef): WeightedType[] {
  const out: WeightedType[] = [];
  for (const [id, weight] of Object.entries(act.weights)) {
    if (weight <= 0) continue;
    const type = nodeType(ctx, id);
    if (!type.mayFollowItself && run.previousType === id) continue;
    if (!type.canAppear(run, act, ctx.pack)) continue;
    out.push({ type: id, weight });
  }
  return out;
}

/** Fills `run.offer` for the current step and reports it. Throws Error if no type can be drawn (content bug). */
function offerStep(ctx: RunContext, run: RunState, act: ActDef, events: RunEvent[]): void {
  // Modules see the phase they are offered in, whichever command led here.
  run.phase = "choosing";
  run.offer = [];
  const fixed = fixedAt(act, run.step, run.steps);
  let offer: NodeOption[];
  if (fixed !== undefined) {
    offer = [buildOption(ctx, run, act, nodeType(ctx, fixed.type), fixed.ref ?? null, true, 0)];
  } else {
    const types = drawable(ctx, run, act);
    if (types.length === 0) {
      throw new Error(`run: no node type can be drawn at step ${run.step} of "${act.id}" (previous: ${run.previousType ?? "none"})`);
    }
    const rng = new RngStreams(run.seed).derive("map", run.actNumber, act.id, run.step);
    offer = drawOptionTypes(rng, types).map((id, i) => buildOption(ctx, run, act, nodeType(ctx, id), null, false, i));
  }
  run.offer = offer;
  events.push({ type: "OptionsOffered", act: act.id, step: run.step, options: offer.map((o) => ({ type: o.type, fixed: o.fixed })) });
}

/** Enters `act` at step 1 (actNumber already set) with a newly rolled step count. */
function enterAct(ctx: RunContext, run: RunState, act: ActDef, events: RunEvent[]): void {
  run.act = act.id;
  run.step = 1;
  run.steps = new RngStreams(run.seed).derive("map", run.actNumber, act.id, "steps").int(act.steps.min, act.steps.max);
  events.push({ type: "ActStarted", act: act.id, actNumber: run.actNumber, steps: run.steps });
  offerStep(ctx, run, act, events);
}

/** After a node finishes (or a revive): next step, routes, or victory. */
function advance(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  const act = actDef(ctx.pack, run.act);
  run.node = null;
  run.rewardTier = null;
  run.rewards = null;
  run.learning = null;
  run.levelUp = null;
  if (run.step < run.steps) {
    run.step += 1;
    offerStep(ctx, run, act, events);
    return;
  }
  events.push({ type: "ActCompleted", act: act.id });
  const all = act.routes ?? [];
  const open = all
    .filter((r) => (r.flags ?? []).every((f) => run.flags.includes(f)) && !(r.notFlags ?? []).some((f) => run.flags.includes(f)))
    .map((r) => r.to);
  if (all.length > 0 && open.length === 0) throw new Error(`run: no route out of "${act.id}" is open (content bug)`);
  if (open.length > 0) {
    run.phase = "route";
    run.routes = open;
    events.push({ type: "RoutesOffered", routes: [...open] });
  } else {
    run.phase = "won";
    events.push({ type: "RunEnded", result: "won" });
  }
}

// ---------------------------------------------------------------------------------------------
// After a node: rewards, learning, level-up (spec: Rewards, items and level-ups, "Order after a fight")

const isTier = (v: unknown): v is GroupTier => (GROUP_TIERS as readonly unknown[]).includes(v);

/** Draws the rewards screen for `tier` (reroll number `rerolls`) on its own stream. */
function drawScreen(ctx: RunContext, run: RunState, tier: GroupTier, rerolls: number): RewardOption[] {
  const table = actDef(ctx.pack, run.act).rewards?.[tier];
  if (table === undefined) throw new RangeError(`run: act "${run.act}" has no rewards for tier "${tier}"`);
  const p = run.player;
  const bonus = intelligenceBonusOptions(loadoutTotals(ctx.pack, run.picks, p.baseStats).stats.intelligence);
  const rng = new RngStreams(run.seed).derive("rewards", run.actNumber, run.act, run.step, rerolls);
  return drawRewards(ctx.pack, { cards: p.cards, picks: run.picks, table, bonus }, rng);
}

/** Shows the screen (phase "rewards", RewardsOffered). */
function showScreen(run: RunState, tier: GroupTier, rerolls: number, options: RewardOption[], events: RunEvent[]): void {
  run.phase = "rewards";
  run.rewards = { tier, rerolls, options };
  events.push({ type: "RewardsOffered", tier, options: options.map((o) => ({ ...o })), rerolls });
}

/** After a node's result (HP above 0) or a revive: the rewards screen if the result had a tier and anything can be offered. */
function afterNode(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  const tier = run.rewardTier;
  if (tier !== null) {
    const options = drawScreen(ctx, run, tier, 0);
    if (options.length > 0) return showScreen(run, tier, 0, options, events);
  }
  afterRewards(ctx, run, events);
}

/** After the rewards (and learning): the level-up for elite and boss fights if a stat can be raised, else move on. */
function afterRewards(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  run.rewards = null;
  run.learning = null;
  const tier = run.rewardTier;
  if (tier !== null && levelsUp(tier)) {
    const rng = new RngStreams(run.seed).derive("levelup", run.actNumber, run.act, run.step);
    const options = levelUpOptions(favouredStats(ctx.pack, run), run.player.baseStats, rng);
    if (options.length > 0) {
      run.phase = "levelUp";
      run.levelUp = { options };
      events.push({ type: "LevelUpOffered", options: [...options] });
      return;
    }
  }
  advance(ctx, run, events);
}

/** Gains `card` like a new skill; with a full hand, phase "learning" (true), else nothing more to do (false). */
function receiveCard(run: RunState, card: string, events: RunEvent[]): boolean {
  if (!gainCard(run.player, card, events)) return false;
  run.phase = "learning";
  run.rewards = null;
  run.learning = { card };
  return true;
}

// ---------------------------------------------------------------------------------------------
// Commands

/**
 * Starts a run in the pack's first act. Throws RangeError if no act is marked first, if any act names a node
 * type with no registered module, or for bad picks or technique (from loadout assembly).
 */
export function startRun(ctx: RunContext, init: { seed: string; picks: LoadoutPicks; technique: string | null }): { run: RunState; events: readonly RunEvent[] } {
  const acts = actsOf(ctx.pack);
  const first = acts.find((a) => a.first === true);
  if (first === undefined) throw new RangeError(`run: no act in pack "${ctx.pack.id}" is marked first`);
  checkModules(ctx, acts);
  const p = assemblePlayer(ctx.pack, init.picks, init.technique);

  const run: RunState = {
    seed: init.seed,
    phase: "choosing",
    picks: { ...init.picks },
    technique: init.technique,
    player: {
      hp: p.unit.maxHp,
      maxHp: p.unit.maxHp,
      cards: (p.unit.cards ?? []).map((c) => c.id),
      baseStats: { ...p.baseStats },
      eventTags: [...p.eventTags],
      rules: [...p.rules],
    },
    crowns: 0,
    flags: [],
    limits: initialRunLimits(),
    act: first.id,
    actNumber: 1,
    step: 1,
    steps: 0,
    offer: [],
    node: null,
    previousType: null,
    routes: [],
    fellInNode: false,
    rewardTier: null,
    rewards: null,
    learning: null,
    levelUp: null,
  };
  const events: RunEvent[] = [{ type: "RunStarted", seed: init.seed }];
  enterAct(ctx, run, first, events);
  return { run, events };
}

/** Enters option `index` of the current offer. */
export function chooseOption(_ctx: RunContext, run: RunState, index: number): CommandResult {
  if (run.phase !== "choosing") return refuse("wrong_phase");
  if (!isIndex(index, run.offer.length)) return refuse("no_such_option");
  const option = run.offer[index];
  if (option === undefined) return refuse("no_such_option");
  run.node = { ...option, option: index };
  run.previousType = option.type;
  run.offer = [];
  run.phase = "inNode";
  return accept([{ type: "NodeEntered", nodeType: option.type, ref: option.ref, option: index }]);
}

const isIntOrAbsent = (v: number | undefined): boolean => v === undefined || Number.isInteger(v);

/** Applies the current node's result, then falls at 0 HP or moves on. */
export function completeNode(ctx: RunContext, run: RunState, result: NodeResult): CommandResult {
  const node = run.node;
  if (run.phase !== "inNode" || node === null) return refuse("wrong_phase");
  if (!isIntOrAbsent(result.hp) || !isIntOrAbsent(result.crowns)) return refuse("invalid_result");
  const crownsChange = result.crowns ?? 0;
  if (run.crowns + crownsChange < 0) return refuse("invalid_result");
  const tier = result.rewardTier;
  if (tier !== undefined && (!isTier(tier) || actDef(ctx.pack, run.act).rewards?.[tier] === undefined)) return refuse("invalid_result");

  const before = run.player.hp;
  run.player.hp = Math.min(run.player.maxHp, Math.max(0, before + (result.hp ?? 0)));
  run.crowns += crownsChange;
  for (const f of result.setFlags ?? []) if (!run.flags.includes(f)) run.flags.push(f);
  const clear = result.clearFlags ?? [];
  if (clear.length > 0) run.flags = run.flags.filter((f) => !clear.includes(f));
  run.rewardTier = tier ?? null;

  const events: RunEvent[] = [
    { type: "NodeCompleted", nodeType: node.type, hpChange: run.player.hp - before, crownsChange, hp: run.player.hp, crowns: run.crowns },
  ];
  if (run.player.hp === 0) {
    run.phase = "fallen";
    events.push({ type: "PlayerFell" });
  } else afterNode(ctx, run, events);
  return accept(events);
}

/**
 * The player falls in the middle of the current node (a lost fight): HP 0, phase "fallen", the node stays current
 * and the run remembers the fall was mid-node, so a revive goes back into it (spec: Combat node).
 */
export function fallInNode(run: RunState): CommandResult {
  if (run.phase !== "inNode" || run.node === null) return refuse("wrong_phase");
  run.player.hp = 0;
  run.phase = "fallen";
  run.fellInNode = true;
  return accept([{ type: "PlayerFell" }]);
}

/**
 * Revives a fallen player at half max HP, rounded up, within the run limit. After a fall in the middle of a node
 * (fallInNode) the run goes back into that node (phase "inNode"; the node's module continues it); otherwise it
 * moves on as if the node had finished (with its rewards and level-up if its result had a tier).
 */
export function revive(ctx: RunContext, run: RunState, grant: Grant): CommandResult {
  if (run.phase !== "fallen") return refuse("wrong_phase");
  const res = consume(run.limits, "revive", grant);
  if (!res.ok) return refuse(res.reason);
  run.limits = res.state;
  run.player.hp = Math.ceil(run.player.maxHp / 2);
  const events: RunEvent[] = [{ type: "Revived", hp: run.player.hp }];
  if (run.fellInNode && run.node !== null) {
    run.fellInNode = false;
    run.phase = "inNode";
  } else {
    run.fellInNode = false;
    afterNode(ctx, run, events);
  }
  return accept(events);
}

/** Lets the tale end after a fall: the run is lost. */
export function endRun(run: RunState): CommandResult {
  if (run.phase !== "fallen") return refuse("wrong_phase");
  run.phase = "lost";
  run.node = null;
  run.fellInNode = false;
  run.rewardTier = null;
  return accept([{ type: "RunEnded", result: "lost" }]);
}

/** Takes open route `index`: that act starts at step 1, as the next act of the run. */
export function chooseRoute(ctx: RunContext, run: RunState, index: number): CommandResult {
  if (run.phase !== "route") return refuse("wrong_phase");
  if (!isIndex(index, run.routes.length)) return refuse("no_such_route");
  const to = run.routes[index];
  if (to === undefined) return refuse("no_such_route");
  const act = actDef(ctx.pack, to);
  run.routes = [];
  run.actNumber += 1;
  const events: RunEvent[] = [];
  enterAct(ctx, run, act, events);
  return accept(events);
}

// ---------------------------------------------------------------------------------------------
// Rewards, learning and level-up commands (spec: Rewards, items and level-ups)

/**
 * Takes option `index` of the rewards screen (RewardTaken). A purse adds its crowns (CrownsGained). A skill or Word is
 * gained (appended, or phase "learning" with a full hand). An item replaces the one in its slot (ItemEquipped; the
 * old item's card leaves, the new item's card is gained like a skill). Then the level-up or the next step.
 */
export function takeReward(ctx: RunContext, run: RunState, index: number): CommandResult {
  const screen = run.rewards;
  if (run.phase !== "rewards" || screen === null) return refuse("wrong_phase");
  if (!isIndex(index, screen.options.length)) return refuse("no_such_option");
  const option = screen.options[index];
  if (option === undefined) return refuse("no_such_option");
  const events: RunEvent[] = [{ type: "RewardTaken", option: { ...option } }];
  run.rewards = null;
  let card: string | null = null;
  if (option.kind === "crowns") {
    run.crowns += option.amount;
    events.push({ type: "CrownsGained", amount: option.amount, crowns: run.crowns });
  } else if (option.kind === "skill") card = option.id;
  else card = equipItem(ctx.pack, run, option.slot, option.id, events);
  if (card === null || !receiveCard(run, card, events)) afterRewards(ctx, run, events);
  return accept(events);
}

/** Takes nothing from the rewards screen (RewardSkipped), then the level-up or the next step. */
export function skipReward(ctx: RunContext, run: RunState): CommandResult {
  if (run.phase !== "rewards" || run.rewards === null) return refuse("wrong_phase");
  const events: RunEvent[] = [{ type: "RewardSkipped" }];
  afterRewards(ctx, run, events);
  return accept(events);
}

/**
 * Redraws the whole rewards screen with the next reroll number of this screen, within the run limit (code rule 7:
 * only through `consume`). RewardsRerolled (run-wide count), then RewardsOffered. Nothing else changes.
 */
export function rerollRewards(ctx: RunContext, run: RunState, grant: Grant): CommandResult {
  const screen = run.rewards;
  if (run.phase !== "rewards" || screen === null) return refuse("wrong_phase");
  const res = consume(run.limits, "reroll", grant);
  if (!res.ok) return refuse(res.reason);
  run.limits = res.state;
  const rerolls = screen.rerolls + 1;
  const events: RunEvent[] = [{ type: "RewardsRerolled", rerollsUsed: run.limits.used.reroll }];
  showScreen(run, screen.tier, rerolls, drawScreen(ctx, run, screen.tier, rerolls), events);
  return accept(events);
}

/** Learning: forgets card `cardIndex` (permanent; Strike included) and adds the new card at the end (CardLearned). */
export function forgetCard(ctx: RunContext, run: RunState, cardIndex: number): CommandResult {
  const learning = run.learning;
  if (run.phase !== "learning" || learning === null) return refuse("wrong_phase");
  if (!isIndex(cardIndex, run.player.cards.length)) return refuse("no_such_option");
  const events: RunEvent[] = [];
  learnInPlaceOf(run.player, learning.card, cardIndex, events);
  afterRewards(ctx, run, events);
  return accept(events);
}

/** Learning: leaves the new card and keeps the hand (CardLeft). */
export function leaveCard(ctx: RunContext, run: RunState): CommandResult {
  const learning = run.learning;
  if (run.phase !== "learning" || learning === null) return refuse("wrong_phase");
  const events: RunEvent[] = [{ type: "CardLeft", card: learning.card }];
  afterRewards(ctx, run, events);
  return accept(events);
}

/** Raises offered stat `index` (StatRaised), then the next step, or the end of the act. */
export function chooseLevelUp(ctx: RunContext, run: RunState, index: number): CommandResult {
  const levelUp = run.levelUp;
  if (run.phase !== "levelUp" || levelUp === null) return refuse("wrong_phase");
  if (!isIndex(index, levelUp.options.length)) return refuse("no_such_option");
  const stat = levelUp.options[index];
  if (stat === undefined) return refuse("no_such_option");
  const events: RunEvent[] = [];
  raiseStat(ctx.pack, run, stat, events);
  run.levelUp = null;
  advance(ctx, run, events);
  return accept(events);
}
