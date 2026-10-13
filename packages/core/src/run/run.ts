/**
 * The run engine (spec: Run map, "Core loop", "Monetisation architecture"). Commands in, events out.
 *
 * The run state is plain data, mutated in place by the commands, and survives a JSON round trip, so a run can be
 * saved between nodes and when a node is entered. A refused command changes nothing. Node types come from a
 * registry of modules; the engine never looks at a type's id to decide behaviour (code rule 2).
 *
 * Randomness: each decision has its own stream from the run seed, the act's position in the run, the act and the
 * step (and the option's position), so nothing else in the run shifts it and an act visited twice draws afresh.
 */
import { MAX_PLAYER_CARDS } from "../combat/unit.ts";
import { GROUP_TIERS, type ActDef, type ContentPack, type FixedNodeDef, type GroupTier, type RewardTableDef } from "../content/types.ts";
import type { Rarity } from "../model/rarity.ts";
import type { StatBlock, StatId } from "../model/stats.ts";
import type { NodeRegistry } from "../nodes/registry.ts";
import type { JsonValue, NodeType } from "../nodes/types.ts";
import { RngStreams } from "../rng/rng.ts";
import { drawOptionTypes, type WeightedType } from "./draw.ts";
import { consume, initialRunLimits, type Grant, type RunLimitsState } from "./limits.ts";
import { assemblePlayer, intelligenceBonusOptions, loadoutFinalStats, type LoadoutPicks } from "./loadout.ts";
import { applyLevelUp, equipItem, gainRelic, itemOfferRarity, learnCard, levelUpOffer, upgradeCard } from "./progress.ts";
import { copyCard, drawRewardScreen, LEVEL_UP_TIERS, RELIC_CARD_TIERS, type ItemSlot, type RewardCard } from "./rewards.ts";

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

/**
 * choosing a node → in a node → (after a fight) rewards → learning → levelUp → the next step, or (after the boss)
 * route → next act; or fallen; or ended (won or lost).
 */
export type RunPhase = "choosing" | "inNode" | "rewards" | "learning" | "levelUp" | "route" | "fallen" | "won" | "lost";

/** The rewards screen (phase "rewards"). `rerolls` counts this screen's rerolls (each screen starts at 0). */
export interface RewardsState {
  tier: GroupTier;
  rerolls: number;
  cards: RewardCard[];
}

/** A card waiting to be learned with 5 held (phase "learning"); `queue`: further incoming cards, in order. */
export interface LearningState {
  card: string;
  rarity: Rarity;
  queue: { card: string; rarity: Rarity }[];
}

/** The stats a level-up offers (phase "levelUp"). */
export interface LevelUpState {
  options: StatId[];
}

export interface RunPlayer {
  hp: number;
  maxHp: number;
  /** Card ids in order (the weapon's Strike has the weapon's id). */
  cards: string[];
  /** Card id → rarity, for every held card and only those (spec: Rarity). A held card with no entry counts as grey. */
  rarities: Record<string, Rarity>;
  /** 2 / favoured 3, raised by level-ups only (run cap 7); item, path and relic modifiers are added on top. */
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
  /** Relic ids, in the order gained, no duplicates (spec: Rewards and level-ups). */
  relics: string[];
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
  /** The rewards screen (phase "rewards"); null otherwise. */
  rewards: RewardsState | null;
  /** The card waiting to be learned (phase "learning"); null otherwise. */
  learning: LearningState | null;
  /** The level-up offer (phase "levelUp"); null otherwise. */
  levelUp: LevelUpState | null;
  /**
   * The tier of the pending after-fight flow: set when a node completes with a `rewardTier` (kept through a fall, so
   * a revive runs the flow), cleared when the run moves on or ends. Null otherwise.
   */
  rewardTier: GroupTier | null;
}

/** What a node hands back when it finishes. Integers only. */
export interface NodeResult {
  readonly hp?: number;
  readonly crowns?: number;
  readonly setFlags?: readonly string[];
  readonly clearFlags?: readonly string[];
  /** A won fight's tier: the after-fight flow follows, from the act's table for this tier (spec: After-fight flow). */
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
  | { readonly type: "RoutesOffered"; readonly routes: readonly string[] }
  | { readonly type: "RunEnded"; readonly result: "won" | "lost" }
  | { readonly type: "RewardsOffered"; readonly tier: GroupTier; readonly cards: readonly RewardCard[]; readonly rerolls: number }
  | { readonly type: "RewardsRerolled"; readonly rerollsUsed: number }
  | { readonly type: "RewardTaken"; readonly card: RewardCard }
  | { readonly type: "RewardSkipped" }
  | { readonly type: "CardOffered"; readonly card: string; readonly rarity: Rarity }
  | { readonly type: "CardLearned"; readonly card: string; readonly rarity: Rarity; readonly replaced: string | null }
  | { readonly type: "CardUpgraded"; readonly card: string; readonly rarity: Rarity }
  | { readonly type: "CardLeft"; readonly card: string }
  | {
      readonly type: "ItemEquipped";
      readonly slot: ItemSlot;
      readonly item: string;
      readonly previous: string;
      readonly maxHp: number;
      readonly hp: number;
    }
  | { readonly type: "CrownsGained"; readonly amount: number; readonly crowns: number }
  | { readonly type: "RelicGained"; readonly relic: string; readonly maxHp: number; readonly hp: number }
  | { readonly type: "LevelUpOffered"; readonly options: readonly StatId[] }
  | { readonly type: "StatRaised"; readonly stat: StatId; readonly value: number; readonly maxHp: number; readonly hp: number };

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
      rarities: { ...p.rarities },
      baseStats: { ...p.baseStats },
      eventTags: [...p.eventTags],
      rules: [...p.rules],
    },
    crowns: 0,
    relics: [],
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
    rewards: null,
    learning: null,
    levelUp: null,
    rewardTier: null,
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
  if (tier !== undefined && rewardTable(ctx, run, tier) === undefined) return refuse("invalid_result");

  const before = run.player.hp;
  run.player.hp = Math.min(run.player.maxHp, Math.max(0, before + (result.hp ?? 0)));
  run.crowns += crownsChange;
  for (const f of result.setFlags ?? []) if (!run.flags.includes(f)) run.flags.push(f);
  const clear = result.clearFlags ?? [];
  if (clear.length > 0) run.flags = run.flags.filter((f) => !clear.includes(f));

  const events: RunEvent[] = [
    { type: "NodeCompleted", nodeType: node.type, hpChange: run.player.hp - before, crownsChange, hp: run.player.hp, crowns: run.crowns },
  ];
  run.rewardTier = tier ?? null;
  if (run.player.hp === 0) {
    // The after-fight flow waits: a revive runs it.
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
 * moves on as if the node had finished.
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
// After-fight flow (spec: Rewards and level-ups, "After-fight flow"; ADR 0013):
// rewards → learning (a card arriving with 5 held) → level-up (elite and boss) → the next step, or the routes.

const isGroupTier = (t: unknown): t is GroupTier => typeof t === "string" && (GROUP_TIERS as readonly string[]).includes(t);

/** The current act's table for `tier`, or undefined (not a tier, or no table). */
function rewardTable(ctx: RunContext, run: RunState, tier: unknown): RewardTableDef | undefined {
  if (!isGroupTier(tier)) return undefined;
  const rewards = actDef(ctx.pack, run.act).rewards;
  if (rewards === undefined || !Object.hasOwn(rewards, tier)) return undefined;
  return rewards[tier];
}

/** After a node is done (completed, or revived after it): the after-fight flow if a tier is pending, else move on. */
function afterNode(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  if (run.rewardTier !== null) openRewards(ctx, run, events);
  else advance(ctx, run, events);
}

/** Draws the screen for the pending tier with the given reroll number. Throws if the act lost its table (content bug). */
function drawScreen(ctx: RunContext, run: RunState, tier: GroupTier, rerolls: number): RewardCard[] {
  const table = rewardTable(ctx, run, tier);
  if (table === undefined) throw new Error(`run: "${run.act}" has no reward table for tier "${tier}"`);
  const p = run.player;
  const intelligence = loadoutFinalStats(ctx.pack, run.picks, p.baseStats, run.relics).intelligence;
  const rng = new RngStreams(run.seed).derive("rewards", run.actNumber, run.act, run.step, rerolls);
  return drawRewardScreen(
    ctx.pack,
    {
      cards: p.cards,
      rarities: p.rarities,
      picks: run.picks,
      relics: run.relics,
      table,
      bonus: intelligenceBonusOptions(intelligence),
      relicCard: RELIC_CARD_TIERS.includes(tier),
    },
    rng,
  );
}

function offerRewards(run: RunState, events: RunEvent[]): void {
  const r = run.rewards;
  if (r === null) return;
  events.push({ type: "RewardsOffered", tier: r.tier, cards: r.cards.map(copyCard), rerolls: r.rerolls });
}

/** The rewards screen; nothing to offer: no screen, straight on. */
function openRewards(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  const tier = run.rewardTier;
  if (tier === null) return advance(ctx, run, events);
  const cards = drawScreen(ctx, run, tier, 0);
  if (cards.length === 0) return afterRewards(ctx, run, events);
  run.phase = "rewards";
  run.rewards = { tier, rerolls: 0, cards };
  offerRewards(run, events);
}

/**
 * Learns incoming cards in order: one already held is skipped; with room it is added at the end; with 5 held the run
 * waits in phase "learning" with the rest queued. When none is left, the flow goes on.
 */
function learnIncoming(ctx: RunContext, run: RunState, queue: readonly { card: string; rarity: Rarity }[], events: RunEvent[]): void {
  for (let i = 0; i < queue.length; i++) {
    const next = queue[i];
    if (next === undefined || run.player.cards.includes(next.card)) continue;
    if (run.player.cards.length < MAX_PLAYER_CARDS) {
      const res = learnCard(ctx.pack, run, next.card, next.rarity, null);
      if (!res.ok) throw new Error(`run: can't learn "${next.card}" (${res.reason})`);
      events.push({ type: "CardLearned", card: next.card, rarity: next.rarity, replaced: null });
      continue;
    }
    run.phase = "learning";
    run.learning = { card: next.card, rarity: next.rarity, queue: queue.slice(i + 1).map((q) => ({ card: q.card, rarity: q.rarity })) };
    events.push({ type: "CardOffered", card: next.card, rarity: next.rarity });
    return;
  }
  afterRewards(ctx, run, events);
}

/** After the screen and any learning: the level-up for elite and boss tiers (if a stat can rise), else move on. */
function afterRewards(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  run.rewards = null;
  run.learning = null;
  const tier = run.rewardTier;
  if (tier !== null && LEVEL_UP_TIERS.includes(tier)) {
    const rng = new RngStreams(run.seed).derive("levelup", run.actNumber, run.act, run.step);
    const options = [...levelUpOffer(ctx.pack, run, rng)];
    if (options.length > 0) {
      run.phase = "levelUp";
      run.levelUp = { options };
      events.push({ type: "LevelUpOffered", options: [...options] });
      return;
    }
  }
  finishFlow(ctx, run, events);
}

/** The flow is over: the run moves on (next step, routes or victory). */
function finishFlow(ctx: RunContext, run: RunState, events: RunEvent[]): void {
  run.rewards = null;
  run.learning = null;
  run.levelUp = null;
  run.rewardTier = null;
  advance(ctx, run, events);
}

/**
 * Takes card `index` of the rewards screen (spec: After-fight flow, "Taking a card"): a held skill or Word rises to
 * the card's rarity; a new one is learned (added, or phase "learning" with 5 held); an item is equipped and the card
 * it offers learned the same way; a purse adds crowns; a relic is gained. Then the flow goes on.
 */
export function takeReward(ctx: RunContext, run: RunState, index: number): CommandResult {
  const r = run.rewards;
  if (run.phase !== "rewards" || r === null) return refuse("wrong_phase");
  if (!isIndex(index, r.cards.length)) return refuse("no_such_option");
  const card = r.cards[index];
  if (card === undefined) return refuse("no_such_option");
  const events: RunEvent[] = [{ type: "RewardTaken", card: copyCard(card) }];
  run.rewards = null;
  switch (card.kind) {
    case "skill": {
      if (run.player.cards.includes(card.id)) {
        const res = upgradeCard(run, card.id, card.rarity);
        if (!res.ok) throw new Error(`run: can't upgrade "${card.id}" (${res.reason})`);
        events.push({ type: "CardUpgraded", card: card.id, rarity: card.rarity });
        afterRewards(ctx, run, events);
      } else learnIncoming(ctx, run, [{ card: card.id, rarity: card.rarity }], events);
      break;
    }
    case "item": {
      const previous = run.picks[card.slot];
      const { offers } = equipItem(ctx.pack, run, card.id);
      events.push({ type: "ItemEquipped", slot: card.slot, item: card.id, previous, maxHp: run.player.maxHp, hp: run.player.hp });
      learnIncoming(
        ctx,
        run,
        offers.map((id) => ({ card: id, rarity: itemOfferRarity(ctx.pack, run, id) })),
        events,
      );
      break;
    }
    case "crowns":
      run.crowns += card.amount;
      events.push({ type: "CrownsGained", amount: card.amount, crowns: run.crowns });
      afterRewards(ctx, run, events);
      break;
    case "relic":
      gainRelic(ctx.pack, run, card.id);
      events.push({ type: "RelicGained", relic: card.id, maxHp: run.player.maxHp, hp: run.player.hp });
      afterRewards(ctx, run, events);
      break;
  }
  return accept(events);
}

/** Leaves every card of the rewards screen; the flow goes on. */
export function skipReward(ctx: RunContext, run: RunState): CommandResult {
  if (run.phase !== "rewards" || run.rewards === null) return refuse("wrong_phase");
  const events: RunEvent[] = [{ type: "RewardSkipped" }];
  afterRewards(ctx, run, events);
  return accept(events);
}

/**
 * Redraws the whole screen (spec: After-fight flow, "Rerolls"; Monetisation architecture): needs a reroll grant,
 * within the run limit (run/limits.ts). The stream is per node and this screen's reroll number, so nothing else in the
 * run shifts; the boss relic card stays a relic card.
 */
export function rerollRewards(ctx: RunContext, run: RunState, grant: Grant): CommandResult {
  const r = run.rewards;
  if (run.phase !== "rewards" || r === null) return refuse("wrong_phase");
  const res = consume(run.limits, "reroll", grant);
  if (!res.ok) return refuse(res.reason);
  const rerolls = r.rerolls + 1;
  const cards = drawScreen(ctx, run, r.tier, rerolls);
  run.limits = res.state;
  run.rewards = { tier: r.tier, rerolls, cards };
  const events: RunEvent[] = [{ type: "RewardsRerolled", rerollsUsed: run.limits.used.reroll }];
  offerRewards(run, events);
  return accept(events);
}

/** Phase "learning": forgets held card `cardId`; the new card takes its place. Then the next incoming card, or on. */
export function learnForget(ctx: RunContext, run: RunState, cardId: string): CommandResult {
  const l = run.learning;
  if (run.phase !== "learning" || l === null) return refuse("wrong_phase");
  if (!run.player.cards.includes(cardId)) return refuse("no_such_option");
  const res = learnCard(ctx.pack, run, l.card, l.rarity, cardId);
  if (!res.ok) return refuse("no_such_option");
  const events: RunEvent[] = [{ type: "CardLearned", card: l.card, rarity: l.rarity, replaced: cardId }];
  run.learning = null;
  learnIncoming(ctx, run, l.queue, events);
  return accept(events);
}

/** Phase "learning": leaves the offered card and keeps the hand. Then the next incoming card, or on. */
export function learnLeave(ctx: RunContext, run: RunState): CommandResult {
  const l = run.learning;
  if (run.phase !== "learning" || l === null) return refuse("wrong_phase");
  const events: RunEvent[] = [{ type: "CardLeft", card: l.card }];
  run.learning = null;
  learnIncoming(ctx, run, l.queue, events);
  return accept(events);
}

/** Phase "levelUp": raises offered stat `index` (applyLevelUp), then the run moves on. */
export function chooseLevelUp(ctx: RunContext, run: RunState, index: number): CommandResult {
  const l = run.levelUp;
  if (run.phase !== "levelUp" || l === null) return refuse("wrong_phase");
  if (!isIndex(index, l.options.length)) return refuse("no_such_option");
  const stat = l.options[index];
  if (stat === undefined) return refuse("no_such_option");
  applyLevelUp(ctx.pack, run, stat);
  const events: RunEvent[] = [{ type: "StatRaised", stat, value: run.player.baseStats[stat], maxHp: run.player.maxHp, hp: run.player.hp }];
  finishFlow(ctx, run, events);
  return accept(events);
}
