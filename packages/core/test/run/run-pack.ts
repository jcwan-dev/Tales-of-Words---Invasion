// Test content and fake node types for the run engine tests (not a test file itself).
// Spec Draft 1.9, "Run map": the engine knows only the node interface; real event, combat and merchant modules come
// later, so these tests register fake node types whose builds record what they were given.
import {
  chooseOption,
  chooseRoute,
  completeNode,
  endRun,
  NodeRegistry,
  revive,
  startRun,
  validatePack,
  type ActDef,
  type CommandResult,
  type ContentFile,
  type ContentPack,
  type JsonValue,
  type LoadoutPicks,
  type NodeBuild,
  type NodeBuildContext,
  type NodeResult,
  type NodeType,
  type RunContext,
  type RunEvent,
  type RunState,
} from "../../src/index.ts";
import { ALL_FILES, picks } from "./loadout-pack.ts";

type Obj = Record<string, unknown>;

const file = (data: Obj): ContentFile => ({ path: `${String(data["id"])}.json`, data });

/** A path with rules, so the run's player carries some. */
export const RULED_PATH = file({ kind: "path", id: "path.ruled", name: "path.ruled.name", rules: ["no_dishonest_choices", "sworn"] });

/** The fixed boss of every test act unless overridden. */
export const BOSS = { at: "last", type: "combat", ref: "group.boss" } as const;

/**
 * An act file. Defaults: steps 3–3, weights event 50 / combat 35 / merchant 15, only the boss fixed, no routes,
 * not first. `over` replaces whole fields; pass `undefined` to drop one.
 */
export function actFile(id: string, over: Obj = {}): ContentFile {
  const data: Obj = {
    kind: "act",
    id,
    name: `${id}.name`,
    steps: { min: 3, max: 3 },
    weights: { event: 50, combat: 35, merchant: 15 },
    fixed: [BOSS],
    ...over,
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return file(data);
}

/** The usual first act: 3 steps, step 1 and 2 drawn, step 3 the boss; no routes, so finishing it wins. */
export const ACT_ONE = actFile("act.one", { first: true });

/** A validated pack: the loadout test content, RULED_PATH, and the given act files. */
export function runPack(acts: readonly ContentFile[] = [ACT_ONE]): ContentPack {
  const res = validatePack("test", [...ALL_FILES, RULED_PATH, ...acts]);
  if (!res.pack) throw new Error(`test pack invalid:\n${res.issues.map((i) => `${i.path} ${i.message}`).join("\n")}`);
  return res.pack;
}

/** What a fake build records in `data`. `draw` is the first draw from the build's rng. */
export interface FakeData {
  readonly type: string;
  readonly ref: string | null;
  readonly act: string;
  readonly draw: number;
}

export const dataOf = (o: { readonly data: JsonValue }): FakeData => o.data as unknown as FakeData;

/** One recorded build call. */
export interface BuildCall {
  readonly type: string;
  readonly ref: string | null;
  readonly act: string;
  readonly draw: number;
}

export type CanAppear = (run: RunState, act: ActDef) => boolean;

export interface FakeTypeOptions {
  readonly mayFollowItself?: boolean;
  readonly canAppear?: CanAppear;
}

/** A fake node type: text `node.<id>.text`, tag `node.<id>.tag`, data = FakeData. Every build is pushed to `calls`. */
export function fakeType(id: string, calls: BuildCall[], opts: FakeTypeOptions = {}): NodeType {
  const canAppear = opts.canAppear ?? (() => true);
  return {
    id,
    mayFollowItself: opts.mayFollowItself ?? true,
    canAppear: (run, act) => canAppear(run, act),
    build(ctx: NodeBuildContext): NodeBuild {
      const draw = ctx.rng.int(0, 1_000_000_000);
      const rec = { type: id, ref: ctx.ref, act: ctx.act.id, draw };
      calls.push(rec);
      return { text: `node.${id}.text`, tag: `node.${id}.tag`, data: { ...rec } };
    },
  };
}

export interface RegistryOptions {
  /** canAppear per type id (default: always true). */
  readonly canAppear?: Readonly<Record<string, CanAppear>>;
  /** Extra type ids to register (mayFollowItself true). */
  readonly extra?: readonly string[];
  /** Type ids to leave out of the default event / combat / merchant. */
  readonly without?: readonly string[];
}

/** event and combat may follow themselves; merchant may not (spec: Run map). */
export function makeRegistry(opts: RegistryOptions = {}): { registry: NodeRegistry; calls: BuildCall[] } {
  const calls: BuildCall[] = [];
  const registry = new NodeRegistry();
  const defs: [string, boolean][] = [
    ["event", true],
    ["combat", true],
    ["merchant", false],
    ...(opts.extra ?? []).map((id): [string, boolean] => [id, true]),
  ];
  for (const [id, mayFollowItself] of defs) {
    if ((opts.without ?? []).includes(id)) continue;
    const canAppear = opts.canAppear?.[id];
    registry.register(fakeType(id, calls, canAppear === undefined ? { mayFollowItself } : { mayFollowItself, canAppear }));
  }
  return { registry, calls };
}

/** A run context over `runPack(acts)` and `makeRegistry(opts)`. */
export function ctxOf(acts: readonly ContentFile[] = [ACT_ONE], opts: RegistryOptions = {}): RunContext & { calls: BuildCall[] } {
  const { registry, calls } = makeRegistry(opts);
  return { pack: runPack(acts), registry, calls };
}

export const PICKS: LoadoutPicks = picks({ path: "path.ruled" });

export function start(ctx: RunContext, seed = "seed", technique: string | null = "skill.t_might_a") {
  return startRun(ctx, { seed, picks: PICKS, technique });
}

/** JSON copy, for before/after comparisons and resume tests. */
export const snapshot = (run: RunState): RunState => JSON.parse(JSON.stringify(run)) as RunState;

/** Asserts a command was accepted and returns its events. */
export function ok(res: CommandResult): readonly RunEvent[] {
  if (!res.ok) throw new Error(`command refused: ${res.reason}`);
  return res.events;
}

/** The event type names, in order. */
export const kinds = (events: readonly RunEvent[]): string[] => events.map((e) => (e as { type: string }).type);

/** Enter option `option` and complete it with `result`. Returns the completeNode events. */
export function playNode(ctx: RunContext, run: RunState, option = 0, result: NodeResult = {}): readonly RunEvent[] {
  ok(chooseOption(ctx, run, option));
  return ok(completeNode(ctx, run, result));
}

/**
 * Plays a whole run with a fixed policy that depends only on the run's own state, so two identical runs get
 * identical commands. Takes some damage and crowns, sets and clears flags, falls sometimes, revives while
 * the limit allows (alternating grant sources), then ends. Returns every event and the number of commands sent.
 */
export function autoplay(ctx: RunContext, run: RunState, maxCommands = 500): { events: RunEvent[]; commands: number } {
  const events: RunEvent[] = [];
  let n = 0;
  for (; n < maxCommands; n++) {
    let res: CommandResult;
    switch (run.phase) {
      case "choosing":
        res = chooseOption(ctx, run, (run.step + run.actNumber) % run.offer.length);
        break;
      case "inNode": {
        const big = (run.step * 7 + run.actNumber) % 5 === 0;
        res = completeNode(ctx, run, {
          hp: big ? -1000 : run.step % 3 === 0 ? 5 : -3,
          crowns: 2,
          setFlags: [`f${run.step % 3}`],
          clearFlags: run.step % 4 === 0 ? ["f1"] : [],
        });
        break;
      }
      case "route":
        res = chooseRoute(ctx, run, (run.player.hp + run.flags.length) % run.routes.length);
        break;
      case "fallen":
        res =
          run.limits.used.revive < 2
            ? revive(ctx, run, { action: "revive", source: run.limits.used.revive === 0 ? "ad" : "premium" })
            : endRun(run);
        break;
      default:
        return { events, commands: n };
    }
    events.push(...ok(res));
  }
  return { events, commands: n };
}
