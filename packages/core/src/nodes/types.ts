/**
 * Node modules (spec: Run map, "Node modules"). The run engine knows only this interface: each node type
 * (event, combat, merchant, …) is a module registered by id. What a type does comes from its module, never
 * from its id (code rule 2): the merchant's "never twice in a row" is its `mayFollowItself: false`.
 */
import type { ActDef } from "../content/types.ts";
import type { Rng } from "../rng/rng.ts";
import type { RunState } from "../run/run.ts";

/** Plain JSON data: what a built option carries, so the run state survives a JSON round trip. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };

export interface NodeBuildContext {
  /** The live run (read only by convention: a build must not change it). */
  readonly run: RunState;
  readonly act: ActDef;
  /** The fixed node's `ref`, or null for a drawn option. */
  readonly ref: string | null;
  /** The option's own stream (seed, act position, act, step, option position). */
  readonly rng: Rng;
}

/** A built option: what the player reads is what they get. `text` and `tag` are localisation keys. */
export interface NodeBuild {
  readonly text: string;
  readonly tag: string | null;
  /** Everything the module needs to run the node later (enemies, stock, story id), as plain data. */
  readonly data: JsonValue;
}

export interface NodeType {
  readonly id: string;
  /** False for a type that may not be drawn right after a node of the same type (the merchant). */
  readonly mayFollowItself: boolean;
  /** Whether the type may be drawn now. Not asked for fixed nodes. */
  canAppear(run: RunState, act: ActDef): boolean;
  /** Builds one option. Must be deterministic in its inputs and draw randomness only from `ctx.rng`. */
  build(ctx: NodeBuildContext): NodeBuild;
}
